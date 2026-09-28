# Shared sync setup (GitHub)

This guide is for whoever hosts the choir’s shared practice packs.

## Why GitHub?

Each **Push** from the app uses the [GitHub Contents API](https://docs.github.com/en/rest/repos/contents) and creates a **git commit**. You get:

- Full history in the repository (diff, revert, blame)
- Free hosting next to GitHub Pages
- Pull without a token on **public** repos

## One-time setup

### 1. Repository

Use this app’s repo or a dedicated `choir-scores` repo. Create an empty folder, e.g. `shared/`, and commit a `.gitkeep` if you like.

### 2. Personal access token (for Push)

1. GitHub → **Settings → Developer settings → Personal access tokens**.
2. Create a **fine-grained** token:
   - Resource owner: your user or org  
   - Repository access: only the scores repo  
   - Permissions: **Contents → Read and write**
3. Copy the token once.

Only devices that need to **Push** must store the token (Sync settings). Singers who only **Pull** from a public repo can leave the token blank.

### 3. App Sync settings (each Push-capable device)

| Field | Example |
|-------|---------|
| Your name | `Joska` |
| Owner | `your-github-username` |
| Repo | `midi-practice-player` |
| Path | `shared/` |
| Branch | `main` |
| Token | `github_pat_…` |

Path ending in `/` means the app writes `shared/<projectId>.practice.json`.

Click **Save settings** (stored in that browser’s IndexedDB only).

## Day-to-day

1. Open / edit the MusicXML in the player.
2. Add rehearsal notes, rename parts, adjust colours as needed.
3. **Push** when online → new commit on GitHub.
4. Others **Pull** to receive the latest pack.

If someone else pushed first, Push may fail with a conflict message → **Pull** (export a backup pack if you have local-only work), then re-apply and Push again.

## Manual fallback (no token)

- **Export pack** → share `.practice.json` via chat/Drive  
- Recipients **Import pack**

## Security notes

- Do not commit PATs into the repo or paste them into group chats.
- Prefer fine-grained tokens scoped to one repo; revoke if a device is lost.
- Practice packs contain the full MusicXML — treat the repo’s visibility accordingly (public vs private).

## Generic HTTP remote

If you host JSON yourself:

- **Pull:** `GET` URL returning practice-pack JSON  
- **Push:** `PUT` same URL with `Content-Type: application/json`  
- Optional `Authorization: Bearer <token>`

Enter the full URL in **Or generic remote JSON URL** and leave GitHub owner/repo empty.
