/**
 * EN / NL UI strings for the MIDI Practice Player.
 * Visible chrome stays short; longer help lives in title / data-tip tooltips.
 */

const STRINGS = {
  en: {
    title: "MIDI Practice Player",
    install: "Install",
    installTip: "Install for offline use (or Add to Home Screen)",
    openFile: "Open file",
    open: "Open",
    openTip: "Open a score from this device or from the built-in examples",
    openFromDevice: "From this device…",
    examples: "Examples",
    examplesEmpty: "No examples available",
    examplesLoadError: "Could not load examples list",
    noFile: "No file loaded",
    sound: "Sound",
    scoreInstruments: "Score instruments",
    choirAahs: "Choir Aahs",
    voiceOohs: "Voice Oohs",
    acousticPiano: "Acoustic Piano",
    strings: "Strings",
    violin: "Violin",
    cello: "Cello",
    flute: "Flute",
    altoSax: "Alto Sax",
    tuningJi: "JI",
    tuningStandard: "12-TET",
    tuningTipJi: "Just intonation — use when this file has JustPlay tuning markers.",
    tuningTipStandard: "Equal temperament — best for most practice and recordings.",
    tuningTipEmpty: "Tuning markers found, but no usable map — stay on 12-TET.",
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    tempo: "Tempo",
    score: "Score",
    pianoRoll: "Piano roll",
    sheetMusic: "Sheet music",
    scoreView: "Score view",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    exportPdf: "Export PDF",
    exportPdfTip: "Export current view as black-and-white PDF",
    saveScore: "Save score",
    saveScoreTip: "Save / export MusicXML",
    layers: "Score layers",
    staves: "Staves",
    lyrics: "Lyrics",
    chords: "Chords",
    notesLayer: "Notes",
    stavesTip: "Show or hide staves and notation",
    lyricsTip: "Show or hide lyrics",
    chordsTip: "Show or hide chord symbols",
    notesLayerTip: "Show or hide performance notes",
    addAnnotations: "Add annotations",
    addChord: "+ Chord",
    addNote: "+ Note",
    addChordTip: "Add a chord at the playhead. Click an existing chord to edit or delete it.",
    addNoteTip: "Add a note at the playhead. Click an existing note to edit or delete it.",
    transpose: "Transpose",
    transposeDown: "Transpose down",
    transposeUp: "Transpose up",
    transposeDownTip: "Transpose the score down one semitone (sheet, playback, and saved XML)",
    transposeUpTip: "Transpose the score up one semitone (sheet, playback, and saved XML)",
    recordingLink: "Recording",
    recordingLinkTip: "Open the reference recording",
    recordingEdit: "Recording…",
    recordingEditTip: "Set or clear a reference recording URL stored in the MusicXML",
    recordingPrompt: "Reference recording URL (leave empty to clear)",
    remarks: "Remarks",
    remarksPlaceholder: "General remarks for this score…",
    scoreTip: "Click the timeline to seek. Click a chord or note to edit it. Arrow keys skip onsets. Mute/solo colours apply in both views.",
    rollAria: "MIDI piano roll timeline — click to seek",
    sheetPlaceholder: "Load a MusicXML file to see sheet music here.",
    voices: "Voices",
    muteAll: "Mute all",
    unmuteAll: "Unmute all",
    otherVoices: "Other voices",
    emptyVoices: "Open a MIDI or MusicXML file to see voices here.",
    mute: "Mute",
    unmute: "Unmute",
    solo: "Solo",
    unsolo: "Unsolo",
    renameVoice: "Click to rename",
    sharedPractice: "Shared practice",
    undo: "Undo",
    undoTip: "Undo last shared edit",
    pull: "Pull",
    push: "Push",
    syncStatusLoad: "Load a MusicXML score to enable shared notes and sync.",
    exportPack: "Export pack",
    importPack: "Import pack",
    syncSettings: "Sync settings",
    yourName: "Your name (for history)",
    syncSettingsTip: "Preferred: GitHub repo (each Push creates a commit). Token stays on this device only.",
    owner: "Owner",
    repo: "Repo",
    path: "Path",
    branch: "Branch",
    ghToken: "GitHub token (Contents read/write)",
    remoteUrl: "Or generic remote JSON URL (GET pull / PUT push)",
    saveSettings: "Save settings",
    rehearsalNotes: "Rehearsal notes",
    addSharedNote: "Add a shared note…",
    add: "Add",
    delete: "Delete",
    editHistory: "Edit history",
    noRehearsalNotes: "No rehearsal notes yet.",
    langToggleTip: "Switch language / Wissel taal",
    updateChecking: "Checking for app updates…",
    updateUpdating: "Updating to the latest version…",
    updateCurrent: "App is up to date",
    updateApplied: "Updated to {version}",
    updateFailed: "Could not check for updates (offline?)",
  },
  nl: {
    title: "MIDI Oefenspeler",
    install: "Installeren",
    installTip: "Installeer voor offline gebruik (of Zet op beginscherm)",
    openFile: "Bestand openen",
    open: "Openen",
    openTip: "Open een partituur vanaf dit apparaat of uit de voorbeelden",
    openFromDevice: "Vanaf dit apparaat…",
    examples: "Voorbeelden",
    examplesEmpty: "Geen voorbeelden beschikbaar",
    examplesLoadError: "Voorbeeldenlijst kon niet worden geladen",
    noFile: "Geen bestand geladen",
    sound: "Klank",
    scoreInstruments: "Partituur-instrumenten",
    choirAahs: "Koor Aahs",
    voiceOohs: "Stem Oohs",
    acousticPiano: "Akoestische piano",
    strings: "Strijkers",
    violin: "Viool",
    cello: "Cello",
    flute: "Fluit",
    altoSax: "Altsax",
    tuningJi: "JI",
    tuningStandard: "12-TET",
    tuningTipJi: "Pure stemming — gebruik als dit bestand JustPlay-markers heeft.",
    tuningTipStandard: "Evenredig zwevende stemming — handig voor de meeste oefening en opnames.",
    tuningTipEmpty: "Stemmarkers gevonden, maar geen bruikbare kaart — blijf op 12-TET.",
    play: "Speel",
    pause: "Pauze",
    stop: "Stop",
    tempo: "Tempo",
    score: "Partituur",
    pianoRoll: "Pianorol",
    sheetMusic: "Bladmuziek",
    scoreView: "Partituurweergave",
    zoomOut: "Uitzoomen",
    zoomIn: "Inzoomen",
    exportPdf: "PDF exporteren",
    exportPdfTip: "Huidige weergave als zwart-wit-PDF exporteren",
    saveScore: "Partituur opslaan",
    saveScoreTip: "MusicXML opslaan / exporteren",
    layers: "Partituurlagen",
    staves: "Notenbalken",
    lyrics: "Tekst",
    chords: "Akkoorden",
    notesLayer: "Notities",
    stavesTip: "Notenbalken tonen of verbergen",
    lyricsTip: "Tekst tonen of verbergen",
    chordsTip: "Akkoordsymbolen tonen of verbergen",
    notesLayerTip: "Uitvoeringsnotities tonen of verbergen",
    addAnnotations: "Annotaties toevoegen",
    addChord: "+ Akkoord",
    addNote: "+ Notitie",
    addChordTip: "Akkoord toevoegen bij de afspeelkop. Klik een bestaand akkoord om te bewerken of te verwijderen.",
    addNoteTip: "Notitie toevoegen bij de afspeelkop. Klik een bestaande notitie om te bewerken of te verwijderen.",
    transpose: "Transponeren",
    transposeDown: "Omlaag transponeren",
    transposeUp: "Omhoog transponeren",
    transposeDownTip: "Partituur een halve toon omlaag (blad, afspelen en opgeslagen XML)",
    transposeUpTip: "Partituur een halve toon omhoog (blad, afspelen en opgeslagen XML)",
    recordingLink: "Opname",
    recordingLinkTip: "Referentie-opname openen",
    recordingEdit: "Opname…",
    recordingEditTip: "Referentie-opname-URL in de MusicXML zetten of wissen",
    recordingPrompt: "URL van de referentie-opname (leeg laten om te wissen)",
    remarks: "Opmerkingen",
    remarksPlaceholder: "Algemene opmerkingen bij deze partituur…",
    scoreTip: "Klik op de tijdlijn om te zoeken. Klik een akkoord of notitie om te bewerken. Pijltjestoetsen springen naar inzetten. Mute/solo-kleuren gelden in beide weergaven.",
    rollAria: "MIDI-pianorol — klik om te zoeken",
    sheetPlaceholder: "Laad een MusicXML-bestand om hier bladmuziek te zien.",
    voices: "Stemmen",
    muteAll: "Alles dempen",
    unmuteAll: "Alles aanzetten",
    otherVoices: "Andere stemmen",
    emptyVoices: "Open een MIDI- of MusicXML-bestand om hier stemmen te zien.",
    mute: "Dempen",
    unmute: "Aanzetten",
    solo: "Solo",
    unsolo: "Solo uit",
    renameVoice: "Klik om te hernoemen",
    sharedPractice: "Gedeelde oefening",
    undo: "Ongedaan",
    undoTip: "Laatste gedeelde bewerking ongedaan maken",
    pull: "Ophalen",
    push: "Pushen",
    syncStatusLoad: "Laad een MusicXML-partituur voor gedeelde notities en sync.",
    exportPack: "Pakket exporteren",
    importPack: "Pakket importeren",
    syncSettings: "Sync-instellingen",
    yourName: "Jouw naam (voor geschiedenis)",
    syncSettingsTip: "Bij voorkeur: GitHub-repo (elke Push = commit). Token blijft alleen op dit apparaat.",
    owner: "Eigenaar",
    repo: "Repo",
    path: "Pad",
    branch: "Branch",
    ghToken: "GitHub-token (Contents lezen/schrijven)",
    remoteUrl: "Of generieke externe JSON-URL (GET ophalen / PUT pushen)",
    saveSettings: "Instellingen opslaan",
    rehearsalNotes: "Repetitienotities",
    addSharedNote: "Gedeelde notitie toevoegen…",
    add: "Toevoegen",
    delete: "Verwijderen",
    editHistory: "Bewerkingsgeschiedenis",
    noRehearsalNotes: "Nog geen repetitienotities.",
    langToggleTip: "Switch language / Wissel taal",
    updateChecking: "Controleren op app-updates…",
    updateUpdating: "Bezig met updaten naar de nieuwste versie…",
    updateCurrent: "App is up-to-date",
    updateApplied: "Bijgewerkt naar {version}",
    updateFailed: "Kon niet controleren op updates (offline?)",
  },
};

const STORAGE_KEY = "mpp-lang";

let lang = "en";
/** @type {Set<() => void>} */
const listeners = new Set();

function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "nl") return saved;
  } catch {
    /* ignore */
  }
  const nav = (navigator.language || "en").toLowerCase();
  return nav.startsWith("nl") ? "nl" : "en";
}

export function getLang() {
  return lang;
}

export function t(key, vars = {}) {
  const table = STRINGS[lang] || STRINGS.en;
  let s = table[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

export function setLang(next) {
  const n = next === "nl" ? "nl" : "en";
  if (n === lang) return;
  lang = n;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang === "nl" ? "nl" : "en";
  applyDomI18n();
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Apply data-i18n / data-i18n-title / data-i18n-aria / data-i18n-placeholder on the document. */
export function applyDomI18n() {
  document.title = t("title");
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    const key = el.getAttribute("data-i18n-html");
    if (key) el.innerHTML = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.title = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-aria]")) {
    const key = el.getAttribute("data-i18n-aria");
    if (key) el.setAttribute("aria-label", t(key));
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  }
  const toggle = document.getElementById("langToggle");
  if (toggle) {
    toggle.textContent = lang === "nl" ? "NL" : "EN";
    toggle.setAttribute("aria-pressed", "true");
    toggle.title = t("langToggleTip");
  }
}

export function initI18n() {
  lang = detectLang();
  document.documentElement.lang = lang === "nl" ? "nl" : "en";
  applyDomI18n();
  document.getElementById("langToggle")?.addEventListener("click", () => {
    setLang(lang === "en" ? "nl" : "en");
  });
}
