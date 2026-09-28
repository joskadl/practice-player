/**
 * Remote sync: generic HTTP URL and optional GitHub Contents API (commit history).
 */

/**
 * @param {import("./local-store.js").SyncSettings} settings
 * @param {string} [packId]
 */
export function resolveRemoteTarget(settings, packId = "") {
  const owner = (settings.githubOwner || "").trim();
  const repo = (settings.githubRepo || "").trim();
  const token = (settings.githubToken || "").trim();
  let path = (settings.githubPath || "shared/").trim();
  if (owner && repo) {
    if (path.endsWith("/")) path = `${path}${packId || "project"}.practice.json`;
    return {
      kind: "github",
      owner,
      repo,
      path: path.replace(/^\//, ""),
      branch: (settings.githubBranch || "main").trim() || "main",
      token,
    };
  }
  const url = (settings.remoteUrl || "").trim();
  if (url) return { kind: "http", url, token };
  return null;
}

async function githubHeaders(token, extra = {}) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubContentsUrl(owner, repo, path, branch) {
  const encPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  let url = `https://api.github.com/repos/${owner}/${repo}/contents/${encPath}`;
  if (branch) url += `?ref=${encodeURIComponent(branch)}`;
  return url;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * @returns {Promise<{ pack: object, sha?: string, etag?: string }|null>}
 */
export async function pullRemote(settings, packId) {
  const target = resolveRemoteTarget(settings, packId);
  if (!target) throw new Error("Configure a sync remote (GitHub repo or URL) first.");

  if (target.kind === "github") {
    const api = await githubContentsUrl(target.owner, target.repo, target.path, target.branch);
    const res = await fetch(api, { headers: await githubHeaders(target.token) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub pull failed (${res.status})`);
    const body = await res.json();
    const jsonText = base64ToUtf8(body.content || "");
    return { pack: JSON.parse(jsonText), sha: body.sha };
  }

  const headers = {};
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  const res = await fetch(target.url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Pull failed (${res.status})`);
  const pack = await res.json();
  return { pack, etag: res.headers.get("ETag") || undefined };
}

/**
 * @param {object} pack
 * @param {string} [sha] GitHub blob sha for update (omit to create)
 */
export async function pushRemote(settings, pack, { sha, message } = {}) {
  const target = resolveRemoteTarget(settings, pack.id);
  if (!target) throw new Error("Configure a sync remote (GitHub repo or URL) first.");

  const bodyText = `${JSON.stringify(pack, null, 2)}\n`;

  if (target.kind === "github") {
    if (!target.token) {
      throw new Error("GitHub push needs a personal access token (Contents: Read/Write) saved in Sync settings.");
    }
    const api = await githubContentsUrl(target.owner, target.repo, target.path, "");
    const payload = {
      message: message || `practice: ${pack.title || pack.id} r${pack.rev}`,
      content: utf8ToBase64(bodyText),
      branch: target.branch,
    };
    if (sha) payload.sha = sha;
    const res = await fetch(api, {
      method: "PUT",
      headers: await githubHeaders(target.token, { "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 409 || res.status === 422) {
      const err = new Error("Remote changed since your last pull — pull first, then push again.");
      err.code = "conflict";
      throw err;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`GitHub push failed (${res.status}) ${detail.slice(0, 180)}`);
    }
    const body = await res.json();
    return { sha: body.content?.sha || body.commit?.sha };
  }

  const headers = { "Content-Type": "application/json" };
  if (target.token) headers.Authorization = `Bearer ${target.token}`;
  const res = await fetch(target.url, {
    method: "PUT",
    headers,
    body: bodyText,
  });
  if (res.status === 409) {
    const err = new Error("Remote conflict — pull first, then push again.");
    err.code = "conflict";
    throw err;
  }
  if (!res.ok) throw new Error(`Push failed (${res.status}). Does the remote allow PUT?`);
  return {};
}

export function syncConfigured(settings) {
  return !!resolveRemoteTarget(settings, "x");
}
