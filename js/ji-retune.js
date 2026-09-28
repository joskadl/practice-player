/**
 * Lightweight Just Intonation retune from JustPlay marker palettes.
 * Matches core/ji_engine.py frequency + pitch-bend math (5-/7-limit Tonnetz).
 */

const SEPTIMAL_RATIO = 7 / 4;
const PB_CENTER = 8192;

export function midiNoteTo12tetHz(midiNote) {
  return 440 * 2 ** ((midiNote - 69) / 12);
}

function unpackCoords(coords) {
  if (!coords || !coords.length) return [0, 0, 0];
  if (coords.length === 2) return [coords[0] | 0, coords[1] | 0, 0];
  return [coords[0] | 0, coords[1] | 0, coords[2] | 0];
}

function jiCoordsToFrequencyRatio(coords) {
  const [fifths, thirds, septimals] = unpackCoords(coords);
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
  const coords = config[scaleIndex % 12] || [0, 0];
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

/**
 * Build per-channel pitchwheel events from marker palettes (no FileModeResolver).
 * @returns {{tick:number, channel:number, value:number}[]} 14-bit unsigned bends
 */
export function buildPitchBendsFromMarkers(notes, markers, options = {}) {
  const fileRef = options.refNote ?? 60;
  const pbRange = options.pitchBendRange ?? 2;
  if (!notes?.length || !markers?.length) return [];

  const sorted = [...notes].sort(
    (a, b) => a.start - b.start || a.channel - b.channel || a.note - b.note,
  );

  /** @type {Map<number, number>} channel → last 14-bit value */
  const channelState = new Map();
  const events = [];

  for (const note of sorted) {
    const marker = markerAtTick(markers, note.start);
    let signed = 0;
    if (marker && !marker.bypass && marker.config?.length >= 12) {
      const refNote =
        marker.metadata?.refNote != null ? marker.metadata.refNote | 0 : fileRef;
      const refHz = midiNoteTo12tetHz(refNote);
      const scaleIndex = ((note.note - refNote) % 12 + 12) % 12;
      const octave = Math.floor((note.note - refNote) / 12);
      const jiHz = getJiFrequency(scaleIndex, octave, marker.config, refHz);
      signed = calculatePitchBendValue(jiHz, note.note, pbRange);
    }
    const value = signedBendTo14bit(signed);
    const prev = channelState.has(note.channel)
      ? channelState.get(note.channel)
      : PB_CENTER;
    if (prev !== value) {
      events.push({ tick: note.start, channel: note.channel, value });
      channelState.set(note.channel, value);
    }
  }

  events.sort((a, b) => a.tick - b.tick || a.channel - b.channel);
  return events;
}
