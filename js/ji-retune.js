/**
 * Lightweight Just Intonation retune from JustPlay marker palettes.
 * Matches core/ji_engine.py frequency + pitch-bend math (5-/7-limit Tonnetz),
 * including find_best_midi_note_for_frequency when bend would exceed ±pbRange.
 */

const SEPTIMAL_RATIO = 7 / 4;
const PB_CENTER = 8192;

export function midiNoteTo12tetHz(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

function unpackCoords(coords) {
  if (!coords || !Array.isArray(coords) || !coords.length) return null;
  if (coords.length === 2) return [coords[0] | 0, coords[1] | 0, 0];
  return [coords[0] | 0, coords[1] | 0, coords[2] | 0];
}

function jiCoordsToFrequencyRatio(coords) {
  const [fifths, thirds, septimals] = coords;
  return (3 / 2) ** fifths * (5 / 4) ** thirds * SEPTIMAL_RATIO ** septimals;
}

function normalizeRatioToOctave(ratio) {
  let r = ratio;
  let octaveAdj = 0;
  while (r >= 2) {
    r /= 2;
    octaveAdj += 1;
  }
  while (r < 1) {
    r *= 2;
    octaveAdj -= 1;
  }
  return { ratio: r, octaveAdj };
}

/** JI frequency for scale degree relative to a reference note's Hz. */
export function getJiFrequency(scaleIndex, octave, config, referenceFrequency) {
  const coords = unpackCoords(config[scaleIndex % 12]);
  // Unassigned / null slots stay 12-TET — never treat as unison (0,0).
  if (!coords) {
    return referenceFrequency * 2 ** ((scaleIndex % 12) / 12 + octave);
  }
  const raw = jiCoordsToFrequencyRatio(coords);
  const { ratio } = normalizeRatioToOctave(raw);
  return referenceFrequency * ratio * 2 ** octave;
}

/**
 * Signed pitch bend (-8192..8191) centred at 0 for ±pitchBendRange semitones.
 */
export function calculatePitchBendValue(targetHz, midiNote, pitchBendRange = 2) {
  const noteHz = midiNoteTo12tetHz(midiNote);
  if (!(targetHz > 0) || !(noteHz > 0)) return 0;
  const cents = 1200 * Math.log2(targetHz / noteHz);
  const maxCents = Math.max(1, pitchBendRange) * 100;
  let bend = Math.trunc((cents / maxCents) * 8192);
  if (bend < -8192) bend = -8192;
  if (bend > 8191) bend = 8191;
  return bend;
}

/**
 * Pick a nearby MIDI note so the residual bend fits in ±pitchBendRange
 * (port of core.ji_engine.find_best_midi_note_for_frequency).
 * @returns {{ midiNote: number, signedBend: number }}
 */
export function findBestMidiNoteForFrequency(
  targetHz,
  preferredNote,
  pitchBendRange = 2,
  searchRange = 12,
) {
  let bestNote = preferredNote | 0;
  let bestBend = calculatePitchBendValue(targetHz, bestNote, pitchBendRange);
  let minAbsSemis = Infinity;
  const pb = Math.max(1, pitchBendRange | 0);

  for (let offset = -searchRange; offset <= searchRange; offset++) {
    const test = (preferredNote | 0) + offset;
    if (test < 0 || test > 127) continue;
    const cents = 1200 * Math.log2(targetHz / midiNoteTo12tetHz(test));
    const absSemis = Math.abs(cents / 100);
    if (absSemis <= pb && absSemis < minAbsSemis) {
      minAbsSemis = absSemis;
      bestNote = test;
      bestBend = calculatePitchBendValue(targetHz, test, pb);
    }
  }
  return { midiNote: bestNote, signedBend: bestBend };
}

export function signedBendTo14bit(signed) {
  return Math.max(0, Math.min(16383, (signed | 0) + PB_CENTER));
}

/** Active marker at tick (last marker with marker.tick <= tick). */
export function markerAtTick(markers, tick) {
  if (!markers?.length) return null;
  let best = null;
  for (const m of markers) {
    if (m.tick <= tick) best = m;
    else break;
  }
  return best;
}

/** True when a marker carries real JI (not the inert ji:false / all-null stub). */
export function isEditableJiMarker(m) {
  if (!m || m.bypass) return false;
  const ji = m.metadata?.ji ?? m.ji;
  if (ji === false) return false;
  if (!Array.isArray(m.config) || m.config.length < 12) return false;
  return m.config.some((c) => c != null && Array.isArray(c));
}

/**
 * Per-note JI playback plan: may remap MIDI note when bend would exceed range,
 * and may assign a temporary playChannel when concurrent notes on the same
 * voice channel need different bends (export keeps voice channels; playback only).
 *
 * @returns {{
 *   pitchBends: {tick:number, channel:number, value:number}[],
 *   noteRetunes: Record<string|number, { note:number, channel:number, bend:number }>,
 * }}
 */
export function buildJiRetunePlan(notes, markers, options = {}) {
  const fileRef = options.refNote ?? options.referenceMidiNote ?? 60;
  const pbRange = options.pitchBendRange ?? 2;
  const usable = (markers || []).filter(isEditableJiMarker);
  /** @type {Record<string|number, { note:number, channel:number, bend:number }>} */
  const noteRetunes = {};
  if (!notes?.length || !usable.length) {
    return { pitchBends: [], noteRetunes };
  }

  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || a.channel - b.channel || a.note - b.note,
  );

  const voiceChannels = new Set(sorted.map((n) => n.channel));

  // voice channel → { bend, untilTick, playCh }[] of currently assigned play slots
  /** @type {Map<number, { bend: number, until: number, playCh: number }[]>} */
  const activeByVoice = new Map();
  const reservedPlay = new Set();

  function releaseFinished(tick, voiceCh) {
    const list = activeByVoice.get(voiceCh) || [];
    const next = list.filter((s) => s.until > tick);
    for (const dropped of list) {
      if (dropped.until <= tick) reservedPlay.delete(dropped.playCh);
    }
    activeByVoice.set(voiceCh, next);
    return next;
  }

  function pickPlayChannel(voiceCh, bend, start, end) {
    const active = releaseFinished(start, voiceCh);
    const match = active.find((s) => s.bend === bend);
    if (match) {
      match.until = Math.max(match.until, end);
      return match.playCh;
    }
    const voiceBusy = active.some((s) => s.playCh === voiceCh && s.bend !== bend);
    if (!voiceBusy && !reservedPlay.has(voiceCh)) {
      active.push({ bend, until: end, playCh: voiceCh });
      activeByVoice.set(voiceCh, active);
      reservedPlay.add(voiceCh);
      return voiceCh;
    }
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9 || reservedPlay.has(ch)) continue;
      // Prefer spare channels that are not another voice's home channel.
      if (voiceChannels.has(ch) && ch !== voiceCh) continue;
      active.push({ bend, until: end, playCh: ch });
      activeByVoice.set(voiceCh, active);
      reservedPlay.add(ch);
      return ch;
    }
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9 || reservedPlay.has(ch)) continue;
      active.push({ bend, until: end, playCh: ch });
      activeByVoice.set(voiceCh, active);
      reservedPlay.add(ch);
      return ch;
    }
    return voiceCh;
  }

  for (const note of sorted) {
    const marker = markerAtTick(usable, note.start);
    if (!marker || !isEditableJiMarker(marker)) continue;
    const refNote =
      marker.metadata?.refNote != null
        ? marker.metadata.refNote | 0
        : marker.refNote != null
          ? marker.refNote | 0
          : fileRef;
    const scaleIndex = ((note.note - refNote) % 12 + 12) % 12;
    const rawCoords = marker.config[scaleIndex];
    if (rawCoords == null || !Array.isArray(rawCoords)) continue;

    const refHz = midiNoteTo12tetHz(refNote);
    const octave = Math.floor((note.note - refNote) / 12);
    const jiHz = getJiFrequency(scaleIndex, octave, marker.config, refHz);
    const { midiNote, signedBend } = findBestMidiNoteForFrequency(
      jiHz,
      note.note,
      pbRange,
    );
    const bend14 = signedBendTo14bit(signedBend);
    const playCh = pickPlayChannel(note.channel, bend14, note.start, note.end);
    const id = note.id != null ? note.id : `${note.start}:${note.channel}:${note.note}`;
    noteRetunes[id] = { note: midiNote, channel: playCh, bend: bend14 };
  }

  // Timeline bends from note onsets (play channel).
  /** @type {Map<number, number>} */
  const channelState = new Map();
  const pitchBends = [];
  const byStart = [...sorted].sort(
    (a, b) => a.start - b.start || a.channel - b.channel || a.note - b.note,
  );
  for (const note of byStart) {
    const id = note.id != null ? note.id : `${note.start}:${note.channel}:${note.note}`;
    const rt = noteRetunes[id];
    if (!rt) continue;
    const prev = channelState.has(rt.channel) ? channelState.get(rt.channel) : PB_CENTER;
    if (prev !== rt.bend) {
      pitchBends.push({ tick: note.start, channel: rt.channel, value: rt.bend });
      channelState.set(rt.channel, rt.bend);
    }
  }
  pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  return { pitchBends, noteRetunes };
}

/**
 * Build per-channel pitchwheel events from marker palettes.
 * @returns {{tick:number, channel:number, value:number}[]} 14-bit unsigned bends
 */
export function buildPitchBendsFromMarkers(notes, markers, options = {}) {
  return buildJiRetunePlan(notes, markers, options).pitchBends;
}
