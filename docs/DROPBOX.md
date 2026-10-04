# Dropbox score library

Use a **public Dropbox shared folder** of `.mscz` files as the source of truth. The Practice Player does **not** convert in the browser; a GitHub Action fetches the folder, converts with MuseScore CLI, regenerates `examples/manifest.json`, commits, and GitHub Pages redeploys.

## Tokens

| Secret | Needed? |
|--------|---------|
| Dropbox | **No** — use a folder shared link (`https://www.dropbox.com/sh/…`). The workflow downloads the folder ZIP (`?dl=1`). |
| GitHub | **Yes** (maintainers only) — a PAT with **Actions: Read and write** so the app can start/poll the workflow. Stored only in that browser (Sync / library settings). |

Optional repo secret/variable `DROPBOX_EXAMPLES_URL` — default folder URL when the workflow is run from the Actions UI without an input.

## Dropbox folder layout

```
My choir scores/          ← share this folder (view)
  stille-nacht.mscz
  gaudete.mscz
  setlist.json            ← optional order only: ["stille-nacht.mscz", …]
```

Titles and other metadata come from the scores (MusicXML `work-title` after conversion / MuseScore project properties). No hand-maintained `catalog.json`.

## App button: Sync scores from Dropbox

1. Open **Score library (Dropbox)** under the Open row.
2. Paste the folder URL, GitHub owner/repo/`practice-player`, branch `main`, and PAT.
3. **Save settings**, then **Sync scores from Dropbox**.

The button:

- Refuses to start a second run while one is already queued/in progress (joins the existing run instead).
- Waits for the workflow, then for Pages to publish a new `examples/.dropbox-sync.json` fingerprint.
- Reloads the app when new scores are live; reports “already up to date” if Dropbox matched the repo.

## Manual / CI

- Actions → **Sync Dropbox examples** → Run workflow.
- Or set `DROPBOX_EXAMPLES_URL` and dispatch.

Local (with MuseScore installed):

```bash
npm run examples:fetch-dropbox -- "https://www.dropbox.com/sh/…?dl=0"
npm run examples:build
npm run examples:manifest
npm run examples:verify
```
