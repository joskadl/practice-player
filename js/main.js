import {
  parseMidi,
  tickToSeconds,
  formatTime,
  prevOnsetTick,
  nextOnsetTick,
} from "./midi-parse.js";
import { parseMusicXml, readMusicXmlFile } from "./musicxml-parse.js";
import { ChoirSynth } from "./synth.js";
import { Transport } from "./transport.js";
import { PianoRoll, channelColor } from "./piano-roll.js";
import { SheetView } from "./sheet-view.js";

const els = {
  fileInput: document.getElementById("fileInput"),
  fileName: document.getElementById("fileName"),
  instrumentSelect: document.getElementById("instrumentSelect"),
  status: document.getElementById("status"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  tempoPercent: document.getElementById("tempoPercent"),
  tempoLabel: document.getElementById("tempoLabel"),
  seek: document.getElementById("seek"),
  timeLabel: document.getElementById("timeLabel"),
  durationLabel: document.getElementById("durationLabel"),
  voiceList: document.getElementById("voiceList"),
  emptyVoices: document.getElementById("emptyVoices"),
  soloClearBtn: document.getElementById("soloClearBtn"),
  muteAllBtn: document.getElementById("muteAllBtn"),
  unmuteAllBtn: document.getElementById("unmuteAllBtn"),
  pianoRoll: document.getElementById("pianoRoll"),
  sheetMusic: document.getElementById("sheetMusic"),
  viewRollBtn: document.getElementById("viewRollBtn"),
  viewSheetBtn: document.getElementById("viewSheetBtn"),
  sheetZoomControls: document.getElementById("sheetZoomControls"),
  sheetZoomOutBtn: document.getElementById("sheetZoomOutBtn"),
  sheetZoomInBtn: document.getElementById("sheetZoomInBtn"),
  sheetZoomLabel: document.getElementById("sheetZoomLabel"),
  scoreHeading: document.getElementById("scoreHeading"),
  scoreHint: document.getElementById("scoreHint"),
  accompRow: document.getElementById("accompRow"),
  accompPercent: document.getElementById("accompPercent"),
  accompLabel: document.getElementById("accompLabel"),
  tuningRow: document.getElementById("tuningRow"),
  tuningToggle: document.getElementById("tuningToggle"),
  tuningHint: document.getElementById("tuningHint"),
  tuningModeLabel: document.getElementById("tuningModeLabel"),
};

const synth = new ChoirSynth();
const sheet = new SheetView(els.sheetMusic);
const muted = new Set();
const solo = new Set();
let project = null;
/** @type {"roll"|"sheet"} */
let scoreView = "roll";
/** When JustPlay meta is present: true = apply pitch bends (JI), false = 12-TET center. */
let jiEnabled = true;

/** 0–1 gain for non-soloed voices when any solo is active. */
let accompanimentLevel = 0.25;

function setStatus(msg, isError = false) {
  els.status.textContent = msg || "";
  els.status.classList.toggle("error", !!isError);
}

/** Linear gain for a voice: muted=0, solo focus=1, other under solo=accompaniment. */
function voiceGain(voiceId) {
  if (muted.has(voiceId)) return 0;
  if (solo.size === 0) return 1;
  if (solo.has(voiceId)) return 1;
  return accompanimentLevel;
}

function voiceAudible(voiceId) {
  return voiceGain(voiceId) > 0.001;
}

function noteAudible(note) {
  return voiceAudible(note.voiceId);
}

function noteGain(note) {
  return voiceGain(note.voiceId);
}

function updateAccompUi() {
  const show = solo.size > 0;
  if (els.accompRow) els.accompRow.hidden = !show;
  if (els.accompPercent) {
    els.accompPercent.disabled = !project || !show;
    els.accompPercent.value = String(Math.round(accompanimentLevel * 100));
  }
  if (els.accompLabel) {
    els.accompLabel.textContent = `${Math.round(accompanimentLevel * 100)}%`;
  }
}

function seekTo(tick) {
  transport.seek(tick);
  roll.setPlayhead(transport.playheadTick);
  syncSheetPlayhead(transport.playheadTick, { scroll: true });
  if (project) {
    els.seek.value = String(transport.playheadTick);
    els.timeLabel.textContent = formatTime(project.secondsAt(transport.playheadTick));
  }
}

function syncSheetPlayhead(tick, opts = {}) {
  if (scoreView === "sheet" && sheet.hasScore()) {
    sheet.setPlayhead(tick, opts);
  }
}

function updateSheetZoomLabel() {
  if (!els.sheetZoomLabel) return;
  els.sheetZoomLabel.textContent = `${Math.round(sheet.getZoom() * 100)}%`;
}

function skipOnset(dir) {
  if (!project?.onsetTicks?.length) return;
  const tick = transport.playheadTick;
  const next =
    dir < 0
      ? prevOnsetTick(project.onsetTicks, tick)
      : nextOnsetTick(project.onsetTicks, tick, project.durationTicks);
  const wasPlaying = transport.playing;
  seekTo(next);
  if (!wasPlaying) void auditionOnset(next);
}

async function auditionOnset(tick) {
  if (!project || transport.playing) return;
  try {
    await synth.ensure();
    synth.setProgram(Number(els.instrumentSelect.value));
    if (project.hasPitchBends) {
      synth.setPitchBendRange(project.pitchBendRange, project.bendRangeByChannel);
      transport.setApplyPitchBends(jiEnabled);
    }
    transport.auditionAt(tick);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

const roll = new PianoRoll(els.pianoRoll, {
  isNoteAudible: noteAudible,
  noteGain,
  onSeek: (tick) => seekTo(tick),
});

const transport = new Transport({
  isVoiceAudible: voiceAudible,
  onNoteOn: (n) => {
    const g = voiceGain(n.voiceId);
    if (g <= 0) return;
    synth.noteOn(n.channel, n.note, Math.max(1, Math.round(n.velocity * g)));
  },
  onNoteOff: (n) => synth.noteOff(n.channel, n.note, { force: true }),
  onPitchBend: (ch, value) => synth.pitchBend(ch, value),
  onPanic: () => synth.panic(),
  onTick: (tick) => {
    if (!project) return;
    els.seek.value = String(tick);
    els.timeLabel.textContent = formatTime(project.secondsAt(tick));
    roll.setPlayhead(tick);
    syncSheetPlayhead(tick, { scroll: true });
    const playing = transport.playing;
    els.playBtn.disabled = playing;
    els.pauseBtn.disabled = !playing;
  },
});

function wrapProject(parsed) {
  return {
    ...parsed,
    secondsAt(tick) {
      return tickToSeconds(tick, parsed.tempoMap, parsed.ticksPerBeat);
    },
  };
}

function isMusicXmlName(name) {
  const n = (name || "").toLowerCase();
  return n.endsWith(".musicxml") || n.endsWith(".xml") || n.endsWith(".mxl");
}

function updateScoreViewUi() {
  const hasSheet = !!project?.musicXml;
  els.viewRollBtn.disabled = !project;
  els.viewSheetBtn.disabled = !project || !hasSheet;

  if (project && !hasSheet && scoreView === "sheet") scoreView = "roll";

  const showSheet = scoreView === "sheet" && hasSheet;
  els.pianoRoll.hidden = showSheet;
  els.sheetMusic.hidden = !showSheet;
  if (els.sheetZoomControls) els.sheetZoomControls.hidden = !showSheet;
  els.viewRollBtn.setAttribute("aria-pressed", showSheet ? "false" : "true");
  els.viewSheetBtn.setAttribute("aria-pressed", showSheet ? "true" : "false");
  els.scoreHeading.textContent = showSheet ? "Sheet music" : "Piano roll";
  els.scoreHint.textContent = showSheet
    ? "Red cursor sits on the sounding note onset. Use − / + to zoom. Mute/solo colours mark parts."
    : hasSheet
      ? "Click the timeline to seek. Switch to Sheet music for the score. Mute/solo colours apply in both views."
      : "Click the timeline to seek. Arrow keys skip onsets. Load MusicXML for sheet music.";

  if (!showSheet) {
    roll.draw();
  } else if (sheet.hasScore()) {
    void sheet.revealAndRender().then(() => {
      updateSheetZoomLabel();
      syncSheetPlayhead(transport.playheadTick, { scroll: true });
    });
  }
  updateSheetZoomLabel();
}

function setScoreView(view) {
  scoreView = view;
  updateScoreViewUi();
}

function updateTuningUi() {
  if (!project?.justPlayMeta) {
    els.tuningRow.hidden = true;
    transport.setApplyPitchBends(false);
    return;
  }
  els.tuningRow.hidden = false;
  const canJi = project.hasPitchBends;
  els.tuningToggle.disabled = !canJi;
  if (!canJi) {
    jiEnabled = false;
    els.tuningToggle.checked = false;
    if (els.tuningModeLabel) els.tuningModeLabel.textContent = "Just Intonation";
    els.tuningHint.textContent =
      "JustPlay markers found, but no usable tuning map (empty markers / bypass only).";
    transport.setApplyPitchBends(false);
    return;
  }
  els.tuningToggle.checked = jiEnabled;
  if (els.tuningModeLabel) {
    els.tuningModeLabel.textContent = jiEnabled ? "Just Intonation" : "Standard tuning";
  }
  const sourceHint =
    project.pitchBendSource === "markers"
      ? "from JustPlay markers"
      : project.pitchBendSource === "file"
        ? "from file pitch bends"
        : "";
  els.tuningHint.textContent = jiEnabled
    ? `Just Intonation on — applying pitch bends ${sourceHint} (range ±${project.pitchBendRange} semitones).`
    : "Standard tuning — pitch bends centred (12-TET).";
  transport.setApplyPitchBends(jiEnabled);
}

function renderVoices() {
  els.voiceList.innerHTML = "";
  const voices = project?.voices || [];
  if (!voices.length) {
    els.emptyVoices.hidden = false;
    roll.draw();
    if (sheet.hasScore()) sheet.applyVoiceVisibility();
    return;
  }
  els.emptyVoices.hidden = true;
  for (const voice of voices) {
    const li = document.createElement("li");
    const gain = voiceGain(voice.id);
    if (gain <= 0) li.classList.add("muted");
    else if (solo.size > 0 && !solo.has(voice.id)) li.classList.add("accomp");

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "secondary";
    mute.textContent = muted.has(voice.id) ? "Unmute" : "Mute";
    mute.addEventListener("click", () => {
      if (muted.has(voice.id)) muted.delete(voice.id);
      else muted.add(voice.id);
      renderVoices();
    });

    const soloBtn = document.createElement("button");
    soloBtn.type = "button";
    soloBtn.className = "secondary";
    soloBtn.textContent = solo.has(voice.id) ? "Unsolo" : "Solo";
    soloBtn.addEventListener("click", () => {
      if (solo.has(voice.id)) solo.delete(voice.id);
      else solo.add(voice.id);
      renderVoices();
    });

    const name = document.createElement("div");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = channelColor(voice.channel ?? 0);
    name.append(swatch, document.createTextNode(voice.name));

    const meta = document.createElement("div");
    meta.className = "meta";
    const ch = voice.channel == null ? "—" : `ch ${voice.channel + 1}`;
    meta.textContent = `${ch} · ${voice.noteCount} notes`;

    li.append(mute, soloBtn, name, meta);
    els.voiceList.appendChild(li);
  }
  updateAccompUi();
  transport.resyncAudibility();
  roll.draw();
  if (sheet.hasScore()) sheet.applyVoiceVisibility();
}

function setLoadedUi(enabled) {
  for (const el of [
    els.playBtn,
    els.pauseBtn,
    els.stopBtn,
    els.tempoPercent,
    els.seek,
    els.soloClearBtn,
    els.muteAllBtn,
    els.unmuteAllBtn,
  ]) {
    el.disabled = !enabled;
  }
  els.pauseBtn.disabled = true;
  updateScoreViewUi();
}

async function applyProject(parsed, fileName) {
  project = wrapProject(parsed);
  jiEnabled = !!(parsed.justPlayMeta && parsed.hasPitchBends);
  transport.setProject(project);
  roll.setProject(project);
  els.fileName.textContent = fileName;
  els.seek.max = String(project.durationTicks);
  els.seek.value = "0";
  els.durationLabel.textContent = formatTime(project.secondsAt(project.durationTicks));
  els.timeLabel.textContent = formatTime(0);
  setLoadedUi(true);
  updateTuningUi();

  if (parsed.musicXml) {
    setStatus("Rendering sheet music…");
    await sheet.load(parsed.musicXml, {
      voices: project.voices,
      isVoiceAudible: voiceAudible,
      voiceGain,
      ticksPerBeat: project.ticksPerBeat,
      onsetTicks: project.onsetTicks || [],
    });
    scoreView = "sheet";
    updateSheetZoomLabel();
  } else {
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">Load a MusicXML file to see sheet music here.</p>';
    scoreView = "roll";
  }

  renderVoices();
  updateScoreViewUi();

  const voiceWord = project.voices.length === 1 ? "voice" : "voices";
  let msg = `Loaded ${project.notes.length} notes · ${project.voices.length} ${voiceWord}`;
  if (parsed.sourceType === "musicxml") msg += " · MusicXML";
  else msg += " · MIDI";
  msg += " — ←/→ skip onsets";
  if (parsed.markers?.length) {
    msg += ` · ${parsed.markers.length} JI marker${parsed.markers.length === 1 ? "" : "s"}`;
  }
  if (parsed.pitchBendSource === "markers") {
    msg += ` · JI from markers (${parsed.pitchBends.length} bends)`;
  } else if (parsed.pitchBendSource === "file") {
    msg += ` · ${parsed.pitchBends.length} file pitch bends`;
  }
  setStatus(msg);
}

async function loadFile(file) {
  setStatus(isMusicXmlName(file.name) ? "Reading MusicXML…" : "Reading MIDI…");
  transport.stop();
  muted.clear();
  solo.clear();
  try {
    let parsed;
    if (isMusicXmlName(file.name)) {
      const xmlText = await readMusicXmlFile(file);
      parsed = parseMusicXml(xmlText);
    } else {
      const buffer = await file.arrayBuffer();
      parsed = parseMidi(buffer);
      if (!parsed.notes.length) throw new Error("No notes found in this MIDI file");
    }
    await applyProject(parsed, file.name);
  } catch (err) {
    project = null;
    transport.setProject(null);
    roll.setProject(null);
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">Load a MusicXML file to see sheet music here.</p>';
    setLoadedUi(false);
    updateTuningUi();
    renderVoices();
    updateScoreViewUi();
    setStatus(err?.message || String(err), true);
  }
}

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) void loadFile(file);
});

els.viewRollBtn.addEventListener("click", () => setScoreView("roll"));
els.viewSheetBtn.addEventListener("click", () => {
  if (project?.musicXml) setScoreView("sheet");
});

els.sheetZoomOutBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(-0.1);
  updateSheetZoomLabel();
});
els.sheetZoomInBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(0.1);
  updateSheetZoomLabel();
});

els.instrumentSelect.addEventListener("change", () => {
  synth.setProgram(Number(els.instrumentSelect.value));
});

els.tuningToggle.addEventListener("change", () => {
  jiEnabled = !!els.tuningToggle.checked;
  updateTuningUi();
});

els.playBtn.addEventListener("click", async () => {
  if (!project) return;
  try {
    setStatus("Loading soundfont (first time may take a few seconds)…");
    await synth.ensure();
    synth.setProgram(Number(els.instrumentSelect.value));
    synth.setPitchBendRange(project.pitchBendRange, project.bendRangeByChannel);
    transport.setApplyPitchBends(jiEnabled && project.hasPitchBends);
    transport.play();
    setStatus("Playing — ←/→ previous/next onset");
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
});

els.pauseBtn.addEventListener("click", () => {
  transport.pause();
  setStatus("Paused");
});

els.stopBtn.addEventListener("click", () => {
  transport.stop();
  synth.panic();
  setStatus("Stopped");
});

els.accompPercent?.addEventListener("input", () => {
  accompanimentLevel = Math.max(0, Math.min(1, Number(els.accompPercent.value) / 100));
  updateAccompUi();
  transport.resyncAudibility();
  roll.draw();
  if (sheet.hasScore()) sheet.applyVoiceVisibility();
});

els.tempoPercent.addEventListener("input", () => {
  const pct = Number(els.tempoPercent.value);
  els.tempoLabel.textContent = `${pct}%`;
  transport.setTempoPercent(pct);
});

els.seek.addEventListener("input", () => {
  seekTo(Number(els.seek.value));
});

els.soloClearBtn.addEventListener("click", () => {
  solo.clear();
  renderVoices();
});

els.muteAllBtn.addEventListener("click", () => {
  if (!project) return;
  for (const v of project.voices) muted.add(v.id);
  renderVoices();
});

els.unmuteAllBtn.addEventListener("click", () => {
  muted.clear();
  renderVoices();
});

document.addEventListener("keydown", (ev) => {
  if (!project) return;
  const tag = (ev.target && ev.target.tagName) || "";
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    skipOnset(-1);
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    skipOnset(1);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    transport.pause();
    synth.panic();
    setStatus("Silenced");
  } else if (ev.key === " " && !ev.repeat) {
    ev.preventDefault();
    if (transport.playing) {
      transport.pause();
      setStatus("Paused");
    } else {
      els.playBtn.click();
    }
  }
});

// Kill hanging voices when the tab is backgrounded or closed.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") synth.panic();
});
window.addEventListener("pagehide", () => synth.panic());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline install is best-effort */
    });
  });
}

setLoadedUi(false);
updateTuningUi();
updateScoreViewUi();
updateAccompUi();
roll.draw();
setStatus("Ready — open a MIDI or MusicXML file to begin.");
