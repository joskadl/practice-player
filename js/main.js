import {
  parseMidi,
  tickToSeconds,
  formatTime,
  prevOnsetTick,
  nextOnsetTick,
} from "./midi-parse.js";
import { parseMusicXml } from "./musicxml-parse.js";
import {
  fetchExampleAsMusicXml,
  isScoreXmlName,
  readScoreFileAsMusicXml,
} from "./score-import.js";
import {
  readMusicXmlMeta,
  downloadMusicXml,
  applyMusicXmlEdits,
  transposeMusicXml,
  readRecordingUrl,
  writeRecordingUrl,
  stripPersonalNames,
  readRemarks,
  writeRemarks,
  readHomeKey,
  readScoreKey,
  writeHomeKey,
  ensureKeyMetadata,
  keyCenterOptions,
  semitoneDelta,
} from "./musicxml-edit.js";
import { ChoirSynth } from "./synth.js";
import { Transport } from "./transport.js";
import { PianoRoll, channelColor } from "./piano-roll.js";
import { SheetView } from "./sheet-view.js";
import { ExamplePrerenderCache } from "./example-prerender.js";
import { APP_VERSION_LABEL } from "./version.js";
import {
  checkForAppUpdate,
  consumeJustUpdatedLabel,
  watchServiceWorkerLifecycle,
  applyAppUpdate,
  dismissUpdatePrompt,
  formatVersionLabel,
  scrubUpdateQueryParam,
} from "./app-update.js";
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
import { initI18n, t, onLangChange, applyDomI18n } from "./i18n.js";
import { exportMixToMp3 } from "./audio-export.js";

initI18n();

const EYE_ICON =
  '<svg class="voice-vis-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>';
const EYE_SLASH_ICON =
  '<svg class="voice-vis-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3.3 2.2 2.2 3.3l3.1 3.1C3.4 8 1.8 9.8 1 12c1.7 3.9 6 7 11 7 1.7 0 3.3-.4 4.7-1l3 3 1.1-1.1L3.3 2.2zM12 17c-3.7 0-6.9-2-8.5-5 .7-1.4 1.9-2.7 3.4-3.6l1.7 1.7A5 5 0 0 0 12 17zm0-10c3.7 0 6.9 2 8.5 5-.5 1-1.2 1.9-2.1 2.7l1.5 1.5c1.3-1.2 2.3-2.6 2.9-4.2-1.7-3.9-6-7-11-7-1.2 0-2.3.2-3.4.5l1.6 1.6c.6-.1 1.2-.1 1.8-.1zm-1.1 4.3 2.8 2.8a2.5 2.5 0 0 1-2.8-2.8z"/></svg>';

const els = {
  fileInput: document.getElementById("fileInput"),
  openMenuWrap: document.getElementById("openMenuWrap"),
  openMenuBtn: document.getElementById("openMenuBtn"),
  openMenu: document.getElementById("openMenu"),
  openDeviceBtn: document.getElementById("openDeviceBtn"),
  examplesList: document.getElementById("examplesList"),
  fileName: document.getElementById("fileName"),
  recordingLink: document.getElementById("recordingLink"),
  recordingEditBtn: document.getElementById("recordingEditBtn"),
  instrumentSelect: document.getElementById("instrumentSelect"),
  status: document.getElementById("status"),
  playBtn: document.getElementById("playBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  stopBtn: document.getElementById("stopBtn"),
  tempoBpm: document.getElementById("tempoBpm"),
  tempoLabel: document.getElementById("tempoLabel"),
  seek: document.getElementById("seek"),
  timeLabel: document.getElementById("timeLabel"),
  durationLabel: document.getElementById("durationLabel"),
  voiceList: document.getElementById("voiceList"),
  emptyVoices: document.getElementById("emptyVoices"),
  muteAllBtn: document.getElementById("muteAllBtn"),
  unmuteAllBtn: document.getElementById("unmuteAllBtn"),
  exportMp3Btn: document.getElementById("exportMp3Btn"),
  pianoRoll: document.getElementById("pianoRoll"),
  sheetMusic: document.getElementById("sheetMusic"),
  scorePanel: document.getElementById("scorePanel"),
  busyOverlay: document.getElementById("busyOverlay"),
  busyLabel: document.getElementById("busyLabel"),
  remarksRow: document.getElementById("remarksRow"),
  remarksInput: document.getElementById("remarksInput"),
  viewRollBtn: document.getElementById("viewRollBtn"),
  viewSheetBtn: document.getElementById("viewSheetBtn"),
  sheetZoomControls: document.getElementById("sheetZoomControls"),
  sheetZoomOutBtn: document.getElementById("sheetZoomOutBtn"),
  sheetZoomInBtn: document.getElementById("sheetZoomInBtn"),
  sheetZoomLabel: document.getElementById("sheetZoomLabel"),
  sheetPdfBtn: document.getElementById("sheetPdfBtn"),
  keyCenterSelect: document.getElementById("keyCenterSelect"),
  sheetFullscreenBtn: document.getElementById("sheetFullscreenBtn"),
  sheetStage: document.getElementById("sheetStage"),
  sheetFsPlayBtn: document.getElementById("sheetFsPlayBtn"),
  sheetFsPauseBtn: document.getElementById("sheetFsPauseBtn"),
  sheetFsStopBtn: document.getElementById("sheetFsStopBtn"),
  sheetFsZoomOutBtn: document.getElementById("sheetFsZoomOutBtn"),
  sheetFsZoomInBtn: document.getElementById("sheetFsZoomInBtn"),
  sheetSaveBtn: document.getElementById("sheetSaveBtn"),
  sheetAnnotBar: document.getElementById("sheetAnnotBar"),
  viewModeScore: document.getElementById("viewModeScore"),
  viewModeLyrics: document.getElementById("viewModeLyrics"),
  viewModeCustom: document.getElementById("viewModeCustom"),
  sheetLayerCustom: document.getElementById("sheetLayerCustom"),
  layerStavesBtn: document.getElementById("layerStavesBtn"),
  layerLyricsBtn: document.getElementById("layerLyricsBtn"),
  layerChordsBtn: document.getElementById("layerChordsBtn"),
  layerNotesBtn: document.getElementById("layerNotesBtn"),
  addChordBtn: document.getElementById("addChordBtn"),
  addNoteBtn: document.getElementById("addNoteBtn"),
  scoreHeading: document.getElementById("scoreHeading"),
  accompRow: document.getElementById("accompRow"),
  accompPercent: document.getElementById("accompPercent"),
  accompLabel: document.getElementById("accompLabel"),
  tuningRow: document.getElementById("tuningRow"),
  tuningToggle: document.getElementById("tuningToggle"),
  tuningModeLabel: document.getElementById("tuningModeLabel"),
  installBtn: document.getElementById("installBtn"),
  appVersion: document.getElementById("appVersion"),
  updateBanner: document.getElementById("updateBanner"),
  updateBannerText: document.getElementById("updateBannerText"),
  updateNowBtn: document.getElementById("updateNowBtn"),
  updateLaterBtn: document.getElementById("updateLaterBtn"),
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

const exampleCache = new ExamplePrerenderCache({
  getLayoutWidth: () => {
    const w = els.sheetMusic?.clientWidth || 0;
    if (w > 32) return w;
    return (
      els.sheetMusic?.parentElement?.clientWidth
      || els.scorePanel?.clientWidth
      || Math.min(720, window.innerWidth - 32)
      || 480
    );
  },
  getZoom: () => sheet.getZoom(),
});
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
sheet.onZoomChange = () => {
  updateSheetZoomLabel();
  // Pre-renders are zoom-specific — rebuild offscreen copies in idle time.
  exampleCache.scheduleRewarm();
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
  pack.musicXml = project?.musicXml ? currentMusicXml() : pack.musicXml || "";
  pack.notes = Array.isArray(pack.notes) ? pack.notes : [];
}

async function persistSessionSnapshot() {
  if (!session.hasPack() || !project) return;
  try {
    await session.autosaveFields({
      musicXml: project.musicXml ? currentMusicXml() : "",
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
  if (els.syncPanel) els.syncPanel.hidden = true;
  const depth = active ? await session.undoCount() : 0;
  if (els.syncUndoBtn) els.syncUndoBtn.disabled = !active || depth <= 0;
  if (els.syncExportBtn) els.syncExportBtn.disabled = !active;
  if (els.noteInput) els.noteInput.disabled = !active;
  if (els.noteAddBtn) els.noteAddBtn.disabled = !active;
  const remoteOk = syncConfigured(syncSettings);
  if (els.syncPullBtn) els.syncPullBtn.disabled = !active || !remoteOk;
  if (els.syncPushBtn) els.syncPushBtn.disabled = !active || !remoteOk || !session.needsPush();
  if (els.syncStatus) {
    if (!project?.musicXml || !session.pack) {
      els.syncStatus.hidden = true;
      els.syncStatus.textContent = "";
      if (els.syncPanel) {
        els.syncPanel.title = !project
          ? t("syncStatusLoad")
          : !project.musicXml
            ? t("syncStatusLoad")
            : "";
      }
    } else {
      els.syncStatus.hidden = false;
      const pending = session.needsPush() ? " · …" : "";
      const net = navigator.onLine ? "online" : "offline";
      els.syncStatus.textContent = `${session.pack.title || "Project"} · r${session.pack.rev} · ${net}${pending}`;
      if (els.syncPanel) els.syncPanel.title = "";
    }
  }
}

function renderNotes() {
  if (!els.notesList) return;
  els.notesList.innerHTML = "";
  const notes = session.pack?.notes || [];
  if (!notes.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="hint">${t("noRehearsalNotes")}</span>`;
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
    del.textContent = t("delete");
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
  fillSyncSettingsForm();
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
sheet.onSeek = (tick) => seekTo(tick);
sheet.onLayersChange = (layers) => syncAnnotBar(layers);
sheet.onAnnotModeChange = (mode) => syncAnnotModeButtons(mode);
sheet.onXmlMutated = async (xml, label) => {
  if (!project) return;
  project.musicXml = xml;
  await sheet.reloadXml(xml, {
    voices: project.voices,
    isVoiceAudible: voiceAudible,
    voiceGain,
    isVoiceVisible: voiceVisible,
    ticksPerBeat: project.ticksPerBeat,
    onsetTicks: project.onsetTicks || [],
  });
  sheet.markDirty();
  updateSheetToolbar();
  syncAnnotBar(sheet.getLayers());
  if (label) void recordSharedEdit(label);
};

const muted = new Set();
const solo = new Set();
/** Voices hidden from piano roll + sheet (audio still follows mute/solo). */
const hiddenVoices = new Set();
let project = null;
/** @type {"roll"|"sheet"} */
let scoreView = "roll";
/** When JustPlay meta is present: true = apply pitch bends (JI), false = 12-TET center. */
let jiEnabled = false;
/** Cached examples catalog from examples/manifest.json (null until first fetch). */
let examplesCatalog = null;
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
  if (!isError && busyStack.length) els.status.classList.add("is-busy");
  else if (!busyStack.length) els.status.classList.remove("is-busy");
}

/** @type {string[]} */
const busyStack = [];

function applyBusyUi() {
  const busy = busyStack.length > 0;
  const label = busy ? busyStack[busyStack.length - 1] : "";
  document.body.classList.toggle("is-busy", busy);
  if (els.scorePanel) {
    els.scorePanel.classList.toggle("is-busy", busy);
    els.scorePanel.setAttribute("aria-busy", busy ? "true" : "false");
  }
  if (els.busyOverlay) els.busyOverlay.hidden = !busy;
  if (els.busyLabel && label) els.busyLabel.textContent = label;
  if (busy) {
    els.status.classList.add("is-busy");
    if (label) setStatus(label);
  } else {
    els.status.classList.remove("is-busy");
  }
}

/** Show loading chrome for slow navigation / render work. */
function beginBusy(message) {
  busyStack.push(message || t("busyWorking"));
  applyBusyUi();
}

function endBusy() {
  busyStack.pop();
  applyBusyUi();
}

/** Update the current busy label without nesting another busy frame. */
function updateBusy(message) {
  if (!busyStack.length) {
    beginBusy(message);
    return;
  }
  busyStack[busyStack.length - 1] = message || t("busyWorking");
  applyBusyUi();
}

async function withBusy(message, fn) {
  beginBusy(message);
  try {
    return await fn();
  } finally {
    endBusy();
  }
}

function showSheetLoadingPlaceholder(message) {
  sheet.clear();
  const text = message || t("busyRenderingSheet");
  if (els.sheetMusic) {
    els.sheetMusic.innerHTML = `<p class="hint sheet-placeholder sheet-loading">${text}</p>`;
  }
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

function voiceVisible(voiceId) {
  return !hiddenVoices.has(voiceId);
}

function noteAudible(note) {
  return voiceAudible(note.voiceId);
}

function noteVisible(note) {
  return voiceVisible(note.voiceId);
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
  lastSheetOnsetTick = -1;
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
  if (els.sheetSaveBtn) els.sheetSaveBtn.hidden = !sheet.dirty;
  syncKeyCenterSelect();
}

/** @type {boolean} */
let keyCenterSelectSilent = false;

function syncKeyCenterSelect() {
  const sel = els.keyCenterSelect;
  if (!sel) return;
  const xml = project?.musicXml ? currentMusicXml() : "";
  const home = xml ? readHomeKey(xml) : null;
  const current = xml ? readScoreKey(xml) : null;
  const mode = home?.mode || current?.mode || "major";
  const preferFlat = (current?.fifths ?? 0) < 0;
  const options = keyCenterOptions(mode, preferFlat);
  const selectedPc = current?.pc ?? home?.pc;

  keyCenterSelectSilent = true;
  sel.innerHTML = "";
  if (!project?.musicXml || selectedPc == null) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    sel.appendChild(opt);
    sel.disabled = true;
    keyCenterSelectSilent = false;
    return;
  }
  for (const k of options) {
    const opt = document.createElement("option");
    opt.value = String(k.pc);
    const isHome = home != null && k.pc === home.pc && k.mode === home.mode;
    opt.textContent = isHome ? t("modulateOriginal", { key: k.label }) : k.label;
    if (isHome) opt.dataset.homeKey = "1";
    if (k.pc === selectedPc) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.disabled = false;
  keyCenterSelectSilent = false;
}

async function modulateToKeyCenter(targetPc) {
  if (!project?.musicXml || targetPc == null || !Number.isFinite(targetPc)) return;
  try {
    const base = currentMusicXml();
    const stamped = ensureKeyMetadata(base);
    const current = readScoreKey(stamped);
    if (!current) throw new Error("Could not read the score key signature");
    const delta = semitoneDelta(current.pc, targetPc, current.mode);
    if (!delta) {
      syncKeyCenterSelect();
      return;
    }
    let next = transposeMusicXml(stamped, delta);
    // Keep the original home key stable across modulations.
    const home = readHomeKey(stamped);
    if (home?.label) next = writeHomeKey(next, home.label);
    const after = readScoreKey(next);
    await applyMutatedMusicXml(next, {
      label: `Key → ${after?.label || targetPc}`,
      dirty: true,
    });
    setStatus(t("modulateDone", { key: after?.label || String(targetPc) }));
  } catch (err) {
    setStatus(err?.message || String(err), true);
    syncKeyCenterSelect();
  }
}

function currentMusicXml() {
  if (!project?.musicXml) return "";
  try {
    const base = sheet.dirty ? sheet.buildEditedXml() : project.musicXml;
    return writeRemarks(base, els.remarksInput?.value || "");
  } catch {
    return project.musicXml;
  }
}

function updateRemarksUi(xmlText) {
  const hasScore = !!project?.musicXml;
  if (els.remarksRow) els.remarksRow.hidden = !hasScore;
  if (!els.remarksInput) return;
  if (!hasScore) {
    els.remarksInput.value = "";
    return;
  }
  const xml = xmlText || project.musicXml || "";
  els.remarksInput.value = xml ? readRemarks(xml) : "";
}

function hostLabel(url) {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return t("recordingLink");
  }
}

function updateRecordingUi(xmlText) {
  const xml = xmlText || project?.musicXml || "";
  const url = xml ? readRecordingUrl(xml) : "";
  const hasScore = !!project?.musicXml;
  if (els.recordingEditBtn) els.recordingEditBtn.hidden = !hasScore;
  if (!els.recordingLink) return;
  if (!url) {
    els.recordingLink.hidden = true;
    els.recordingLink.removeAttribute("href");
    els.recordingLink.textContent = "";
    return;
  }
  els.recordingLink.hidden = false;
  els.recordingLink.href = url;
  els.recordingLink.textContent = hostLabel(url);
  els.recordingLink.title = t("recordingLinkTip");
}

/**
 * Re-parse MusicXML into the live project (sheet + playback) after an XML mutation.
 * @param {string} xml
 * @param {{label?: string, dirty?: boolean}} [opts]
 */
async function applyMutatedMusicXml(xml, opts = {}) {
  if (!project) return;
  const playhead = transport.playheadTick | 0;
  const wasPlaying = transport.playing;
  if (wasPlaying) transport.pause();

  const mutedParts = new Set();
  const soloParts = new Set();
  const hiddenParts = new Set();
  for (const v of project.voices || []) {
    if (muted.has(v.id) && v.partId) mutedParts.add(v.partId);
    if (solo.has(v.id) && v.partId) soloParts.add(v.partId);
    if (hiddenVoices.has(v.id) && v.partId) hiddenParts.add(v.partId);
  }
  const colorByPart = new Map();
  for (const v of project.voices || []) {
    if (v.partId && voiceColors.has(v.id)) colorByPart.set(v.partId, voiceColors.get(v.id));
  }

  const parsed = parseMusicXml(xml);
  parsed.musicXml = xml;
  project = wrapProject(parsed);
  muted.clear();
  solo.clear();
  hiddenVoices.clear();
  voiceColors.clear();
  for (const v of project.voices) {
    if (v.partId && mutedParts.has(v.partId)) muted.add(v.id);
    if (v.partId && soloParts.has(v.partId)) solo.add(v.id);
    if (v.partId && hiddenParts.has(v.partId)) hiddenVoices.add(v.id);
    if (v.partId && colorByPart.has(v.partId)) voiceColors.set(v.id, colorByPart.get(v.partId));
  }

  transport.setProject(project);
  roll.setProject(project);
  els.seek.max = String(project.durationTicks);
  els.durationLabel.textContent = formatTime(project.secondsAt(project.durationTicks));
  updateTuningUi();

  showSheetLoadingPlaceholder(t("busyUpdatingScore"));
  await withBusy(t("busyUpdatingScore"), async () => {
    await sheet.reloadXml(xml, {
      voices: project.voices,
      isVoiceAudible: voiceAudible,
      voiceGain,
      isVoiceVisible: voiceVisible,
      ticksPerBeat: project.ticksPerBeat,
      onsetTicks: project.onsetTicks || [],
    });
  });
  if (opts.dirty !== false) sheet.markDirty();
  else sheet.markSaved(xml);

  const tick = Math.max(0, Math.min(playhead, project.durationTicks | 0));
  seekTo(tick);
  renderVoices();
  updateSheetToolbar();
  updateRecordingUi(xml);
  updateRemarksUi(xml);
  viewModeUi = detectViewMode(sheet.getLayers());
  syncAnnotBar(sheet.getLayers());
  if (opts.label) void recordSharedEdit(opts.label);
}

async function editRecordingUrl() {
  if (!project?.musicXml) return;
  const current = readRecordingUrl(currentMusicXml());
  const next = window.prompt(t("recordingPrompt"), current || "");
  if (next == null) return;
  try {
    const xml = writeRecordingUrl(currentMusicXml(), next);
    await applyMutatedMusicXml(xml, {
      label: next.trim() ? "Set recording URL" : "Clear recording URL",
      dirty: true,
    });
    setStatus(next.trim() ? t("recordingLink") : "");
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

const VIEW_LAYER_PRESETS = {
  score: { staves: true, lyrics: true, chords: true, notes: true },
  lyrics: { staves: false, lyrics: true, chords: false, notes: false },
};

/** @type {"score"|"lyrics"|"custom"} */
let viewModeUi = "score";

/**
 * @param {{staves?:boolean, lyrics?:boolean, chords?:boolean, notes?:boolean}} layers
 * @returns {"score"|"lyrics"|"custom"}
 */
function detectViewMode(layers) {
  const L = layers || {};
  const on = (k, v) => (L[k] !== false) === v;
  for (const [name, preset] of Object.entries(VIEW_LAYER_PRESETS)) {
    if (
      on("staves", preset.staves)
      && on("lyrics", preset.lyrics)
      && on("chords", preset.chords)
      && on("notes", preset.notes)
    ) {
      return /** @type {"score"|"lyrics"} */ (name);
    }
  }
  return "custom";
}

function syncAnnotBar(layers) {
  const L = layers || sheet.getLayers?.() || {};
  const map = [
    [els.layerStavesBtn, L.staves !== false],
    [els.layerLyricsBtn, L.lyrics !== false],
    [els.layerChordsBtn, L.chords !== false],
    [els.layerNotesBtn, L.notes !== false],
  ];
  for (const [btn, on] of map) {
    if (!btn) continue;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  const derived = detectViewMode(L);
  // Preset buttons own the mode; layer toggles force Custom. Otherwise follow layers.
  if (viewModeUi !== "custom") {
    viewModeUi = derived;
  }

  const modeBtns = [
    [els.viewModeScore, "score"],
    [els.viewModeLyrics, "lyrics"],
    [els.viewModeCustom, "custom"],
  ];
  for (const [btn, mode] of modeBtns) {
    if (!btn) continue;
    btn.setAttribute("aria-checked", viewModeUi === mode ? "true" : "false");
  }
  if (els.sheetLayerCustom) {
    els.sheetLayerCustom.hidden = viewModeUi !== "custom";
  }
}

/**
 * @param {"score"|"lyrics"|"custom"} mode
 */
function setViewMode(mode) {
  if (!sheet.hasScore()) return;
  if (mode === "custom") {
    viewModeUi = "custom";
    syncAnnotBar(sheet.getLayers());
    return;
  }
  const preset = VIEW_LAYER_PRESETS[mode];
  if (!preset) return;
  viewModeUi = mode;
  void sheet.setLayers({ ...preset });
}

function wireLayerToggle(btn, key) {
  btn?.addEventListener("click", () => {
    if (!sheet.hasScore()) return;
    viewModeUi = "custom";
    const cur = sheet.getLayers();
    void sheet.setLayers({ [key]: !cur[key] });
  });
}

function wireViewModeButton(btn, mode) {
  btn?.addEventListener("click", () => setViewMode(mode));
}

function syncAnnotModeButtons(mode) {
  if (els.addChordBtn) els.addChordBtn.setAttribute("aria-pressed", mode === "chord" ? "true" : "false");
  if (els.addNoteBtn) els.addNoteBtn.setAttribute("aria-pressed", mode === "note" ? "true" : "false");
}

function exportBaseName() {
  const base = (sourceFileName || "score").replace(/\.(musicxml|xml|mid|midi)$/i, "");
  return `${base || "score"}-edited.musicxml`;
}

async function saveSheetEdits() {
  if (!project?.musicXml || !sheet.dirty) return;
  try {
    const nextXml = writeRemarks(sheet.buildEditedXml(), els.remarksInput?.value || "");
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
      isVoiceVisible: voiceVisible,
      ticksPerBeat: project.ticksPerBeat,
      onsetTicks: project.onsetTicks || [],
    });
    renderVoices();
    updateSheetToolbar();
    updateRemarksUi(nextXml);
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
    applyInstrumentSelection();
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
  isNoteVisible: noteVisible,
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
    // Sheet cursor is onset-based — skip DOM work between notes (keeps audio steady).
    if (scoreView === "sheet" && sheet.hasScore()) {
      const onset = prevOnsetTick(project.onsetTicks || [0], tick + 1);
      if (onset !== lastSheetOnsetTick) {
        lastSheetOnsetTick = onset;
        syncSheetPlayhead(tick, { scroll: true });
      }
    }
    const playing = transport.playing;
    els.playBtn.disabled = playing;
    els.pauseBtn.disabled = !playing;
    syncFullscreenChrome();
  },
});

/** Last sheet onset rendered while playing — avoid per-tick OSMD work. */
let lastSheetOnsetTick = -1;

function applyInstrumentSelection() {
  const value = els.instrumentSelect?.value;
  if (!value || value === "score") {
    synth.setChannelPrograms(project?.channelPrograms || {}, project?.channelBanks || {});
  } else {
    synth.setUniformProgram(Number(value));
  }
}

function syncTempoUi() {
  if (!els.tempoBpm) return;
  els.tempoBpm.value = String(transport.tempoBpm | 0);
  if (els.tempoLabel) els.tempoLabel.textContent = "BPM";
}

function wrapProject(parsed) {
  return {
    ...parsed,
    secondsAt(tick) {
      return tickToSeconds(tick, parsed.tempoMap, parsed.ticksPerBeat);
    },
  };
}

function isMusicXmlName(name) {
  return isScoreXmlName(name);
}

function updateScoreViewUi() {
  const hasSheet = !!project?.musicXml;
  els.viewRollBtn.disabled = !project;
  els.viewSheetBtn.disabled = !project || !hasSheet;

  if (project && !hasSheet && scoreView === "sheet") scoreView = "roll";

  const showSheet = scoreView === "sheet" && hasSheet;
  els.pianoRoll.hidden = showSheet;
  if (els.sheetStage) els.sheetStage.hidden = !showSheet;
  if (els.sheetMusic) els.sheetMusic.hidden = false;
  if (els.sheetZoomControls) els.sheetZoomControls.hidden = !showSheet;
  if (els.sheetAnnotBar) els.sheetAnnotBar.hidden = !showSheet;
  if (els.sheetFullscreenBtn) els.sheetFullscreenBtn.disabled = !showSheet;
  els.viewRollBtn.setAttribute("aria-pressed", showSheet ? "false" : "true");
  els.viewSheetBtn.setAttribute("aria-pressed", showSheet ? "true" : "false");
  els.scoreHeading.textContent = showSheet ? t("sheetMusic") : t(hasSheet ? "pianoRoll" : "score");
  const scorePanel = els.pianoRoll?.closest(".score-panel");
  if (scorePanel) scorePanel.title = t("scoreTip");
  updateSheetToolbar();
  if (showSheet) syncAnnotBar(sheet.getLayers?.());
  syncFullscreenChrome();

  if (!showSheet) {
    if (isSheetFullscreen()) void exitSheetFullscreen();
    roll.draw();
  }
  updateSheetZoomLabel();
}

async function setScoreView(view) {
  scoreView = view;
  updateScoreViewUi();
  if (view !== "sheet" || !project?.musicXml) return;
  if (!sheet.hasScore()) {
    showSheetLoadingPlaceholder(t("busyRenderingSheet"));
    await withBusy(t("busyRenderingSheet"), async () => {
      await sheet.load(project.musicXml, {
        voices: project.voices,
        isVoiceAudible: voiceAudible,
        voiceGain,
        isVoiceVisible: voiceVisible,
        ticksPerBeat: project.ticksPerBeat,
        onsetTicks: project.onsetTicks || [],
        playheadTick: transport.playheadTick,
      });
      updateSheetZoomLabel();
      syncSheetPlayhead(transport.playheadTick, { scroll: true });
    });
    return;
  }
  await withBusy(t("busyRenderingSheet"), async () => {
    await sheet.revealAndRender();
    updateSheetZoomLabel();
    syncSheetPlayhead(transport.playheadTick, { scroll: true });
  });
}

function fullscreenElement() {
  return (
    document.fullscreenElement
    || document.webkitFullscreenElement
    || null
  );
}

function isSheetFullscreen() {
  const stage = els.sheetStage;
  if (!stage) return false;
  return fullscreenElement() === stage;
}

function syncFullscreenChrome() {
  const active = isSheetFullscreen();
  document.body.classList.toggle("sheet-fullscreen-active", active);
  if (els.sheetFullscreenBtn) {
    els.sheetFullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
    els.sheetFullscreenBtn.title = t(active ? "exitFullscreenTip" : "fullscreenTip");
    els.sheetFullscreenBtn.setAttribute("aria-label", t(active ? "exitFullscreen" : "fullscreen"));
    const enterIcon = els.sheetFullscreenBtn.querySelector(".sheet-fs-icon-enter");
    const exitIcon = els.sheetFullscreenBtn.querySelector(".sheet-fs-icon-exit");
    if (enterIcon) enterIcon.hidden = active;
    if (exitIcon) exitIcon.hidden = !active;
  }
  if (els.sheetFsPlayBtn) els.sheetFsPlayBtn.disabled = !!els.playBtn?.disabled;
  if (els.sheetFsPauseBtn) els.sheetFsPauseBtn.disabled = !!els.pauseBtn?.disabled;
  if (els.sheetFsStopBtn) els.sheetFsStopBtn.disabled = !!els.stopBtn?.disabled;
}

async function enterSheetFullscreen() {
  const stage = els.sheetStage;
  if (!stage || stage.hidden) return;
  try {
    if (stage.requestFullscreen) await stage.requestFullscreen();
    else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
  } catch (err) {
    setStatus(err?.message || String(err), true);
  }
}

async function exitSheetFullscreen() {
  if (!fullscreenElement()) {
    syncFullscreenChrome();
    return;
  }
  try {
    if (document.exitFullscreen) await document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  } catch {
    /* ignore */
  }
}

async function toggleSheetFullscreen() {
  if (isSheetFullscreen()) await exitSheetFullscreen();
  else await enterSheetFullscreen();
}

async function onSheetFullscreenChange() {
  syncFullscreenChrome();
  if (!isSheetFullscreen() && scoreView !== "sheet") return;
  if (!sheet.hasScore()) return;
  // Let the browser finish layout before OSMD measures the new viewport.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await withBusy(t("busyRenderingSheet"), async () => {
      await sheet.revealAndRender();
      updateSheetZoomLabel();
      syncSheetPlayhead(transport.playheadTick, { scroll: true });
    });
  } catch {
    /* ignore */
  }
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
  const tipEl = els.tuningRow;
  if (!canJi) {
    jiEnabled = false;
    els.tuningToggle.checked = false;
    if (els.tuningModeLabel) els.tuningModeLabel.textContent = t("tuningStandard");
    if (tipEl) tipEl.title = t("tuningTipEmpty");
    transport.setApplyPitchBends(false);
    return;
  }
  els.tuningToggle.checked = jiEnabled;
  if (els.tuningModeLabel) {
    els.tuningModeLabel.textContent = jiEnabled ? t("tuningJi") : t("tuningStandard");
  }
  if (tipEl) {
    tipEl.title = jiEnabled ? t("tuningTipJi") : t("tuningTipStandard");
  }
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
    const isHidden = hiddenVoices.has(voice.id);
    if (gain <= 0) li.classList.add("muted");
    else if (solo.size > 0 && !solo.has(voice.id)) li.classList.add("accomp");
    if (isHidden) li.classList.add("voice-hidden");

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = "secondary";
    mute.textContent = muted.has(voice.id) ? t("unmute") : t("mute");
    mute.addEventListener("click", () => {
      if (muted.has(voice.id)) muted.delete(voice.id);
      else muted.add(voice.id);
      renderVoices();
    });

    const soloBtn = document.createElement("button");
    soloBtn.type = "button";
    soloBtn.className = "secondary";
    soloBtn.textContent = solo.has(voice.id) ? t("unsolo") : t("solo");
    soloBtn.addEventListener("click", () => {
      if (solo.has(voice.id)) solo.delete(voice.id);
      else solo.add(voice.id);
      renderVoices();
    });

    const hideBtn = document.createElement("button");
    hideBtn.type = "button";
    hideBtn.className = "secondary voice-vis-btn";
    hideBtn.title = isHidden ? "Show in roll & sheet" : "Hide from roll & sheet";
    hideBtn.setAttribute("aria-label", isHidden ? `Show ${voice.name}` : `Hide ${voice.name}`);
    hideBtn.setAttribute("aria-pressed", isHidden ? "true" : "false");
    hideBtn.innerHTML = isHidden ? EYE_SLASH_ICON : EYE_ICON;
    hideBtn.addEventListener("click", () => {
      if (hiddenVoices.has(voice.id)) {
        hiddenVoices.delete(voice.id);
      } else {
        hiddenVoices.add(voice.id);
        // Hiding also mutes; Unmute remains available while still hidden.
        muted.add(voice.id);
      }
      renderVoices();
      if (scoreView === "sheet" && sheet.hasScore()) {
        sheet.setPlayhead(transport.playheadTick, { scroll: false });
      }
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
    label.title = t("renameVoice");
    label.addEventListener("click", () => beginVoiceNameEdit(voice, label, name));

    name.append(swatch, picker, label);

    const meta = document.createElement("div");
    meta.className = "meta";
    const ch = voice.channel == null ? "—" : `ch ${voice.channel + 1}`;
    meta.textContent = `${ch} · ${voice.noteCount} notes`;

    li.append(mute, soloBtn, hideBtn, name, meta);
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
  for (const el of [
    els.playBtn,
    els.pauseBtn,
    els.stopBtn,
    els.tempoBpm,
    els.seek,
    els.muteAllBtn,
    els.unmuteAllBtn,
    els.exportMp3Btn,
  ]) {
    if (el) el.disabled = !enabled;
  }
  els.pauseBtn.disabled = true;
  updateScoreViewUi();
  syncFullscreenChrome();
}

async function applyProject(parsed, fileName, opts = {}) {
  if (parsed.musicXml) {
    try {
      parsed.musicXml = ensureKeyMetadata(parsed.musicXml);
    } catch {
      /* keep original XML if metadata stamp fails */
    }
  }
  project = wrapProject(parsed);
  sourceFileName = fileName || "";
  voiceColors.clear();
  hiddenVoices.clear();
  // Prefer 12-TET; users can opt into JI when markers are present.
  jiEnabled = false;
  transport.setProject(project);
  roll.setProject(project);
  lastSheetOnsetTick = -1;
  syncTempoUi();
  // Default to score GM programs when the file provides them.
  if (els.instrumentSelect) {
    const hasScorePrograms = Object.keys(project.channelPrograms || {}).length > 0;
    if (hasScorePrograms) els.instrumentSelect.value = "score";
  }
  applyInstrumentSelection();
  els.fileName.textContent = fileName;
  els.seek.max = String(project.durationTicks);
  els.seek.value = "0";
  els.durationLabel.textContent = formatTime(project.secondsAt(project.durationTicks));
  els.timeLabel.textContent = formatTime(0);
  setLoadedUi(true);
  updateTuningUi();
  updateRecordingUi(parsed.musicXml || "");
  updateRemarksUi(parsed.musicXml || "");

  if (parsed.musicXml) {
    // Show the sheet stage before OSMD measures/renders — a hidden parent
    // yields width 0, which leaves only the green cursor visible on first load.
    scoreView = "sheet";
    updateScoreViewUi();
    const adoptSheet = opts.adoptSheet || null;
    if (!adoptSheet) {
      showSheetLoadingPlaceholder(t("busyRenderingSheet"));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const busyLabel = adoptSheet ? t("busyLoadingSong", { title: fileName }) : t("busyRenderingSheet");
    await withBusy(busyLabel, async () => {
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
      const sheetOpts = {
        voices: project.voices,
        isVoiceAudible: voiceAudible,
        voiceGain,
        isVoiceVisible: voiceVisible,
        ticksPerBeat: project.ticksPerBeat,
        onsetTicks: project.onsetTicks || [],
      };
      let adopted = false;
      if (adoptSheet?.view) {
        adopted = sheet.adoptFrom(adoptSheet.view, sheetOpts);
        try {
          adoptSheet.slot?.remove();
        } catch {
          /* ignore */
        }
      }
      if (!adopted) {
        await sheet.load(parsed.musicXml, sheetOpts);
      }
      sheet.markSaved(parsed.musicXml);
      const colorSeed = {};
      for (const voice of project.voices) {
        if (voice.partId && voiceColors.has(voice.id)) {
          colorSeed[voice.partId] = voiceColors.get(voice.id);
        }
      }
      sheet.seedColors(colorSeed);
      // Reflow once the stage is in the visible layout tree (covers first-load races).
      if (!sheet.hasVisibleScore()) {
        await sheet.revealAndRender();
      }
      updateSheetZoomLabel();
      updateSheetToolbar();
      syncSheetPlayhead(transport.playheadTick, { scroll: true });
    });
  } else {
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">' + t("sheetPlaceholder") + "</p>";
    scoreView = "roll";
    updateRecordingUi("");
    updateRemarksUi("");
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
  const reading = isMusicXmlName(file.name)
    ? (/\.mscz$/i.test(file.name) || /\.mscx$/i.test(file.name)
      ? t("busyConvertingMuseScore")
      : t("busyReadingXml"))
    : t("busyReadingMidi");
  beginBusy(reading);
  showSheetLoadingPlaceholder(reading);
  transport.stop();
  muted.clear();
  solo.clear();
  hiddenVoices.clear();
  try {
    let parsed;
    if (isMusicXmlName(file.name)) {
      const xmlText = await readScoreFileAsMusicXml(file, {
        onProgress: (msg) => {
          updateBusy(msg);
          showSheetLoadingPlaceholder(msg);
        },
      });
      parsed = parseMusicXml(xmlText);
    } else {
      const buffer = await file.arrayBuffer();
      parsed = parseMidi(buffer);
      if (!parsed.notes.length) throw new Error("No notes found in this MIDI file");
    }
    endBusy();
    await applyProject(parsed, file.name);
  } catch (err) {
    endBusy();
    project = null;
    sourceFileName = "";
    transport.setProject(null);
    roll.setProject(null);
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">' + t("sheetPlaceholder") + "</p>";
    setLoadedUi(false);
    updateTuningUi();
    updateRecordingUi("");
    updateRemarksUi("");
    renderVoices();
    updateScoreViewUi();
    setStatus(err?.message || String(err), true);
  }
}

function setOpenMenuOpen(open) {
  if (!els.openMenu || !els.openMenuBtn) return;
  els.openMenu.hidden = !open;
  els.openMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

async function fetchExamplesCatalog({ force = false } = {}) {
  if (examplesCatalog && !force) return examplesCatalog;
  const res = await fetch("./examples/manifest.json", { cache: "no-store" });
  if (!res.ok) throw new Error(t("examplesLoadError"));
  const data = await res.json();
  examplesCatalog = Array.isArray(data?.examples) ? data.examples : [];
  return examplesCatalog;
}

async function populateExamplesMenu() {
  if (!els.examplesList) return;
  els.examplesList.innerHTML = "";
  try {
    // Always revalidate when online so newly published scores appear without
    // waiting for a full app restart (SW serves examples network-first).
    const examples = await fetchExamplesCatalog({ force: navigator.onLine !== false });
    if (!examples.length) {
      const empty = document.createElement("div");
      empty.className = "open-menu-empty";
      empty.textContent = t("examplesEmpty");
      els.examplesList.appendChild(empty);
      return;
    }
    for (const ex of examples) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "open-menu-item";
      btn.setAttribute("role", "menuitem");
      btn.textContent = ex.title || ex.file || ex.id;
      if (ex.description) btn.title = ex.description;
      btn.addEventListener("click", () => {
        setOpenMenuOpen(false);
        void loadExample(ex);
      });
      els.examplesList.appendChild(btn);
    }
  } catch (err) {
    const empty = document.createElement("div");
    empty.className = "open-menu-empty";
    empty.textContent = err?.message || t("examplesLoadError");
    els.examplesList.appendChild(empty);
  }
}

async function loadExample(ex) {
  const file = String(ex.file || "").replace(/^\/+/, "");
  if (!file) return;
  const displayName = ex.title || file;
  const loadingMsg = t("busyLoadingSong", { title: displayName });
  const layoutWidth = exampleCache.getLayoutWidth();
  const preRendered = isMusicXmlName(file)
    ? exampleCache.takeRendered(ex, { width: layoutWidth, zoom: sheet.getZoom() })
    : null;
  const preParsed = !preRendered && isMusicXmlName(file) ? exampleCache.getParsed(ex) : null;

  beginBusy(loadingMsg);
  // Keep the current sheet visible when we can adopt a pre-render (no flash).
  if (!preRendered) showSheetLoadingPlaceholder(loadingMsg);
  transport.stop();
  muted.clear();
  solo.clear();
  hiddenVoices.clear();
  try {
    let parsed;
    /** @type {object|null} */
    let adoptSheet = null;
    if (isMusicXmlName(file)) {
      if (preRendered?.data?.parsed) {
        parsed = preRendered.data.parsed;
        adoptSheet = preRendered;
      } else if (preParsed?.parsed) {
        parsed = preParsed.parsed;
      } else {
        let xmlText = await fetchExampleAsMusicXml(file, {
          preferCache: true,
          onProgress: (msg) => {
            updateBusy(msg);
            showSheetLoadingPlaceholder(msg);
          },
        });
        xmlText = stripPersonalNames(xmlText);
        parsed = parseMusicXml(xmlText);
      }
    } else {
      const res = await fetch(`./examples/${file}`, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Could not load ${file}`);
      const buffer = await res.arrayBuffer();
      parsed = parseMidi(buffer);
      if (!parsed.notes.length) throw new Error("No notes found in this MIDI file");
    }
    endBusy();
    await applyProject(parsed, displayName, { adoptSheet });
    // Refill the offscreen slot we just consumed.
    if (isMusicXmlName(file)) exampleCache.scheduleOne(ex);
  } catch (err) {
    endBusy();
    if (preRendered) {
      try {
        preRendered.view?.clear();
        preRendered.slot?.remove();
      } catch {
        /* ignore */
      }
    }
    project = null;
    sourceFileName = "";
    transport.setProject(null);
    roll.setProject(null);
    sheet.clear();
    els.sheetMusic.innerHTML =
      '<p class="hint sheet-placeholder">' + t("sheetPlaceholder") + "</p>";
    setLoadedUi(false);
    updateTuningUi();
    updateRecordingUi("");
    updateRemarksUi("");
    renderVoices();
    updateScoreViewUi();
    setStatus(err?.message || String(err), true);
  }
}

els.openMenuBtn?.addEventListener("click", () => {
  const willOpen = !!els.openMenu?.hidden;
  setOpenMenuOpen(willOpen);
  if (willOpen) void populateExamplesMenu();
});

els.openDeviceBtn?.addEventListener("click", () => {
  setOpenMenuOpen(false);
  els.fileInput?.click();
});

document.addEventListener("click", (ev) => {
  if (!els.openMenuWrap || els.openMenu?.hidden) return;
  if (els.openMenuWrap.contains(ev.target)) return;
  setOpenMenuOpen(false);
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && els.openMenu && !els.openMenu.hidden) {
    setOpenMenuOpen(false);
  }
});

els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (file) void loadFile(file);
});

els.viewRollBtn.addEventListener("click", () => {
  void setScoreView("roll");
});
els.viewSheetBtn.addEventListener("click", () => {
  if (project?.musicXml) void setScoreView("sheet");
});

els.sheetZoomOutBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(-0.1);
  updateSheetZoomLabel();
});
els.sheetZoomInBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(0.1);
  updateSheetZoomLabel();
});

els.sheetFullscreenBtn?.addEventListener("click", () => {
  void toggleSheetFullscreen();
});
els.sheetFsPlayBtn?.addEventListener("click", () => els.playBtn?.click());
els.sheetFsPauseBtn?.addEventListener("click", () => els.pauseBtn?.click());
els.sheetFsStopBtn?.addEventListener("click", () => els.stopBtn?.click());
els.sheetFsZoomOutBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(-0.1);
  updateSheetZoomLabel();
});
els.sheetFsZoomInBtn?.addEventListener("click", async () => {
  await sheet.zoomBy(0.1);
  updateSheetZoomLabel();
});
document.addEventListener("fullscreenchange", () => {
  void onSheetFullscreenChange();
});
document.addEventListener("webkitfullscreenchange", () => {
  void onSheetFullscreenChange();
});

// F toggles sheet fullscreen when not typing in a field (common media-viewer shortcut).
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "f" && ev.key !== "F") return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const tag = (ev.target?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || ev.target?.isContentEditable) return;
  if (scoreView !== "sheet" || !sheet.hasScore() || els.sheetStage?.hidden) return;
  ev.preventDefault();
  void toggleSheetFullscreen();
});

els.sheetPdfBtn?.addEventListener("click", async () => {
  if (!sheet.hasScore()) return;
  const base = (sourceFileName || "score").replace(/\.(musicxml|xml|mid|midi)$/i, "") || "score";
  const layers = sheet.getLayers();
  const bits = [];
  if (!layers.staves) bits.push("text");
  if (hiddenVoices.size) bits.push("voices");
  const suffix = bits.length ? `-${bits.join("-")}` : "";
  els.sheetPdfBtn.disabled = true;
  try {
    setStatus("Exporting PDF…");
    const name = await sheet.exportBwPdf({ fileName: `${base}${suffix}.pdf` });
    setStatus(`Exported ${name}`);
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    els.sheetPdfBtn.disabled = false;
  }
});

els.sheetSaveBtn?.addEventListener("click", () => {
  void saveSheetEdits();
});

els.remarksInput?.addEventListener("input", () => {
  if (!project?.musicXml) return;
  sheet.markDirty();
  updateSheetToolbar();
});

els.keyCenterSelect?.addEventListener("change", () => {
  if (keyCenterSelectSilent) return;
  const pc = Number(els.keyCenterSelect.value);
  void modulateToKeyCenter(pc);
});
els.recordingEditBtn?.addEventListener("click", () => {
  void editRecordingUrl();
});

wireViewModeButton(els.viewModeScore, "score");
wireViewModeButton(els.viewModeLyrics, "lyrics");
wireViewModeButton(els.viewModeCustom, "custom");
wireLayerToggle(els.layerStavesBtn, "staves");
wireLayerToggle(els.layerLyricsBtn, "lyrics");
wireLayerToggle(els.layerChordsBtn, "chords");
wireLayerToggle(els.layerNotesBtn, "notes");

els.addChordBtn?.addEventListener("click", () => {
  if (!sheet.hasScore()) return;
  void sheet.beginAnnotationAtCursor("chord");
});
els.addNoteBtn?.addEventListener("click", () => {
  if (!sheet.hasScore()) return;
  void sheet.beginAnnotationAtCursor("note");
});

els.instrumentSelect.addEventListener("change", () => {
  applyInstrumentSelection();
});

els.tuningToggle.addEventListener("change", () => {
  jiEnabled = !!els.tuningToggle.checked;
  updateTuningUi();
});

els.playBtn.addEventListener("click", async () => {
  if (!project) return;
  const needsWarm = !synth.isReady;
  try {
    if (needsWarm) beginBusy(t("busyLoadingSound"));
    await synth.ensure();
    transport.setAudioContext(synth.ctx);
    applyInstrumentSelection();
    synth.setPitchBendRange(project.pitchBendRange, project.bendRangeByChannel);
    transport.setApplyPitchBends(jiEnabled && project.hasPitchBends);
    sheet.enableFollowScroll?.();
    lastSheetOnsetTick = -1;
    transport.play();
    setStatus(t("statusPlaying"));
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    if (needsWarm) endBusy();
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

els.tempoBpm?.addEventListener("change", () => {
  const bpm = Number(els.tempoBpm.value);
  transport.setTempoBpm(bpm);
  syncTempoUi();
});
els.tempoBpm?.addEventListener("input", () => {
  const bpm = Number(els.tempoBpm.value);
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  transport.setTempoBpm(bpm);
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

let mp3ExportBusy = false;
els.exportMp3Btn?.addEventListener("click", async () => {
  if (!project || mp3ExportBusy) return;
  mp3ExportBusy = true;
  if (els.exportMp3Btn) els.exportMp3Btn.disabled = true;
  const wasPlaying = transport.playing;
  if (wasPlaying) transport.pause();
  try {
    const base = (sourceFileName || project.title || "practice").replace(
      /\.(musicxml|xml|mid|midi)$/i,
      "",
    );
    const result = await exportMixToMp3({
      project,
      voiceGain,
      applyJi: jiEnabled && !!project.hasPitchBends,
      instrumentValue: els.instrumentSelect?.value || "score",
      tempoBpm: transport.tempoBpm,
      scoreBpm: transport.scoreBpm,
      fileBaseName: base,
      onProgress: (ratio) => {
        const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        setStatus(t("exportMp3Working", { pct: String(pct) }));
      },
    });
    setStatus(t("exportMp3Done", { file: result.filename }));
  } catch (err) {
    setStatus(err?.message || String(err), true);
  } finally {
    mp3ExportBusy = false;
    if (els.exportMp3Btn) els.exportMp3Btn.disabled = !project;
  }
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
  scrubUpdateQueryParam();

  /** @type {{ remoteVersion: string|null, registration: ServiceWorkerRegistration|null }} */
  let pendingUpdate = { remoteVersion: null, registration: null };

  function showUpdateBanner(remoteVersion, registration) {
    pendingUpdate = { remoteVersion, registration: registration || null };
    if (!els.updateBanner) return;
    const label = formatVersionLabel(remoteVersion);
    if (els.updateBannerText) {
      els.updateBannerText.textContent = label
        ? t("updateAvailable").replace("{version}", label)
        : t("updateAvailableGeneric");
    }
    els.updateBanner.hidden = false;
  }

  function hideUpdateBanner() {
    if (els.updateBanner) els.updateBanner.hidden = true;
  }

  watchServiceWorkerLifecycle({
    onVisibleCheck: () => {
      void checkForAppUpdate({
        onAvailable: ({ remoteVersion, registration }) => {
          showUpdateBanner(remoteVersion, registration);
        },
      });
    },
  });

  if (els.updateNowBtn) {
    els.updateNowBtn.addEventListener("click", () => {
      hideUpdateBanner();
      setStatus(t("updateUpdating"));
      void applyAppUpdate({
        remoteVersion: pendingUpdate.remoteVersion,
      });
    });
  }
  if (els.updateLaterBtn) {
    els.updateLaterBtn.addEventListener("click", () => {
      dismissUpdatePrompt(pendingUpdate.remoteVersion || "waiting");
      hideUpdateBanner();
    });
  }

  void checkForAppUpdate({
    onStatus: (phase) => {
      if (phase === "checking") setStatus(t("updateChecking"));
    },
    onError: () => setStatus(t("updateFailed"), true),
    onAvailable: ({ remoteVersion, registration }) => {
      showUpdateBanner(remoteVersion, registration);
      const cur = els.status?.textContent || "";
      if (cur === t("updateChecking")) {
        setStatus("Ready — open a MIDI or MusicXML file to begin.");
      }
    },
  }).then(({ available }) => {
    const just = consumeJustUpdatedLabel();
    if (just) {
      setStatus(t("updateApplied").replace("{version}", just));
      return;
    }
    if (available) return;
    const cur = els.status?.textContent || "";
    if (cur === t("updateChecking") || cur === t("updateUpdating")) {
      setStatus("Ready — open a MIDI or MusicXML file to begin.");
    }
  });
}

if (els.appVersion) els.appVersion.textContent = APP_VERSION_LABEL;

if (!project && els.fileName) els.fileName.textContent = t("noFile");

onLangChange(() => {
  applyDomI18n();
  if (!project && els.fileName) els.fileName.textContent = t("noFile");
  updateTuningUi();
  updateScoreViewUi();
  syncKeyCenterSelect();
  renderVoices();
  renderNotes();
  void updateSyncUi();
  if (els.updateBanner && !els.updateBanner.hidden && els.updateBannerText) {
    const pendingLabel = els.updateBannerText.textContent;
    // Refresh banner copy if still showing a versioned update string.
    if (pendingLabel) {
      const m = pendingLabel.match(/v?\d+\.\d+\.\d+/);
      if (m) {
        els.updateBannerText.textContent = t("updateAvailable").replace(
          "{version}",
          formatVersionLabel(m[0]),
        );
      }
    }
  }
});

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

/** Quietly preload OSMD + FluidSynth/soundfont + example sheet pre-renders. */
function scheduleResourceWarmup() {
  const run = () => {
    void (async () => {
      try {
        await sheet.ensure();
      } catch {
        /* ignore */
      }
      try {
        await synth.warm();
      } catch {
        /* ignore — Play will surface errors */
      }
      try {
        const examples = await fetchExamplesCatalog();
        await exampleCache.warm(examples);
      } catch {
        /* examples optional at startup */
      }
    })();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 1800 });
  } else {
    setTimeout(run, 400);
  }
}

scheduleResourceWarmup();

// Pre-renders are width-specific; rebuild after significant resizes.
let _exampleResizeTimer = 0;
window.addEventListener("resize", () => {
  window.clearTimeout(_exampleResizeTimer);
  _exampleResizeTimer = window.setTimeout(() => {
    exampleCache.scheduleRewarm();
  }, 400);
});
