# Dropbox score library

Use a **Dropbox shared folder** of `.mscz` files as the source of truth for the built-in **Examples** list. The Practice Player does **not** convert in the browser and has **no in-app Dropbox sync UI**. Updates are done from GitHub Actions (or locally), then Pages redeploys.

## Secrets

| Secret | Needed? |
|--------|---------|
| `DROPBOX_EXAMPLES_URL` (GitHub Actions **secret**) | **Yes** — folder share link (`https://www.dropbox.com/scl/fo/…` or `/sh/…`). Not published in the site or `examples/.dropbox-sync.json`. |
| Dropbox API token | **No** — the workflow downloads the folder ZIP (`?dl=1`). |

## Dropbox folder layout

```
My choir scores/          ← share this folder (view)
  stille-nacht.mscz
  gaudete.mscz
  setlist.json            ← optional order only: ["stille-nacht.mscz", …]
```

`setlist.json` may be a JSON array of filenames, or `{ "order": […] }` / `{ "files": […] }`. Unknown entries are ignored; scores missing from the list sort after the setlist (by title). The sync fingerprint includes the setlist, so **order-only edits still redeploy**.

The player’s Open menu follows that order (heading becomes **Setlist** when present). With two or more catalog songs loaded from Examples, **‹ ›** appear beside the title (`n / total`); **Alt+← / Alt+→** step the setlist.

Titles come from the scores after MuseScore → MusicXML conversion.

## Sync / deploy (maintainers)

1. Ensure `DROPBOX_EXAMPLES_URL` is set under **Settings → Secrets and variables → Actions**.
2. The workflow runs **every 15 minutes** on a schedule (and can still be started manually: **Actions → Sync Dropbox examples → Run workflow**).
3. If the folder fingerprint changed, the job converts `.mscz` → `.musicxml`, updates the catalog, bumps the service-worker cache id, commits, and deploys Pages. Unchanged libraries exit early after the fetch/fingerprint check.

You can keep the same app **version** (`version.json` / tag). The sync workflow still bumps `sw.js` `CACHE` when examples change so installed clients pick up new MusicXML. A plain **Deploy GitHub Pages** re-run of an unchanged commit does **not** refresh example content by itself — run **Sync Dropbox examples** (or push new example files) when the library changes.

Converted scores on Pages remain public; only the Dropbox share URL stays secret.

## Local (optional)

With MuseScore installed:

```bash
npm run examples:fetch-dropbox -- "https://www.dropbox.com/scl/fo/…?dl=0"
npm run examples:build
npm run examples:manifest
npm run examples:verify
```
