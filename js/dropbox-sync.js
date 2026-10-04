/**
 * Trigger / poll the GitHub Action that syncs examples from a public Dropbox folder.
 *
 * Dropbox itself needs no token (public folder ZIP). Triggering the workflow needs a
 * GitHub token with Actions: Read + Write on the practice-player repo (stored in Sync settings).
 */

const WORKFLOW_FILE = "sync-dropbox-examples.yml";

/**
 * @typedef {{
 *   githubOwner: string,
 *   githubRepo: string,
 *   githubBranch?: string,
 *   githubToken: string,
 *   dropboxUrl?: string,
 * }} DropboxSyncSettings
 */

/**
 * @param {DropboxSyncSettings} settings
 */
export function dropboxSyncConfigured(settings) {
  return !!(
    settings?.githubOwner?.trim()
    && settings?.githubRepo?.trim()
    && settings?.githubToken?.trim()
    && (settings?.dropboxUrl?.trim() || true) // URL may live only in repo secret
  );
}

/**
 * @param {DropboxSyncSettings} settings
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function ghApi(settings, path, init = {}) {
  const owner = settings.githubOwner.trim();
  const repo = settings.githubRepo.trim();
  const token = settings.githubToken.trim();
  const url = `https://api.github.com/repos/${owner}/${repo}${path}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    ...(init.headers || {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      (body && body.message) || `GitHub API ${res.status} ${res.statusText}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/**
 * @param {DropboxSyncSettings} settings
 * @returns {Promise<object|null>} newest in-progress or queued run, else null
 */
export async function findActiveDropboxSyncRun(settings) {
  for (const status of ["in_progress", "queued", "waiting"]) {
    const q = new URLSearchParams({ per_page: "5", status });
    const data = await ghApi(
      settings,
      `/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/runs?${q}`,
    );
    const run = (data?.workflow_runs || [])[0];
    if (run) return run;
  }
  return null;
}

/**
 * @param {DropboxSyncSettings} settings
 * @param {number} runId
 */
export async function getWorkflowRun(settings, runId) {
  return ghApi(settings, `/actions/runs/${runId}`);
}

/**
 * Start a sync unless one is already queued/running.
 * @param {DropboxSyncSettings} settings
 * @returns {Promise<{ started: boolean, run: object|null, reason?: string }>}
 */
export async function triggerDropboxSync(settings) {
  if (!settings?.githubToken?.trim()) {
    throw new Error(
      "GitHub token required (Actions: Read and Write) to sync the score library.",
    );
  }
  if (!settings?.githubOwner?.trim() || !settings?.githubRepo?.trim()) {
    throw new Error("GitHub owner and repo are required in Sync settings.");
  }

  const active = await findActiveDropboxSyncRun(settings);
  if (active) {
    return {
      started: false,
      run: active,
      reason: "already_running",
    };
  }

  const branch = (settings.githubBranch || "main").trim() || "main";
  const dropboxUrl = (settings.dropboxUrl || "").trim();
  await ghApi(
    settings,
    `/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref: branch,
        inputs: dropboxUrl ? { dropbox_url: dropboxUrl } : {},
      }),
    },
  );

  // Dispatch is async — poll briefly for the new run.
  let run = null;
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    run = await findActiveDropboxSyncRun(settings);
    if (run) break;
    // Also accept a just-completed run created after our dispatch.
    const recent = await ghApi(
      settings,
      `/actions/workflows/${encodeURIComponent(WORKFLOW_FILE)}/runs?per_page=1`,
    );
    const latest = recent?.workflow_runs?.[0];
    if (latest && Date.now() - new Date(latest.created_at).getTime() < 60_000) {
      run = latest;
      break;
    }
  }

  return { started: true, run };
}

/**
 * Poll until the run finishes (or timeout).
 * @param {DropboxSyncSettings} settings
 * @param {number} runId
 * @param {{ onTick?: (run: object) => void, timeoutMs?: number }} [opts]
 */
export async function waitForWorkflowRun(settings, runId, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = await getWorkflowRun(settings, runId);
    opts.onTick?.(run);
    if (run.status === "completed") return run;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Timed out waiting for Dropbox sync workflow.");
}
