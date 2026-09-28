# MIDI Practice Player

Small standalone web app for rehearsing MIDI / MusicXML with friends:

- Open a `.mid` / `.midi` or `.musicxml` / `.xml` file in the browser
- Mute / solo individual **voices** (MIDI channels or MusicXML parts)
- While soloing, set **Other voices** to a quiet accompaniment level (default 25%)
- Play, pause, stop, scrub the playhead, change tempo %
- **Piano roll** or **sheet music** (MusicXML via OpenSheetMusicDisplay); toggle between them
- Mute/solo colours apply in both the roll and the score
- JustPlay retuned MIDI: **Just Intonation / Standard** toggle (applies or centres pitch bends)
- Hear playback through a bundled General MIDI soundfont (default: **Choir Aahs**)
- Installable / offline after the first visit (service worker + PWA manifest)

## Run locally

GitHub Pages and Dropbox `file://` both need HTTP for the soundfont. From this folder:

```bash
# Python 3
python -m http.server 8765
```

Then open http://localhost:8765/

Or with Node: `npx --yes serve -p 8765`

## Host on GitHub Pages (free)

1. Push this repo to GitHub.
2. **Settings → Pages →** Deploy from branch `main` / folder `/ (root)`.
3. Share `https://<user>.github.io/<repo>/`.

The app uses **relative paths** (`./vendor`, `./soundfonts`), so it works at the site root or under a subpath if you keep those relatives.

## Offline use via Pages

Yes — with a caveat:

1. Friends open the Pages URL **once while online**. The service worker caches the shell, vendors, and the ~6 MB soundfont.
2. After that they can reopen the same URL offline, or **Install / Add to Home Screen** (Chrome, Edge, Safari) for an app-like shortcut that works offline.
3. Their own MIDI/MusicXML files are chosen locally each session (not uploaded); those are not cached by the app.

There is no way for GitHub Pages alone to put files on someone’s disk without a first network visit. For a true “download once” package, use the repo’s **Code → Download ZIP** and run `python -m http.server` locally.

### Password protection?

Usually **not worth it** for this app. It is a static front-end: no accounts, no uploaded scores on the server, and the soundfont is already public. Automated “abuse” risk is mostly bandwidth on GitHub’s CDN, which is negligible for a small choir.

GitHub Pages also has **no built-in password**. Options if you still want a gate:

| Approach | Notes |
|----------|--------|
| Keep the repo **private** + Pages (needs GitHub Pro/Team for private Pages) | Real access control via GitHub accounts |
| Cloudflare Access / similar in front of Pages | Proper login, free tier often enough for a small group |
| Client-side “password” in the page | Trivial to bypass; only stops casual visitors |

Recommendation: host it openly; share the URL in the group chat. If you later add anything sensitive, use Cloudflare Access rather than a fake client password.

## Try the demo

With the local server running, open the app and load:

- `examples/demo.mid` — short two-voice MIDI
- `examples/stille-nacht.musicxml` — four-voice score (sheet + roll + mute/solo colours)

## Sheet edits & export

In **Sheet music** view:

- Click the **title** or a **stave name** on the score to edit it inline (Voices list updates too)
- Click a **colour square** in Voices to recolour roll + sheet notes (saved into MusicXML)
- Use **Lines** to show/hide staff lines
- When anything changed, a **save** icon appears — click it to download the edited MusicXML
- Closing the tab with unsaved edits prompts to stay and save

## Offline install

Use **Install for offline** in the header (or your browser’s Add to Home Screen). After one online visit the service worker caches the app and soundfont. The footer shows the app version (from the git tag).

## JustPlay retuned MIDI

JustPlay embeds:

| Signal | Where | Purpose |
|--------|--------|---------|
| Pitch bend range | RPN (CC 101/100/6) on each channel | External synths / this player set ±N semitones |
| Pitch bend range | `JI_FILE:{…,"pbRange":N}` text meta | JustPlay / this player can read range without parsing RPN |
| JI markers | `JI_MARKER:` / CC channel 16 | Palette for re-import into JustPlay |
| Pitch bend events | `pitchwheel` before notes **or** computed in this player from markers | Actual JI detune for playback |

**Marker-only export (recommended for practice):** export Standard from JustPlay with JI markers embedded. This player detects `JI_FILE` / `JI_MARKER` (and channel-16 CC markers), synthesizes pitch bends from the marker palettes, and shows the **Just Intonation / Standard** toggle.

**Retuned export:** baked `pitchwheel` events are used directly when present.

## Layout

| Path | Role |
|------|------|
| `index.html` | UI |
| `styles.css` | Layout |
| `js/midi-parse.js` | Standard MIDI File → notes, voices, bends |
| `js/transport.js` | Soft real-time tick clock (mute/solo + pitch bend) |
| `js/piano-roll.js` | Canvas piano roll + click-to-seek |
| `js/synth.js` | FluidSynth WASM + TimGM6mb.sf2 |
| `js/musicxml-parse.js` | MusicXML → notes + part voices |
| `js/musicxml-edit.js` | Title / part labels / staff-lines patch + download |
| `js/sheet-view.js` | OpenSheetMusicDisplay + mute/solo colours |
| `js/ji-retune.js` | Marker palette → pitch bends |
| `js/main.js` | Wires UI |
| `sw.js` / `manifest.webmanifest` | Offline PWA shell |
| `vendor/` | js-synthesizer, libfluidsynth, OpenSheetMusicDisplay |
| `soundfonts/TimGM6mb.sf2` | ~6 MB GM bank |
| `examples/` | Sample MIDI + MusicXML |

## Notes

- First Play click downloads/compiles the WASM synth and loads the soundfont; later plays are faster.
- Tracks with zero notes are hidden.
- Channel 10 (drums) stays a drum kit in the soundfont; melodic tracks use the selected GM program.
- Browser autoplay rules: Play must be a user gesture (button click), which this UI already uses.
- Space toggles play/pause when focus is not in an input; Escape silences stuck notes.
- Stop / Pause / Seek / Play always run a MIDI panic (All Sound Off) so hanging notes clear.
