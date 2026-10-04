/** Shared Dropbox shared-folder URL helpers (no API token). */

/**
 * Force a Dropbox folder share URL to download the folder ZIP.
 * @param {string} raw
 */
export function normalizeDropboxDlUrl(raw) {
  let url = String(raw || "").trim();
  if (!url) throw new Error("Missing Dropbox shared folder URL");
  url = url.replace(/\?dl=0\b/i, "?dl=1");
  if (!/[?&]dl=1\b/i.test(url)) {
    url += url.includes("?") ? "&dl=1" : "?dl=1";
  }
  return url;
}

/**
 * Strip download query params for display / fingerprint metadata.
 * @param {string} url
 */
export function dropboxShareDisplayUrl(url) {
  return String(url || "")
    .replace(/[?&]dl=1\b/i, "")
    .replace(/\?$/, "");
}
