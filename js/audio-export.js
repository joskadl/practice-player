/**
 * Offline render of the current project mix to an MP3 download.
 * Uses a headless FluidSynth instance (not the live AudioWorklet synth).
 */

const DEFAULT_PROGRAM = 52;
const SAMPLE_RATE = 44100;
const FRAME = 1024;
const MP3_BLOCK = 1152;
const TAIL_SEC = 1.25;
const PB_CENTER = 8192;

function loadScriptOnce(src) {
  const existing = document.querySelector(`script[data-pp-src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === "1") return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.ppSrc = src;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureExportDeps() {
  await loadScriptOnce("./vendor/libfluidsynth-2.4.6.js");
  await loadScriptOnce("./vendor/js-synthesizer.min.js");
  await loadScriptOnce("./vendor/lame.min.js");
  if (typeof JSSynth === "undefined") throw new Error("js-synthesizer failed to load");
  if (typeof lamejs === "undefined" || typeof lamejs.Mp3Encoder !== "function") {
    throw new Error("MP3 encoder failed to load");
  }
  await JSSynth.waitForReady();
}

function floatToInt16(sample) {
  const x = sample < -1 ? -1 : sample > 1 ? 1 : sample;
  return x < 0 ? (x * 0x8000) | 0 : (x * 0x7fff) | 0;
}

function soundingNote(note, applyJi, noteRetunes) {
  if (!applyJi || !noteRetunes) return note;
  const rt = noteRetunes[note.id];
  if (!rt) return note;
  return { ...note, note: rt.note, channel: rt.channel };
}

/**
 * Build timed MIDI events in playback seconds (tempo-scaled).
 * @param {object} project
 * @param {(voiceId: string) => number} voiceGain
 * @param {boolean} applyJi
 * @param {number} tempoBpm
 */
function buildEvents(project, voiceGain, applyJi, tempoBpm, scoreBpmIn) {
  const fromMap = project.tempoMap?.[0]?.usPerBeat
    ? Math.round(60_000_000 / project.tempoMap[0].usPerBeat)
    : 120;
  const scoreBpm = Math.max(1, scoreBpmIn || fromMap);
  const rate = Math.max(0.05, Math.min(4, (tempoBpm || scoreBpm) / scoreBpm));
  const secAt = (tick) => project.secondsAt(tick) / rate;

  /** @type {{ t: number, kind: string, ch?: number, key?: number, vel?: number, value?: number }[]} */
  const events = [];
  let audibleNotes = 0;

  for (const note of project.notes || []) {
    const g = voiceGain(note.voiceId);
    if (!(g > 0.001)) continue;
    const sn = soundingNote(note, applyJi, project.noteRetunes);
    const vel = Math.max(1, Math.min(127, Math.round((note.velocity || 80) * g)));
    events.push({ t: secAt(note.start), kind: "on", ch: sn.channel & 0x0f, key: sn.note | 0, vel });
    events.push({ t: secAt(note.end), kind: "off", ch: sn.channel & 0x0f, key: sn.note | 0 });
    audibleNotes += 1;
  }

  if (applyJi && project.hasPitchBends && project.pitchBends?.length) {
    for (const pb of project.pitchBends) {
      events.push({
        t: secAt(pb.tick),
        kind: "bend",
        ch: pb.channel & 0x0f,
        value: Math.max(0, Math.min(16383, pb.value | 0)),
      });
    }
  }

  events.sort((a, b) => a.t - b.t || (a.kind === "off" ? -1 : 1) - (b.kind === "off" ? -1 : 1));
  const durationSec = secAt(project.durationTicks || 0) + TAIL_SEC;
  return { events, durationSec, audibleNotes };
}

function applyPrograms(synth, sfontId, project, instrumentValue) {
  const override =
    instrumentValue && instrumentValue !== "score" ? Number(instrumentValue) : null;
  for (let ch = 0; ch < 16; ch++) {
    if (ch === 9) {
      synth.midiSetChannelType(ch, true);
      continue;
    }
    const bank =
      override != null ? 0 : project?.channelBanks?.[ch] != null ? project.channelBanks[ch] : 0;
    const program =
      override != null
        ? Math.max(0, Math.min(127, override | 0))
        : project?.channelPrograms?.[ch] != null
          ? project.channelPrograms[ch]
          : DEFAULT_PROGRAM;
    synth.midiProgramSelect(ch, sfontId, bank, program);
  }
}

function applyPitchBendRange(synth, project) {
  const fallback = Math.max(1, Math.min(96, (project?.pitchBendRange || 2) | 0));
  for (let ch = 0; ch < 16; ch++) {
    if (ch === 9) continue;
    const range =
      project?.bendRangeByChannel?.[ch] != null
        ? Math.max(1, Math.min(96, project.bendRangeByChannel[ch] | 0))
        : fallback;
    synth.midiPitchWheelSensitivity(ch, range);
    synth.midiPitchBend(ch, PB_CENTER);
  }
}

function fireEvent(synth, ev) {
  if (ev.kind === "on") synth.midiNoteOn(ev.ch, ev.key, ev.vel);
  else if (ev.kind === "off") synth.midiNoteOff(ev.ch, ev.key);
  else if (ev.kind === "bend") synth.midiPitchBend(ev.ch, ev.value);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Render the project mix to MP3 and trigger a download.
 *
 * @param {{
 *   project: object,
 *   voiceGain: (voiceId: string) => number,
 *   applyJi: boolean,
 *   instrumentValue: string,
 *   tempoBpm: number,
 *   scoreBpm?: number,
 *   fileBaseName?: string,
 *   onProgress?: (ratio: number) => void,
 * }} opts
 * @returns {Promise<{ filename: string, bytes: number }>}
 */
export async function exportMixToMp3(opts) {
  const {
    project,
    voiceGain,
    applyJi,
    instrumentValue,
    tempoBpm,
    scoreBpm,
    fileBaseName = "practice",
    onProgress,
  } = opts;
  if (!project?.notes?.length) throw new Error("Nothing to export — load a score first.");

  const { events, durationSec, audibleNotes } = buildEvents(
    project,
    voiceGain,
    !!applyJi,
    tempoBpm,
    scoreBpm,
  );
  if (!audibleNotes) {
    throw new Error("All voices are muted — unmute or solo at least one voice, then export.");
  }

  await ensureExportDeps();
  onProgress?.(0.02);

  const synth = new JSSynth.Synthesizer();
  synth.init(SAMPLE_RATE);
  synth.setGain(0.85);

  const sfRes = await fetch("./soundfonts/TimGM6mb.sf2");
  if (!sfRes.ok) throw new Error(`Soundfont load failed (${sfRes.status})`);
  const sfontId = await synth.loadSFont(await sfRes.arrayBuffer());
  applyPrograms(synth, sfontId, project, instrumentValue);
  if (applyJi && project.hasPitchBends) applyPitchBendRange(synth, project);
  else {
    for (let ch = 0; ch < 16; ch++) {
      if (ch === 9) continue;
      synth.midiPitchBend(ch, PB_CENTER);
    }
  }

  const totalSamples = Math.max(FRAME, Math.ceil(durationSec * SAMPLE_RATE));
  const leftF = new Float32Array(FRAME);
  const rightF = new Float32Array(FRAME);
  const encoder = new lamejs.Mp3Encoder(2, SAMPLE_RATE, 192);
  /** @type {Int8Array[]} */
  const mp3Parts = [];

  let pendingL = new Int16Array(MP3_BLOCK * 2);
  let pendingR = new Int16Array(MP3_BLOCK * 2);
  let pending = 0;

  const flushPending = (force = false) => {
    while (pending >= MP3_BLOCK) {
      const chunk = encoder.encodeBuffer(
        pendingL.subarray(0, MP3_BLOCK),
        pendingR.subarray(0, MP3_BLOCK),
      );
      if (chunk.length) mp3Parts.push(chunk);
      pendingL.copyWithin(0, MP3_BLOCK, pending);
      pendingR.copyWithin(0, MP3_BLOCK, pending);
      pending -= MP3_BLOCK;
    }
    if (force && pending > 0) {
      const chunk = encoder.encodeBuffer(
        pendingL.subarray(0, pending),
        pendingR.subarray(0, pending),
      );
      if (chunk.length) mp3Parts.push(chunk);
      pending = 0;
    }
  };

  let eventIdx = 0;
  let sample = 0;
  let lastYield = performance.now();

  while (sample < totalSamples) {
    const frames = Math.min(FRAME, totalSamples - sample);
    const tEnd = (sample + frames) / SAMPLE_RATE;
    while (eventIdx < events.length && events[eventIdx].t <= tEnd + 1e-9) {
      fireEvent(synth, events[eventIdx++]);
    }

    if (frames === FRAME) {
      synth.render([leftF, rightF]);
    } else {
      const l = new Float32Array(frames);
      const r = new Float32Array(frames);
      synth.render([l, r]);
      leftF.set(l);
      rightF.set(r);
    }

    for (let i = 0; i < frames; i++) {
      if (pending >= pendingL.length) {
        const bigger = new Int16Array(pendingL.length * 2);
        bigger.set(pendingL);
        pendingL = bigger;
        const biggerR = new Int16Array(pendingR.length * 2);
        biggerR.set(pendingR);
        pendingR = biggerR;
      }
      pendingL[pending] = floatToInt16(leftF[i]);
      pendingR[pending] = floatToInt16(rightF[i]);
      pending += 1;
    }
    flushPending(false);

    sample += frames;
    const ratio = Math.min(0.97, sample / totalSamples);
    onProgress?.(ratio);

    const now = performance.now();
    if (now - lastYield > 40) {
      lastYield = now;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  try {
    for (let ch = 0; ch < 16; ch++) {
      synth.midiAllNotesOff(ch);
      synth.midiAllSoundsOff(ch);
    }
  } catch {
    /* ignore */
  }

  flushPending(true);
  const tail = encoder.flush();
  if (tail.length) mp3Parts.push(tail);

  try {
    synth.close();
  } catch {
    /* ignore */
  }

  const blob = new Blob(mp3Parts, { type: "audio/mpeg" });
  const safeBase = (fileBaseName || "practice")
    .replace(/\.(musicxml|xml|mid|midi|mp3)$/i, "")
    .replace(/[^\w\-+.() ]+/g, "_")
    .trim() || "practice";
  const tuningTag = applyJi && project.hasPitchBends ? "-ji" : "";
  const filename = `${safeBase}${tuningTag}.mp3`;
  downloadBlob(blob, filename);
  onProgress?.(1);
  return { filename, bytes: blob.size };
}
