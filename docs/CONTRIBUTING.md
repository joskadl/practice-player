# Contributing / developing

## Quick start

```bash
python -m http.server 8765
```

Open http://localhost:8765/ — no bundler required.

## Before you ship a change

1. Exercise load → play → mute/solo → sheet edit → export MusicXML.
2. If you touch sync: export/import pack, undo, and (if possible) pull/push against a test repo.
3. Bump `sw.js` `CACHE` id and add any new scripts to `PRECACHE`.
4. If the release is user-facing, bump `package.json` + `js/version.js`.
5. Prefer conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).

## Code style

- Vanilla ES modules; keep UI wiring in `js/main.js`, domain logic in focused modules.
- Match existing naming and comment density; avoid drive-by refactors.
- Do not commit secrets, tokens, or large unrelated assets.

## Docs

- User + developer overview: [README.md](../README.md)
- Choir sync hosting: [SYNC.md](SYNC.md)
