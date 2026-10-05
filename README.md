# MIDI Practice Player

Standalone web app for choir / ensemble rehearsal of **MIDI** and **MusicXML** scores: mute/solo voices, sheet + piano roll, optional Just Intonation, offline install, and **shared practice packs** with sync.

Version: see `js/version.js` / `version.json` / footer.

---

## Table of contents

- [Features](#features)
- [For singers (users)](#for-singers-users)
  - [Open a score](#open-a-score)
  - [Playback](#playback)
  - [Voices (mute / solo / colours / names)](#voices-mute--solo--colours--names)
  - [Sheet music](#sheet-music)
  - [Install for offline use](#install-for-offline-use)
  - [Shared practice (notes + sync)](#shared-practice-notes--sync)
  - [Keyboard shortcuts](#keyboard-shortcuts)
- [For maintainers (hosting)](#for-maintainers-hosting)
  - [GitHub Pages](#github-pages)
  - [Shared sync via GitHub](#shared-sync-via-github)
- [For developers](#for-developers)
  - [Run locally](#run-locally)
  - [Repository layout](#repository-layout)
  - [Architecture notes](#architecture-notes)
  - [Practice pack format](#practice-pack-format)
  - [Service worker / PWA](#service-worker--pwa)
  - [Versioning](#versioning)
  - [Vendored dependencies](#vendored-dependencies)
  - [JustPlay MIDI](#justplay-midi)
- [Demo files](#demo-files)
- [Limitations & tips](#limitations--tips)

---

## Features

| Area | What you get |
|------|----------------|
| Files | `.mid` / `.midi`, `.musicxml` / `.xml` |
| Playback | Play / pause / stop, tempo %, seek, onset skip (←/→) |
| Voices | Mute, solo, accompaniment level for non-soloed parts |
| Views | Piano roll and sheet music (MusicXML) |
| Edits | Title, stave/voice names, colours, staff lines on/off, key-centre modulation |
| Export | Edited MusicXML; practice pack; **MP3** of current mute/solo mix |
| Sync | Local IndexedDB + Undo; Pull/Push to GitHub or HTTP URL |
| Offline | PWA install; service worker caches app + soundfont |
| JI | JustPlay marker / pitch-bend MIDI → JI ↔ 12-TET toggle |

---

## For singers (users)

### Open a score

1. Open the app (website or installed PWA).
2. **Open file** → choose a MIDI or MusicXML file from your device.
3. MusicXML opens in **Sheet music**; MIDI opens the **piano roll** (no sheet).

Files stay on your device unless you Export / Push a practice pack.

### Playback

- **Play / Pause / Stop**, scrub the timeline, adjust **Tempo**.
- First Play may take a few seconds (WASM synth + soundfont).
- **Sound** menu: Choir Aahs (default), piano, strings, etc.
- Red playhead on the sheet sits on the sounding note onset.

### Voices (mute / solo / colours / names)

- **Mute** / **Solo** per voice.
- With any solo active, **Other voices** sets how loud the rest are (default 25%; 0% = classic solo).
- **Mute all** mutes everyone and clears solos; **Unmute all** clears mutes and solos.
- **Export MP3** renders the current mix (mute/solo, Sound instrument, tempo, and 12-TET/JI when markers exist) to a downloadable MP3.
- Click the **colour square** to change note colour (roll + sheet).
- Click the **voice name** (or the stave name on the sheet) to rename — same name in both places.

### Sheet music

- Toggle **Piano roll** / **Sheet music**.
- **− / +** zoom.
- **Key** dropdown: modulate the whole score to another key centre (same major/minor mode as the piece). The original home key is stored in the MusicXML (`practice-player-home-key`).
- Click **title** or **stave labels** on the score (or voice names in Voices) to rename.
- When there are unsaved score edits, a **save** icon appears → downloads edited MusicXML.
- Closing the tab with unsaved edits (or unpushed sync changes) asks you to confirm.

### Install for offline use

1. Visit the app **once while online** (caches the app + ~6 MB soundfont).
2. Click **Install for offline**, or use the browser menu:
   - **Android / desktop Chrome or Edge:** Install app / Add to Home screen  
   - **iPhone Safari:** Share → **Add to Home Screen**
3. Afterwards you can open the installed app offline.

Your own score files are not pre-cached; open them from the device each time (or use a synced practice pack).

### Shared practice (notes + sync)

The **Shared practice** panel (after loading MusicXML):

| Control | Purpose |
|---------|---------|
| **Undo** | Revert the last shared edit on this device |
| **Pull** | Download the group’s pack from the remote |
| **Push** | Upload your pack (GitHub → new commit = history) |
| **Export pack** | Save `.practice.json` (score + edits + notes) |
| **Import pack** | Load a `.practice.json` from someone else |
| **Sync settings** | Your name, GitHub repo/token, or generic URL |
| **Rehearsal notes** | Shared text notes for the group |
| **Edit history** | Short log of revisions in the pack |

**Typical choir workflow**

1. One person configures **Sync settings** (GitHub recommended — see [Shared sync via GitHub](#shared-sync-via-github)).
2. Others set the same owner/repo/path (token only needed to Push; public repos can Pull without a token).
3. Work offline as needed → **Push** when online.
4. If Pull would overwrite unpushed local work, the app asks first — **Export pack** as a backup if unsure.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| Space | Play / pause (when not typing in an input) |
| ← / → | Previous / next note onset |
| Escape | Pause and silence (panic) |

---

## For maintainers (hosting)

### GitHub Pages

1. Push this repository to GitHub (repo root = this folder’s contents). The workflow in `.github/workflows/pages.yml` deploys on every push to `main`.
2. **Settings → Pages** → **Build and deployment** → Source: **GitHub Actions** (not “Deploy from a branch”).
3. After the workflow succeeds, share `https://<user>.github.io/<repo>/`.

`.nojekyll` is included so GitHub does not process the site with Jekyll. Paths are relative (`./js`, `./vendor`, …).

**Password protection:** GitHub Pages has no built-in password. Prefer an open URL for a choir app; use Cloudflare Access or private Pages (paid) if you need a real gate. Do not rely on a fake client-side password.

### Shared sync via GitHub

Recommended setup for group edits with history:

1. Create a folder in the repo, e.g. `shared/` (can be this same repo or a separate one).
2. In the app → **Sync settings**:
   - **Your name** — appears in history / notes  
   - **Owner** / **Repo** / **Path** — e.g. `shared/` (Push writes `shared/<projectId>.practice.json`)  
   - **Branch** — usually `main`  
   - **Token** — GitHub [fine-grained PAT](https://github.com/settings/tokens) with **Contents: Read and write** on that repo (only on devices that Push; store stays in that browser’s IndexedDB)
3. **Push** creates/updates the file via the GitHub Contents API (each push = git commit).
4. **Pull** loads the latest file.

Alternatively use **Export / Import pack** or a generic HTTPS URL that supports GET (and PUT if you Push).

More detail: [docs/SYNC.md](docs/SYNC.md).

---

## For developers

### Run locally

Serve over **HTTP** (not `file://`) so the soundfont and worklets load:

```bash
cd practice-player   # or repo root if this is the repo
python -m http.server 8765
# → http://localhost:8765/
```

Or: `npx --yes serve -p 8765`

No build step: ES modules load directly in the browser.

### Repository layout

```
index.html              UI shell
styles.css              Layout / theme
manifest.webmanifest    PWA manifest
sw.js                   Service worker (cache version bump on release)
package.json            name / version metadata
.nojekyll               GitHub Pages
js/
  main.js               App wiring
  midi-parse.js         SMF → notes, voices, bends, onsets
  musicxml-parse.js     MusicXML → notes + voices
  musicxml-edit.js      Title / parts / staff-lines / voice colours → XML
  ji-retune.js          Marker palettes → pitch bends
  transport.js          Soft real-time tick clock
  synth.js              FluidSynth wrapper + panic
  piano-roll.js         Canvas roll
  sheet-view.js         OSMD sheet, cursor, inline edit
  practice-pack.js      Pack schema, history, compare
  local-store.js        IndexedDB + sync settings
  sync-remote.js        GitHub Contents API / HTTP pull-push
  project-session.js    Session + undo + persist
  version.js            APP_VERSION / label (keep in sync with tags)
vendor/                 FluidSynth, js-synthesizer, OpenSheetMusicDisplay
soundfonts/TimGM6mb.sf2 GM bank (~6 MB)
examples/               Published MusicXML catalog (`manifest.json`)
icons/                  PWA icons
docs/                   Extra maintainer docs
```

### Architecture notes

- **Playback:** `Transport` schedules note on/off and pitch bends from project ticks; `ChoirSynth` renders via AudioWorklet FluidSynth.
- **Mute/solo:** `voiceGain()` → velocity scaling + roll/sheet colour; accompaniment level when solos are active.
- **Sheet cursor:** notes-only OSMD iterator + alignment to notehead bounds (avoids mid-bar interpolation).
- **Edits:** MusicXML is the score source; `musicxml-edit.js` patches metadata; colours also in a `miscellaneous-field`.
- **Sync:** local-first pack in IndexedDB; remote is optional; conflicts resolved by explicit Pull confirmation, not silent merge.

### Practice pack format

JSON file (`*.practice.json`):

| Field | Meaning |
|-------|---------|
| `format` | `"midi-practice-pack"` |
| `version` | Schema version (`1`) |
| `id` | Stable project id |
| `rev` | Monotonic revision (conflict / sync) |
| `musicXml` | Full score XML payload |
| `edits` | `{ title, parts, staffLines, voiceColors }` |
| `notes` | Rehearsal notes `{ id, text, author, updatedAt, tick? }` |
| `history` | Recent `{ rev, at, author, summary }` entries |

See `js/practice-pack.js` for create/parse/compare helpers.

### Service worker / PWA

- `sw.js` precaches the shell, vendors, soundfont, examples.
- **Bump `CACHE`** (e.g. `midi-practice-player-v7`) whenever shipped assets change so clients refresh.
- Add new `js/*.js` paths to `PRECACHE` when you add modules.
- Manifest: `manifest.webmanifest` (`display: standalone`).

### Versioning

1. Update `package.json` `"version"`, `js/version.js` (`APP_VERSION`), and `version.json`.
2. Tag `vX.Y.Z` and bump service worker `CACHE` (and `PRECACHE` for new files).
3. Push `main` — Pages deploys; installed clients check `version.json` on startup and refresh.

### Vendored dependencies

Do not assume npm install for runtime — binaries live under `vendor/` and `soundfonts/`.

| Package | Role |
|---------|------|
| libfluidsynth + js-synthesizer | Soft synth |
| OpenSheetMusicDisplay | Sheet rendering |
| TimGM6mb.sf2 | GM soundfont |

### JustPlay MIDI

| Signal | Where | Purpose |
|--------|--------|---------|
| Pitch bend range | RPN / `JI_FILE` meta `pbRange` | Bend sensitivity |
| JI markers | `JI_MARKER:` / CC ch 16 | Palette for JI |
| Pitch bends | File events **or** synthesized from markers | Detune |

Prefer **marker-only Standard export** from JustPlay for practice; this app synthesizes bends and offers JI ↔ Standard.

---

## Demo files

Open → **Examples** loads from `examples/manifest.json`. Example **sources** are MuseScore `.mscz` files; the app loads a sibling pre-converted `.musicxml` (generated with the MuseScore CLI). After startup the app idle-warms examples: all are fetched/parsed, and a size-capped set is OSMD-pre-rendered offscreen so switching between them feels instant. Runtime webmscore conversion is only a fallback for user-opened `.mscz` files — it is unreliable for MuseScore 4 scores.

**Dropbox library:** maintainers keep `.mscz` files in a Dropbox folder whose share URL is the GitHub Actions secret `DROPBOX_EXAMPLES_URL`. The **Sync Dropbox examples** workflow runs every 15 minutes (and on demand) to convert and redeploy Pages when the folder changes. Same app version is fine; the sync job bumps the service-worker cache when files change. See [docs/DROPBOX.md](docs/DROPBOX.md).

---

## MuseScore (`.mscz`) import

- **From device:** Open accepts `.mscz` / `.mscx` / `.mxl` / `.musicxml` / MIDI.
- **On the fly (device files):** `.mxl` is unzipped in-browser; `.mscz` is converted with [webmscore](https://github.com/LibreScore/webmscore) (GPL-3.0), lazy-loaded from jsDelivr on first use (~20 MB WASM, needs network once). Prefer exporting MusicXML from MuseScore when webmscore fails.
- **Examples workflow (required for ship):**
  1. Commit `examples/*.mscz` and list them in `manifest.json`.
  2. Run `npm run examples:build` (needs MuseScore 4 CLI / `MUSESCORE_CLI`) to write sibling `examples/*.musicxml`.
  3. Commit those `.musicxml` caches. Pages deploy runs `npm run examples:verify` and fails if any sibling is missing or has no notes.
- **License note:** on-the-fly `.mscz` conversion pulls in webmscore (GPL-3.0) from the CDN only when needed; shipped examples use pre-converted MusicXML and do not need it.
- **Shared metadata** (JI markers, remarks, home key, recording URL, …) uses stable MusicXML `miscellaneous-field` names (see `js/score-meta.js`). MuseScore stores the same values as Project Properties metaTags inside `.mscz`; import merges those tags so JustPlay / Practice Player / MuseScore stay aligned.

---

## Limitations & tips

- First MuseScore import downloads the converter; later conversions reuse it for the session.
- First Play is slower (WASM + soundfont); later plays are faster.
- Empty tracks are hidden; channel 10 stays drums in the soundfont.
- Space / arrows ignore shortcuts while focus is in an input or select.
- GitHub sync tokens never leave the browser that saved them; treat PATs like passwords.
- Shared sync is built for MusicXML projects (MIDI-only stays local on that device).
