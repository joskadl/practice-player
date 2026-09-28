import {
  parseMidi,
  tickToSeconds,
  formatTime,
  prevOnsetTick,
  nextOnsetTick,
} from "./midi-parse.js";
import { parseMusicXml, readMusicXmlFile } from "./musicxml-parse.js";
import {
  readMusicXmlMeta,
  downloadMusicXml,
  applyMusicXmlEdits,
} from "./musicxml-edit.js";
import { ChoirSynth } from "./synth.js";
import { Transport } from "./transport.js";
import { PianoRoll, channelColor } from "./piano-roll.js";
import { SheetView } from "./sheet-view.js";
import { APP_VERSION_LABEL } from "./version.js";
import {
  downloadPack,
  parsePracticePack,
  comparePacks,
  newId,
} from "./practice-pack.js";
import {
  defaultSyncSettings,
  loadSyncSettings,
  saveSyncSettings,
} from "./local-store.js";
import { pullRemote, pushRemote, syncConfigured } from "./sync-remote.js";
import { ProjectSession } from "./project-session.js";

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
  sheetStaffLinesBtn: document.getElementById("sheetStaffLinesBtn"),
  sheetSaveBtn: document.getElementById("sheetSaveBtn"),
  scoreHeading: document.getElementById("scoreHeading"),
  scoreHint: document.getElementById("scoreHint"),
  accompRow: document.getElementById("accompRow"),
  accompPercent: document.getElementById("accompPercent"),
  accompLabel: document.getElementById("accompLabel"),
  tuningRow: document.getElementById("tuningRow"),
  tuningToggle: document.getElementById("tuningToggle"),
  tuningHint: document.getElementById("tuningHint"),
  tuningModeLabel: document.getElementById("tuningModeLabel"),
  installBtn: document.getElementById("installBtn"),
  appVersion: document.getElementById("appVersion"),
  syncPanel: document.getElementById("syncPanel"),
  syncStatus: document.getElementById("syncStatus"),
  syncUndoBtn: document.getElementById("syncUndoBtn"),
  syncPullBtn: document.getElementById("syncPullBtn"),
  syncPushBtn: document.getElementById("syncPushBtn"),
  syncExportBtn: document.getElementById("syncExportBtn"),
  syncImportInput: document.getElementById("syncImportInput"),
  syncSettingsToggle: document.getElementById("syncSettingsToggle"),
  syncSettings: document.getElementById("syncSettings"),
  syncAuthorInput: document.getElementById("syncAuthorInput"),
  ghOwner: document.getElementById("ghOwner"),
  ghRepo: document.getElementById("ghRepo"),
  ghPath: document.getElementById("ghPath"),
  ghBranch: document.getElementById("ghBranch"),
  ghToken: document.getElementById("ghToken"),
  remoteUrl: document.getElementById("remoteUrl"),
  syncSettingsSave: document.getElementById("syncSettingsSave"),
  notesList: document.getElementById("notesList"),
  noteInput: document.getElementById("noteInput"),
  noteAddBtn: document.getElementById("noteAddBtn"),
  historyList: document.getElementById("historyList"),
};

const synth = new ChoirSynth();
const sheet = new SheetView(els.sheetMusic);
const session = new ProjectSession();
/** @type {ReturnType<typeof defaultSyncSettings>} */
let syncSettings = defaultSyncSettings();
/** @type {Map<string, string>} voiceId → hex */
const voiceColors = new Map();

sheet.onDirtyChange = (dirty) => {
  if (els.sheetSaveBtn) els.sheetSaveBtn.hidden = !dirty;
  void persistSessionSnapshot();
  updateSyncUi();
};
sheet.onPartRename = (partId, name) => {
  if (!project?.voices) return;
  for (const voice of project.voices) {
    if (voice.partId === partId) voice.name = name;
  }
  renderVoices();
  void recordSharedEdit(`Renamed part ${partId} → ${name}`);
};

function applyVoiceRename(voice, nextName) {
  const name = String(nextName || "").trim();
  if (!name || name === voice.name) return;
  voice.name = name;
  if (voice.partId && project?.musicXml) {
    sheet.renamePart(voice.partId, name, { notify: false });
  }
  renderVoices();
  void recordSharedEdit(`Renamed voice → ${name}`);
}

function collectCurrentEdits() {
  if (project?.musicXml) {
    try {
      return sheet.getEdits();
    } catch {
      /* fall through */
    }
  }
  const voiceColorsObj = {};
  for (const voice of project?.voices || []) {
    if (voice.partId && voiceColors.has(voice.id)) {
      voiceColorsObj[voice.partId] = voiceColors.get(voice.id);
    }
  }
  return {
    title: "",
    parts: (project?.voices || []).map((v) => ({
      id: v.partId || v.id,
      name: v.name,
    })),
    staffLines: sheet.showStaffLines ? 5 : 0,
    voiceColors: voiceColorsObj,
  };
}

function snapshotIntoPack(pack) {
  const edits = collectCurrentEdits();
  pack.edits = edits;
  pack.title = edits.title || pack.title || sourceFileName || "";
  pack.sourceFileName = sourceFileName || pack.sourceFileName || "";
  pack.musicXml = project?.musicXml
    ? sheet.dirty
      ? sheet.buildEditedXml()
      : project.musicXml
    : pack.musicXml || "";
  pack.notes = Array.isArray(pack.notes) ? pack.notes : [];
}

async function persistSessionSnapshot() {
  if (!session.hasPack() || !project) return;
  try {
    await session.autosaveFields({
      musicXml: project.musicXml
        ? sheet.dirty
          ? sheet.buildEditedXml()
          : project.musicXml
        : "",
      edits: collectCurrentEdits(),
      title: collectCurrentEdits().title || sourceFileName,
      sourceFileName,
      notes: session.pack?.notes || [],
    });
  } catch {
    /* ignore autosave errors */
  }
}

async function recordSharedEdit(summary) {
  if (!session.hasPack()) return;
  try {
    await session.commit(summary, (pack) => snapshotIntoPack(pack), syncSettings.author);
    renderNotes();
    renderHistory();
    updateSyncUi();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function updateSyncUi() {
  const active = !!project?.musicXml && session.hasPack();
  if (els.syncPanel) els.syncPanel.hidden = !project;
  const depth = active ? await session.undoCount() : 0;
  if (els.syncUndoBtn) els.syncUndoBtn.disabled = !active || depth <= 0;
  if (els.syncExportBtn) els.syncExportBtn.disabled = !active;
  if (els.noteInput) els.noteInput.disabled = !active;
  if (els.noteAddBtn) els.noteAddBtn.disabled = !active;
  const remoteOk = syncConfigured(syncSettings);
  if (els.syncPullBtn) els.syncPullBtn.disabled = !active || !remoteOk;
  if (els.syncPushBtn) els.syncPushBtn.disabled = !active || !remoteOk || !session.needsPush();
  if (els.syncStatus) {
    if (!project) {
      els.syncStatus.textContent = "Load a MusicXML score to enable shared notes and sync.";
    } else if (!project.musicXml) {
      els.syncStatus.textContent =
        "Shared sync needs MusicXML (MIDI-only files stay local on this device).";
    } else if (!session.pack) {
      els.syncStatus.textContent = "Preparing shared project…";
    } else {
      const pending = session.needsPush() ? " · local changes to push" : " · in sync";
      const net = navigator.onLine ? "online" : "offline";
      els.syncStatus.textContent = `${session.pack.title || "Project"} · r${session.pack.rev} · ${net}${pending}`;
    }
  }
}

function renderNotes() {
  if (!els.notesList) return;
  els.notesList.innerHTML = "";
  const notes = session.pack?.notes || [];
  if (!notes.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hint">No rehearsal notes yet.</span>`;
    els.notesList.appendChild(li);
    return;
  }
  for (const note of [...notes].reverse()) {
    const li = document.createElement("li");
    const body = document.createElement("div");
    body.textContent = note.text;
    const meta = document.createElement("span");
    meta.className = "note-meta";
    const when = note.updatedAt ? new Date(note.updatedAt).toLocaleString() : "";
    meta.textContent = [note.author, when].filter(Boolean).join(" · ");
    body.appendChild(meta);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "secondary";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      void session
        .commit(
          "Deleted note",
          (pack) => {
            snapshotIntoPack(pack);
            pack.notes = (pack.notes || []).filter((n) => n.id !== note.id);
          },
          syncSettings.author,
        )
        .then(() => {
          renderNotes();
          renderHistory();
          updateSyncUi();
        })
        .catch((err) => setStatus(err?.message || String(err), true));
    });
    li.append(body, del);
    els.notesList.appendChild(li);
  }
}

function renderHistory() {
  if (!els.historyList) return;
  els.historyList.innerHTML = "";
  const hist = [...(session.pack?.history || [])].reverse();
  for (const h of hist.slice(0, 20)) {
    const li = document.createElement("li");
    const when = h.at ? new Date(h.at).toLocaleString() : "";
    li.textContent = `r${h.rev} — ${h.summary}${h.author ? ` (${h.author})` : ""}${when ? ` · ${when}` : ""}`;
    els.historyList.appendChild(li);
  }
}

function fillSyncSettingsForm() {
  if (els.syncAuthorInput) els.syncAuthorInput.value = syncSettings.author || "";
  if (els.ghOwner) els.ghOwner.value = syncSettings.githubOwner || "";
  if (els.ghRepo) els.ghRepo.value = syncSettings.githubRepo || "";
  if (els.ghPath) els.ghPath.value = syncSettings.githubPath || "shared/";
  if (els.ghBranch) els.ghBranch.value = syncSettings.githubBranch || "main";
  if (els.ghToken) els.ghToken.value = syncSettings.githubToken || "";
  if (els.remoteUrl) els.remoteUrl.value = syncSettings.remoteUrl || "";
}

async function readSyncSettingsFromForm() {
  syncSettings = {
    author: els.syncAuthorInput?.value.trim() || "",
    githubOwner: els.ghOwner?.value.trim() || "",
    githubRepo: els.ghRepo?.value.trim() || "",
    githubPath: els.ghPath?.value.trim() || "shared/",
    githubBranch: els.ghBranch?.value.trim() || "main",
    githubToken: els.ghToken?.value.trim() || "",
    remoteUrl: els.remoteUrl?.value.trim() || "",
  };
  await saveSyncSettings(syncSettings);
  updateSyncUi();
}

async function applyPackToPlayer(pack, { remoteSha = null, clearUndoStack = true } = {}) {
  if (!pack.musicXml) throw new Error("Practice pack has no MusicXML payload");
  const nextXml = applyMusicXmlEdits(pack.musicXml, pack.edits || {});
  const parsed = parseMusicXml(nextXml);
  parsed.musicXml = nextXml;
  await applyProject(parsed, pack.sourceFileName || "shared.musicxml", {
    skipSessionStart: true,
  });
  await session.loadFromPack(pack, { remoteSha, clearUndoStack });
  renderNotes();
  renderHistory();
  updateSyncUi();
}
sheet.voiceColor = (voice) => resolveVoiceColor(voice);

const muted = new Set();
const solo = new Set();
let project = null;
/** @type {"roll"|"sheet"} */
let scoreView = "roll";
/** When JustPlay meta is present: true = apply pitch bends (JI), false = 12-TET center. */
let jiEnabled = true;
/** Original loaded file name (for export naming). */
let sourceFileName = "";
/** Deferred PWA install prompt from the browser. */
let deferredInstall = null;

/** 0–1 gain for non-soloed voices when any solo is active. */
let accompanimentLevel = 0.25;

function resolveVoiceColor(voiceLike) {
  const channel = voiceLike?.channel ?? 0;
  const id = voiceLike?.id;
  if (id && voiceColors.has(id)) return voiceColors.get(id);
  const partId = voiceLike?.partId;
  if (partId) {
    const fromSheet = sheet.getPartColor?.(partId);
    if (fromSheet) return fromSheet;
  }
  return channelColor(channel);
}

function noteColor(note) {
  const voice = project?.voices?.find((v) => v.id === note.voiceId);
  return resolveVoiceColor(voice || { id: note.voiceId, channel: note.channel });
}

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

function updateSheetToolbar() {
  if (els.sheetStaffLinesBtn) {
    els.sheetStaffLinesBtn.setAttribute(
      "aria-pressed",
      sheet.showStaffLines ? "true" : "false",
    );
    els.sheetStaffLinesBtn.title = sheet.showStaffLines
      ? "Hide staff lines"
      : "Show staff lines";
  }
  if (els.sheetSaveBtn) els.sheetSaveBtn.hidden = !sheet.dirty;
}

function exportBaseName() {
  const base = (sourceFileName || "score").replace(/\.(musicxml|xml|mid|midi)$/i, "");
  return `${base || "score"}-edited.musicxml`;
}

async function saveSheetEdits() {
  if (!project?.musicXml || !sheet.dirty) return;
  try {
    const nextXml = sheet.buildEditedXml();
    downloadMusicXml(nextXml, exportBaseName());
    project.musicXml = nextXml;
    const meta = readMusicXmlMeta(nextXml);
    for (const voice of project.voices) {
      const part = meta.parts.find((p) => p.id === voice.partId);
      if (part) voice.name = part.name;
    }
    sheet.markSaved(nextXml);
    sheet.showStaffLines = meta.staffLines !== 0;
    await sheet.reloadXml(nextXml, {
      voices: project.voices,
      isVoiceAudible: voiceAudible,
      voiceGain,
      ticksPerBeat: project.ticksPerBeat,
      onsetTicks: project.onsetTicks || [],
    });
    renderVoices();
    updateSheetToolbar();
    setStatus(`Saved ${exportBaseName()}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
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
  noteColor,
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
    ? "Click title or stave names to edit · save icon appears when changed"
    : hasSheet
      ? "Click the timeline to seek. Switch to Sheet music for the score. Mute/solo colours apply in both views."
      : "Click the timeline to seek. Arrow keys skip onsets. Load MusicXML for sheet music.";
  updateSheetToolbar();

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
    name.className = "voice-name";
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.title = "Change voice colour";
    swatch.setAttribute("aria-label", `Colour for ${voice.name}`);
    swatch.style.background = resolveVoiceColor(voice);
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = normalizeHex(resolveVoiceColor(voice));
    picker.hidden = true;
    swatch.addEventListener("click", (ev) => {
      ev.stopPropagation();
      picker.click();
    });
    picker.addEventListener("change", () => {
      const hex = picker.value;
      voiceColors.set(voice.id, hex);
      if (voice.partId && project?.musicXml) sheet.setPartColor(voice.partId, hex);
      swatch.style.background = hex;
      roll.draw();
      if (sheet.hasScore()) sheet.applyVoiceVisibility();
      void recordSharedEdit(`Colour ${voice.name}`);
    });
    picker.addEventListener("input", () => {
      const hex = picker.value;
      voiceColors.set(voice.id, hex);
      swatch.style.background = hex;
      roll.draw();
      if (sheet.hasScore()) sheet.applyVoiceVisibility();
    });

    const label = document.createElement("button");
    label.type = "button";
    label.className = "voice-name-label";
    label.textContent = voice.name;
    label.title = "Click to rename";
    label.addEventListener("click", () => beginVoiceNameEdit(voice, label, name));

    name.append(swatch, picker, label);

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

function normalizeHex(color) {
  const c = String(color || "#888888").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1];
    const g = c[2];
    const b = c[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#888888";
}

function beginVoiceNameEdit(voice, labelEl, nameRow) {
  if (nameRow.querySelector("input.voice-name-input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "voice-name-input";
  input.value = voice.name;
  input.setAttribute("aria-label", "Rename voice");
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) applyVoiceRename(voice, input.value);
    else renderVoices();
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function setLoadedUi(enabled) {
  for (const el of [els.playBtn, els.pauseBtn, els.stopBtn, els.tempoPercent, els.seek, els.muteAllBtn, els.unmuteAllBtn]) {
    el.disabled = !enabled;
  }
  els.pauseBtn.disabled = true;
  updateScoreViewUi();
}

async function applyProject(parsed, fileName, opts = {}) {
  project = wrapProject(parsed);
  sourceFileName = fileName || "";
  voiceColors.clear();
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
    try {
      const meta = readMusicXmlMeta(parsed.musicXml);
      sheet.showStaffLines = meta.staffLines !== 0;
      for (const voice of project.voices) {
        const hex = voice.partId ? meta.voiceColors?.[voice.partId] : null;
        if (hex) voiceColors.set(voice.id, hex);
      }
    } catch {
      sheet.showStaffLines = true;
    }
    await sheet.load(parsed.musicXml, {
      voices: project.voices,
      isVoiceAudible: voiceAudible,
      voiceGain,
      ticksPerBeat: project.ticksPerBeat,
      onsetTicks: project.onsetTicks || [],
    });
    sheet.markSaved(parsed.musicXml);
    const colorSeed = {};
    for (const voice of project.voices) {
      if (voice.partId && voiceColors.has(voice.id)) {
        colorSeed[voice.partId] = voiceColors.get(voice.id);
      }
    }
    sheet.seedColors(colorSeed);
    scoreView = "sheet";
    updateSheetZoomLabel();
    updateSheetToolbar();
  } else {
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">Load a MusicXML file to see sheet music here.</p>';
    scoreView = "roll";
  }

  renderVoices();
  updateScoreViewUi();

  if (!opts.skipSessionStart) {
    if (parsed.musicXml) {
      await session.startFromScore({
        musicXml: parsed.musicXml,
        sourceFileName,
        edits: collectCurrentEdits(),
        title: collectCurrentEdits().title || sourceFileName,
        author: syncSettings.author,
        notes: [],
      });
    } else {
      session.pack = null;
    }
  }
  renderNotes();
  renderHistory();
  updateSyncUi();

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
    sourceFileName = "";
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

els.sheetStaffLinesBtn?.addEventListener("click", () => {
  void sheet.setShowStaffLines(!sheet.showStaffLines).then(() => {
    updateSheetToolbar();
    void recordSharedEdit(sheet.showStaffLines ? "Show staff lines" : "Hide staff lines");
  });
});

els.sheetSaveBtn?.addEventListener("click", () => {
  void saveSheetEdits();
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

els.muteAllBtn.addEventListener("click", () => {
  if (!project) return;
  solo.clear();
  for (const v of project.voices) muted.add(v.id);
  renderVoices();
});

els.unmuteAllBtn.addEventListener("click", () => {
  muted.clear();
  solo.clear();
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
  if (document.visibilityState === "hidden") {
    synth.panic();
    void persistSessionSnapshot();
  }
});
window.addEventListener("pagehide", () => {
  synth.panic();
  void persistSessionSnapshot();
});

window.addEventListener("beforeunload", (ev) => {
  if (!sheet.dirty && !session.needsPush()) return;
  ev.preventDefault();
  ev.returnValue = "";
});

window.addEventListener("online", () => updateSyncUi());
window.addEventListener("offline", () => updateSyncUi());

els.syncSettingsToggle?.addEventListener("click", () => {
  if (!els.syncSettings) return;
  els.syncSettings.hidden = !els.syncSettings.hidden;
});

els.syncSettingsSave?.addEventListener("click", () => {
  void readSyncSettingsFromForm().then(() => setStatus("Sync settings saved on this device."));
});

els.syncExportBtn?.addEventListener("click", async () => {
  if (!session.pack) return;
  await persistSessionSnapshot();
  snapshotIntoPack(session.pack);
  downloadPack(session.pack, sourceFileName || "score");
  setStatus("Exported practice pack");
});

els.syncImportInput?.addEventListener("change", async () => {
  const file = els.syncImportInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const pack = parsePracticePack(text);
    await applyPackToPlayer(pack);
    setStatus(`Imported pack r${pack.rev}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    els.syncImportInput.value = "";
  }
});

els.syncUndoBtn?.addEventListener("click", async () => {
  try {
    const prev = await session.undo();
    if (!prev) return;
    await applyPackToPlayer(prev, {
      remoteSha: session.remoteSha,
      clearUndoStack: false,
    });
    setStatus(`Undo → r${prev.rev}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
});

els.syncPullBtn?.addEventListener("click", async () => {
  if (!session.pack) return;
  try {
    setStatus("Pulling…");
    const remote = await pullRemote(syncSettings, session.pack.id);
    if (!remote?.pack) {
      setStatus("Nothing on remote yet — Push to create it.");
      return;
    }
    const action = comparePacks(session.pack, remote.pack);
    if (action === "same") {
      session.remoteSha = remote.sha || session.remoteSha;
      session.markSynced({ sha: remote.sha });
      await session.persist();
      updateSyncUi();
      setStatus("Already up to date with remote.");
      return;
    }
    if ((action === "push-local" || action === "conflict") && session.needsPush()) {
      const ok = confirm(
        "Local has unpushed changes. Pulling replaces this device with the remote pack. Export a backup first if unsure. Continue?",
      );
      if (!ok) {
        setStatus("Pull cancelled.");
        return;
      }
    }
    await applyPackToPlayer(remote.pack, { remoteSha: remote.sha || null });
    session.markSynced({ sha: remote.sha || null });
    await session.persist();
    updateSyncUi();
    setStatus(`Pulled r${remote.pack.rev}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
});

els.syncPushBtn?.addEventListener("click", async () => {
  if (!session.pack) return;
  try {
    if (!navigator.onLine) {
      setStatus("You're offline — changes stay on this device until you can Push.", true);
      return;
    }
    await persistSessionSnapshot();
    snapshotIntoPack(session.pack);
    await session.persist();
    if (!session.remoteSha) {
      try {
        const existing = await pullRemote(syncSettings, session.pack.id);
        if (existing?.sha) session.remoteSha = existing.sha;
      } catch {
        /* create new file */
      }
    }
    setStatus("Pushing…");
    const result = await pushRemote(syncSettings, session.pack, {
      sha: session.remoteSha || undefined,
      message: `practice: ${session.pack.title || session.pack.id} r${session.pack.rev}`,
    });
    session.markSynced({ sha: result.sha || session.remoteSha });
    await session.persist();
    updateSyncUi();
    setStatus(`Pushed r${session.pack.rev}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
});

els.noteAddBtn?.addEventListener("click", () => {
  const text = els.noteInput?.value.trim();
  if (!text || !session.pack) return;
  void session
    .commit(
      "Added note",
      (pack) => {
        snapshotIntoPack(pack);
        pack.notes = [
          ...(pack.notes || []),
          {
            id: newId("note"),
            text,
            author: syncSettings.author || "",
            updatedAt: new Date().toISOString(),
            tick: transport.playheadTick || null,
          },
        ];
      },
      syncSettings.author,
    )
    .then(() => {
      if (els.noteInput) els.noteInput.value = "";
      renderNotes();
      renderHistory();
      updateSyncUi();
    })
    .catch((err) => setStatus(err?.message || String(err), true));
});

els.noteInput?.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    els.noteAddBtn?.click();
  }
});

window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  deferredInstall = ev;
  if (els.installBtn) els.installBtn.hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  if (els.installBtn) els.installBtn.hidden = true;
  setStatus("Installed — available offline from your home screen / app list.");
});

els.installBtn?.addEventListener("click", async () => {
  if (deferredInstall) {
    deferredInstall.prompt();
    try {
      await deferredInstall.userChoice;
    } catch {
      /* ignore */
    }
    deferredInstall = null;
    if (els.installBtn) els.installBtn.hidden = true;
    return;
  }
  // Safari / browsers without beforeinstallprompt: guide the user.
  setStatus(
    "To install: use your browser’s Share / menu → Add to Home Screen (or Install app).",
  );
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline install is best-effort */
    });
  });
}

if (els.appVersion) els.appVersion.textContent = APP_VERSION_LABEL;

void loadSyncSettings().then((s) => {
  syncSettings = s;
  fillSyncSettingsForm();
  updateSyncUi();
});

// Show install affordance even when beforeinstallprompt never fires (e.g. Safari).
if (els.installBtn) {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // @ts-expect-error iOS Safari
    window.navigator.standalone === true;
  if (!isStandalone) els.installBtn.hidden = false;
}

setLoadedUi(false);
updateTuningUi();
updateScoreViewUi();
updateAccompUi();
updateSyncUi();
roll.draw();
setStatus("Ready — open a MIDI or MusicXML file to begin.");
