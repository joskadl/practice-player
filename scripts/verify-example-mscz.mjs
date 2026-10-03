/**
 * Verify every examples/*.mscz converts to usable MusicXML (MuseScore CLI).
 * Does not leave sibling .musicxml files behind.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples");
const manifest = JSON.parse(
  fs.readFileSync(path.join(examplesDir, "manifest.json"), "utf8"),
);

function findMuseScoreCli() {
  const candidates = [
    process.env.MUSESCORE_CLI,
    path.join(process.env.ProgramFiles || "C:\\Program Files", "MuseScore 4", "bin", "MuseScore4.exe"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "MuseScore 3", "bin", "MuseScore3.exe"),
    "mscore",
    "MuseScore4",
  ].filter(Boolean);
  for (const cmd of candidates) {
    if (cmd.includes("\\") || cmd.includes("/")) {
      if (fs.existsSync(cmd)) return cmd;
      continue;
    }
    const probe = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return cmd;
  }
  return null;
}

const cli = findMuseScoreCli();
if (!cli) {
  console.error("MuseScore CLI not found");
  process.exit(1);
}
console.log("Using", cli);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-verify-mscz-"));
let failed = 0;
try {
  for (const ex of manifest.examples || []) {
    const file = ex.file;
    const src = path.join(examplesDir, file);
    if (!fs.existsSync(src)) {
      console.error("MISSING", file);
      failed++;
      continue;
    }
    if (!/\.mscz$/i.test(file)) {
      console.error("NOT MSCZ", file);
      failed++;
      continue;
    }
    const out = path.join(tmp, file.replace(/\.mscz$/i, ".musicxml"));
    const result = spawnSync(cli, ["-o", out, src], {
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
    });
    if (result.status !== 0 || !fs.existsSync(out)) {
      console.error("CONVERT FAIL", file, result.stderr || result.stdout);
      failed++;
      continue;
    }
    const xml = fs.readFileSync(out, "utf8");
    const ok =
      xml.includes("<score-partwise")
      && /<note\b/i.test(xml)
      && xml.length > 1000;
    if (!ok) {
      console.error("INVALID XML", file, "len", xml.length);
      failed++;
      continue;
    }
    console.log("OK", ex.id, `(${xml.length} chars)`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.error(`Failed: ${failed}`);
  process.exit(1);
}
console.log("All example .mscz files convert successfully.");
