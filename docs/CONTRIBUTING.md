# Contributing / developing

## Quick start

```bash
python -m http.server 8765
```

Open http://localhost:8765/ — no bundler required.

## Tests

```bash
npm test
```

Node’s built-in test runner covers score metadata, practice packs, MuseScore metaTag import, Dropbox URL helpers, example smoke checks, and JI remapping (`scripts/test-ji-remap.mjs`). CI runs the same suite in `.github/workflows/test.yml`.

Interop with JustPlay: keep `js/score-meta.js` field names aligned with JustPlay `core/score_meta.py` (enforced there by `tests/test_score_meta_contract.py` when this tree is present).

## Before you ship a change

1. Exercise load → play → mute/solo → sheet edit → export MusicXML.
2. If you touch sync: export/import pack, undo, and (if possible) pull/push against a test repo.
3. If you change `examples/*.mscz`, run `npm run examples:build` (MuseScore CLI) and commit the sibling `.musicxml` files; `npm run examples:verify` must pass (Pages deploy checks this).
4. Bump `sw.js` `CACHE` id and add any new scripts / example MusicXML paths to `PRECACHE`.
5. If the release is user-facing, bump `package.json` + `js/version.js` + `version.json`.
6. Prefer conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Code style

- Vanilla ES modules; keep UI wiring in `js/main.js`, domain logic in focused modules.
- Match existing naming and comment density; avoid drive-by refactors.
- Do not commit secrets, tokens, or large unrelated assets.

## Docs

- User + developer overview: [README.md](../README.md)
- Choir sync hosting: [SYNC.md](SYNC.md)
