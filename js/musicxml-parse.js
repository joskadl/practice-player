/**
 * MusicXML (score-partwise) → practice-player project notes / voices.
 * Enough for playback + mute/solo; not a full MusicXML engraver.
 * JustPlay JI markers are read from identification/miscellaneous fields
 * (``justplay-ji-file`` / ``justplay-ji-markers``) for shared XML with JustPlay.
 */

import { buildJiRetunePlan } from "./ji-retune.js";

const STEP_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const JI_FILE_FIELD = "justplay-ji-file";
const JI_MARKERS_FIELD = "justplay-ji-markers";

function channelForPartIndex(index) {
  // Skip GM drum channel 9.
  let ch = index;
  if (ch >= 9) ch += 1;
  return Math.min(15, ch);
}

function text(el, name) {
  const child = el?.getElementsByTagName(name)?.[0];
  return child?.textContent?.trim() ?? "";
}

function num(el, name, fallback = 0) {
  const t = text(el, name);
  if (t === "") return fallback;
  const n = Number(t);
  return Number.isFinite(n) ? n : fallback;
}

function pitchToMidi(noteEl) {
  const pitch = noteEl.getElementsByTagName("pitch")[0];
  if (!pitch) return null;
  const step = text(pitch, "step").toUpperCase();
  const octave = num(pitch, "octave", 4);
  const alter = num(pitch, "alter", 0);
  const pc = STEP_TO_PC[step];
  if (pc == null) return null;
  return (octave + 1) * 12 + pc + Math.round(alter);
}

/**
 * @param {string} xmlText
 * @returns {object} same general shape as parseMidi() for transport/roll
 */
export function parseMusicXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid MusicXML (parse error)");
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "score-partwise") {
    throw new Error("Only MusicXML score-partwise is supported");
  }

  const partMeta = [];
  const scoreParts = root.getElementsByTagName("score-part");
  for (let i = 0; i < scoreParts.length; i++) {
    const sp = scoreParts[i];
    partMeta.push({
      id: sp.getAttribute("id") || `P${i + 1}`,
      name: text(sp, "part-name") || text(sp, "part-abbreviation") || `Part ${i + 1}`,
    });
  }

  const partEls = [...root.children].filter((el) => el.localName === "part");
  if (!partEls.length) throw new Error("No <part> elements in MusicXML");

  /** @type {Map<string, number>} */
  const partIndexById = new Map();
  partMeta.forEach((p, i) => partIndexById.set(p.id, i));

  const notes = [];
  let noteId = 0;
  let durationTicks = 0;
  const tempoMap = [{ tick: 0, usPerBeat: 500_000 }];
  /** divisions can change; we keep absolute ticks using each measure's divisions */
  let globalTicksPerBeat = 480;

  for (let pi = 0; pi < partEls.length; pi++) {
    const partEl = partEls[pi];
    const partId = partEl.getAttribute("id") || partMeta[pi]?.id || `P${pi + 1}`;
    let partIndex = partIndexById.has(partId) ? partIndexById.get(partId) : pi;
    if (partIndex == null) partIndex = pi;
    const channel = channelForPartIndex(partIndex);
    const voiceId = `ch:${channel}`;

    let absTick = 0;
    let cursor = 0;
    let divisions = 480;
    let beats = 4;
    let beatType = 4;
    let openTies = new Map(); // midi -> {start, velocity, noteId, midi}

    const measures = partEl.getElementsByTagName("measure");
    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];
      const measureStart = absTick;
      cursor = measureStart;

      for (let ci = 0; ci < measure.children.length; ci++) {
        const el = measure.children[ci];
        const tag = el.localName;

        if (tag === "attributes") {
          const d = num(el, "divisions", 0);
          if (d > 0) {
            divisions = d;
            globalTicksPerBeat = d;
          }
          const timeEl = el.getElementsByTagName("time")[0];
          if (timeEl) {
            const b = num(timeEl, "beats", 0);
            const bt = num(timeEl, "beat-type", 0);
            if (b > 0) beats = b;
            if (bt > 0) beatType = bt;
          }
          continue;
        }

        if (tag === "direction") {
          const sound = el.getElementsByTagName("sound")[0];
          const tempo = sound ? Number(sound.getAttribute("tempo")) : NaN;
          if (Number.isFinite(tempo) && tempo > 0) {
            tempoMap.push({ tick: cursor, usPerBeat: Math.round(60_000_000 / tempo) });
          } else {
            const perMin = num(el, "per-minute", 0);
            if (perMin > 0) {
              tempoMap.push({ tick: cursor, usPerBeat: Math.round(60_000_000 / perMin) });
            }
          }
          continue;
        }

        if (tag === "backup") {
          cursor -= num(el, "duration", 0);
          if (cursor < measureStart) cursor = measureStart;
          continue;
        }

        if (tag === "forward") {
          cursor += num(el, "duration", 0);
          continue;
        }

        if (tag !== "note") continue;

        const isChord = el.getElementsByTagName("chord").length > 0;
        const isRest = el.getElementsByTagName("rest").length > 0;
        const isGrace = el.getElementsByTagName("grace").length > 0;
        const dur = isGrace ? 0 : num(el, "duration", 0);
        const start = cursor;

        if (isRest) {
          if (!isChord) cursor += dur;
          durationTicks = Math.max(durationTicks, cursor);
          continue;
        }

        if (isGrace) continue;

        const midi = pitchToMidi(el);
        if (midi == null) {
          if (!isChord) cursor += dur;
          continue;
        }

        const tieEls = el.getElementsByTagName("tie");
        let tieStart = false;
        let tieStop = false;
        for (let ti = 0; ti < tieEls.length; ti++) {
          const type = tieEls[ti].getAttribute("type");
          if (type === "start") tieStart = true;
          if (type === "stop") tieStop = true;
        }

        const velocity = 80;
        if (tieStop && openTies.has(midi)) {
          const open = openTies.get(midi);
          if (tieStart) {
            // Keep the open note alive across the continued tie.
          } else {
            openTies.delete(midi);
            const end = Math.max(open.start + 1, start + dur);
            notes.push({
              id: open.noteId,
              track: partIndex,
              channel,
              voiceId,
              partId,
              note: midi,
              velocity: open.velocity,
              start: open.start,
              end,
            });
            durationTicks = Math.max(durationTicks, end);
          }
        } else if (tieStart) {
          if (!openTies.has(midi)) {
            openTies.set(midi, { start, velocity, noteId: noteId++, midi });
          }
        } else {
          const end = Math.max(start + 1, start + dur);
          notes.push({
            id: noteId++,
            track: partIndex,
            channel,
            voiceId,
            partId,
            note: midi,
            velocity,
            start,
            end,
          });
          durationTicks = Math.max(durationTicks, end);
        }

        if (!isChord) cursor += dur;
      }

      const measureLen = Math.max(1, Math.round(divisions * beats * (4 / beatType)));
      absTick = measureStart + measureLen;
      durationTicks = Math.max(durationTicks, absTick);
    }

    for (const [, open] of openTies) {
      const end = Math.max(open.start + divisions, durationTicks);
      notes.push({
        id: open.noteId,
        track: partIndex,
        channel,
        voiceId: `ch:${channel}`,
        partId,
        note: open.midi,
        velocity: open.velocity,
        start: open.start,
        end,
      });
      durationTicks = Math.max(durationTicks, end);
    }
  }

  notes.sort((a, b) => a.start - b.start || a.end - b.end || a.note - b.note);

  // Deduplicate tempo map
  tempoMap.sort((a, b) => a.tick - b.tick);
  const compactTempo = [];
  for (const entry of tempoMap) {
    if (compactTempo.length && compactTempo[compactTempo.length - 1].tick === entry.tick) {
      compactTempo[compactTempo.length - 1] = entry;
    } else {
      compactTempo.push(entry);
    }
  }

  const partCounts = new Map();
  for (const n of notes) {
    partCounts.set(n.channel, (partCounts.get(n.channel) || 0) + 1);
  }

  const voices = [];
  for (let i = 0; i < Math.max(partMeta.length, partEls.length); i++) {
    const channel = channelForPartIndex(i);
    const meta = partMeta[i] || { id: `P${i + 1}`, name: `Part ${i + 1}` };
    const count = partCounts.get(channel) || 0;
    if (count === 0 && i >= partMeta.length) continue;
    voices.push({
      id: `ch:${channel}`,
      kind: "channel",
      channel,
      track: i,
      partId: meta.id,
      name: meta.name,
      noteCount: count,
    });
  }

  // Drop empty trailing voices but keep named parts with 0 notes if any notes overall
  const voicesOut = voices.filter((v) => v.noteCount > 0);
  for (const n of notes) {
    if (!n.voiceId) n.voiceId = `ch:${n.channel}`;
  }

  const onsetTicks = [];
  let prevOnset = -1;
  for (const n of notes) {
    if (n.start !== prevOnset) {
      onsetTicks.push(n.start);
      prevOnset = n.start;
    }
  }

  if (!notes.length) throw new Error("No notes found in this MusicXML file");

  const { markers, jiFileRefNote, pitchBendRange, justPlayMeta } = readJustPlayJiFromXml(root);
  let pitchBends = [];
  let pitchBendSource = "none";
  let noteRetunes = {};
  const plan = buildJiRetunePlan(notes, markers, {
    refNote: jiFileRefNote ?? 60,
    pitchBendRange,
  });
  pitchBends = plan.pitchBends;
  noteRetunes = plan.noteRetunes;
  if (pitchBends.length) pitchBendSource = "markers";

  return {
    ticksPerBeat: globalTicksPerBeat,
    durationTicks: Math.max(durationTicks, ...notes.map((n) => n.end)),
    tempoMap: compactTempo,
    tracks: voicesOut.map((v, i) => ({
      id: i,
      name: v.name,
      channel: v.channel,
      noteCount: v.noteCount,
    })),
    voices: voicesOut,
    notes,
    markers,
    pitchBends,
    noteRetunes,
    filePitchBends: [],
    pitchBendSource,
    onsetTicks,
    justPlayMeta,
    jiFileRefNote,
    pitchBendRange,
    bendRangeByChannel: {},
    hasPitchBends: pitchBends.length > 0,
    sourceType: "musicxml",
    musicXml: xmlText,
  };
}

function readMiscField(root, name) {
  const identification = [...root.children].find((el) => el.localName === "identification");
  if (!identification) return null;
  const misc = [...identification.children].find((el) => el.localName === "miscellaneous");
  if (!misc) return null;
  for (const field of misc.children) {
    if (field.localName === "miscellaneous-field" && field.getAttribute("name") === name) {
      return field.textContent?.trim() || null;
    }
  }
  return null;
}

function readJustPlayJiFromXml(root) {
  let jiFileRefNote = null;
  let pitchBendRange = 2;
  let justPlayMeta = false;
  const fileRaw = readMiscField(root, JI_FILE_FIELD);
  if (fileRaw) {
    try {
      const data = JSON.parse(fileRaw);
      if (data && typeof data === "object") {
        justPlayMeta = true;
        if (data.refNote != null) jiFileRefNote = Number(data.refNote);
        if (data.pbRange != null) pitchBendRange = Math.max(1, Math.min(96, Number(data.pbRange) || 2));
      }
    } catch {
      /* ignore */
    }
  }
  const markers = [];
  const markersRaw = readMiscField(root, JI_MARKERS_FIELD);
  if (markersRaw) {
    try {
      const list = JSON.parse(markersRaw);
      if (Array.isArray(list)) {
        justPlayMeta = true;
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          const refNote = item.metadata?.refNote ?? item.refNote ?? null;
          const ji = item.metadata?.ji ?? item.ji;
          markers.push({
            tick: Number(item.tick) || 0,
            config: Array.isArray(item.config)
              ? item.config.map((c) => (Array.isArray(c) ? c.map(Number) : null))
              : null,
            name: item.name || "",
            bypass: !!item.bypass,
            mode: item.mode || "tonnetz",
            refNote,
            ji,
            metadata: {
              ...(item.metadata && typeof item.metadata === "object" ? item.metadata : {}),
              ...(refNote != null ? { refNote: Number(refNote) } : {}),
              ...(ji !== undefined ? { ji } : {}),
            },
          });
        }
        markers.sort((a, b) => a.tick - b.tick);
      }
    } catch {
      /* ignore */
    }
  }
  return { markers, jiFileRefNote, pitchBendRange, justPlayMeta };
}

export async function readMusicXmlFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".mxl")) {
    throw new Error("Compressed .mxl is not supported yet — export uncompressed .musicxml from MuseScore");
  }
  return file.text();
}
