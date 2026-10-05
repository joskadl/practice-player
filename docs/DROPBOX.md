# Dropbox score library

Use a **Dropbox shared folder** of `.mscz` files as the source of truth. The Practice Player does **not** convert in the browser; a GitHub Action fetches the folder, converts with MuseScore CLI, regenerates `examples/manifest.json`, commits, and GitHub Pages redeploys.

## Secrets (keep the folder URL off the public site)

| Secret | Needed? |
|--------|---------|
| `DROPBOX_EXAMPLES_URL` (GitHub Actions **secret**) | **Yes** — the folder share link (`https://www.dropbox.com/scl/fo/…` or `/sh/…`). Stored only in the repo’s Actions secrets. Not written into `examples/.dropbox-sync.json`, not accepted as a workflow input, not shown in the app UI. |
| Dropbox API token | **No** — the workflow downloads the folder ZIP (`?dl=1`). |
| GitHub PAT (maintainers only) | **Yes** (device-local) — Actions: Read and write so the app can start/poll the sync workflow. |

Do **not** store the folder URL as a repository *variable* (variables are easier to read). Prefer **Settings → Secrets and variables → Actions → Secrets**.

Anyone who already has the share link can still open the Dropbox folder; this only stops the Practice Player site/repo from publishing that link. Converted scores on Pages remain public by design.

## Dropbox folder layout

```
My choir scores/          ← share this folder (view)
  stille-nacht.mscz
  gaudete.mscz
  setlist.json            ← optional order only: ["stille-nacht.mscz", …]
```

Titles and other metadata come from the scores (MusicXML `work-title` after conversion / MuseScore project properties). No hand-maintained `catalog.json`.

## App button: Sync scores from Dropbox

1. Ensure `DROPBOX_EXAMPLES_URL` is set as an Actions secret on the repo.
2. Open **Score library (Dropbox)** → GitHub owner/repo/`practice-player`, branch `main`, and PAT.
3. **Save settings**, then **Sync scores from Dropbox**.

The button:

- Does not send the Dropbox URL from the browser (secret only).
- Refuses to start a second run while one is already queued/in progress (joins the existing run instead).
- Waits for the workflow, then for Pages to publish a new `examples/.dropbox-sync.json` fingerprint.
- Reloads the app when new scores are live; reports “already up to date” if Dropbox matched the repo.

## Manual / CI

- Actions → **Sync Dropbox examples** → Run workflow (uses the secret).

Local (with MuseScore installed; pass the URL only on your machine):

```bash
npm run examples:fetch-dropbox -- "https://www.dropbox.com/scl/fo/…?dl=0"
npm run examples:build
npm run examples:manifest
npm run examples:verify
```
