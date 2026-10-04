/**
 * Download a public Dropbox shared-folder link and refresh examples/*.mscz.
 *
 * No Dropbox API token is required: folder shared links with ?dl=1 return a ZIP.
 *
 *   node scripts/fetch-dropbox-examples.mjs <dropbox-shared-folder-url>
 *
 * Env: DROPBOX_EXAMPLES_URL — used when no CLI arg is given.
 *
 * If the library fingerprint matches examples/.dropbox-sync.json, exits 0 and
 * writes examples/.dropbox-sync-status.json { changed: false } without touching scores.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { execFileSync } from "child_process";
import os from "os";
import { dropboxShareDisplayUrl, normalizeDropboxDlUrl } from "./lib/dropbox-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const examplesDir = path.join(root, "examples");
const statusPath = path.join(examplesDir, ".dropbox-sync-status.json");
const metaPath = path.join(examplesDir, ".dropbox-sync.json");

function listZipPaths(zipPath) {
  const out = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" });
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function writeStatus(status) {
  fs.mkdirSync(examplesDir, { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

function clearManagedExamples(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (/^(\.dropbox-sync\.json|\.dropbox-sync-status\.json|setlist\.json|manifest\.json)$/i.test(name)) {
      continue;
    }
    if (/\.(mscz|mscx|musicxml|xml|mxl)$/i.test(name)) {
      fs.unlinkSync(path.join(dir, name));
    }
  }
}

/**
 * Extract .mscz from zip into tmp and return fingerprint + file list + paths.
 * @param {string} zipPath
 * @param {string[]} entries
 */
function stageMscz(zipPath, entries) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-dropbox-"));
  const msczEntries = entries.filter(
    (e) => /\.mscz$/i.test(e) && !e.includes("__MACOSX") && !e.endsWith("/"),
  );
  if (!msczEntries.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error("No .mscz files found in Dropbox folder ZIP");
  }
  execFileSync("unzip", ["-o", zipPath, ...msczEntries, "-d", tmp], {
    stdio: "inherit",
  });
  /** @type {{name:string, bytes:number, sha256:string, src:string}[]} */
  const files = [];
  for (const entry of msczEntries) {
    const src = path.join(tmp, entry);
    if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
    const base = path.basename(entry);
    const buf = fs.readFileSync(src);
    files.push({
      name: base,
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      src,
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  if (!files.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error("Failed to extract any .mscz files");
  }
  const fingerprint = createHash("sha256")
    .update(files.map((f) => `${f.name}:${f.sha256}`).join("\n"))
    .digest("hex");
  return { tmp, files, fingerprint };
}

async function main() {
  const url = normalizeDropboxDlUrl(process.argv[2] || process.env.DROPBOX_EXAMPLES_URL);
  console.log("Fetching Dropbox folder ZIP…");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error("Dropbox download was empty");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error(
      "Download was not a ZIP. Use a Dropbox *folder* shared link (…/sh/…).",
    );
  }

  const zipPath = path.join(os.tmpdir(), `pp-dropbox-${Date.now()}.zip`);
  fs.writeFileSync(zipPath, buf);
  let staged = null;
  try {
    const entries = listZipPaths(zipPath);
    staged = stageMscz(zipPath, entries);

    let prevFingerprint = null;
    if (fs.existsSync(metaPath)) {
      try {
        prevFingerprint = JSON.parse(fs.readFileSync(metaPath, "utf8")).fingerprint || null;
      } catch {
        /* ignore */
      }
    }

    if (prevFingerprint && prevFingerprint === staged.fingerprint) {
      console.log(`Unchanged (fingerprint ${staged.fingerprint.slice(0, 12)}…).`);
      writeStatus({
        changed: false,
        fingerprint: staged.fingerprint,
        fetchedAt: new Date().toISOString(),
      });
      return;
    }

    fs.mkdirSync(examplesDir, { recursive: true });
    clearManagedExamples(examplesDir);

    const setlistEntry = entries.find((e) => /(^|\/)setlist\.json$/i.test(e));
    if (setlistEntry) {
      const tmpSet = fs.mkdtempSync(path.join(os.tmpdir(), "pp-setlist-"));
      try {
        execFileSync("unzip", ["-o", zipPath, setlistEntry, "-d", tmpSet], {
          stdio: "pipe",
        });
        const extracted = path.join(tmpSet, setlistEntry);
        if (fs.existsSync(extracted)) {
          fs.copyFileSync(extracted, path.join(examplesDir, "setlist.json"));
          console.log("Copied setlist.json from Dropbox");
        }
      } finally {
        fs.rmSync(tmpSet, { recursive: true, force: true });
      }
    }

    for (const f of staged.files) {
      fs.copyFileSync(f.src, path.join(examplesDir, f.name));
    }

    const meta = {
      sourceUrl: dropboxShareDisplayUrl(url),
      fetchedAt: new Date().toISOString(),
      fingerprint: staged.fingerprint,
      files: staged.files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    writeStatus({
      changed: true,
      fingerprint: staged.fingerprint,
      fetchedAt: meta.fetchedAt,
      fileCount: staged.files.length,
    });
    console.log(
      `Wrote ${staged.files.length} .mscz file(s); fingerprint ${staged.fingerprint.slice(0, 12)}…`,
    );
  } finally {
    try {
      fs.unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    if (staged?.tmp) {
      try {
        fs.rmSync(staged.tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
