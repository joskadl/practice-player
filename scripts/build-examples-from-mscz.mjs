/**
 * Precompute MusicXML from example .mscz / .mscx sources for deploy / offline loads.
 *
 *   npm run examples:build
 *
 * Requires the MuseScore CLI (`mscore` / `MuseScore4.exe` / `$MUSESCORE_CLI`).
 * webmscore WASM often emits empty scores for MuseScore 4 files — do not use it
 * for shipped example caches. Commit the generated sibling *.musicxml next to
 * each *.mscz; Pages deploy verifies they exist via `npm run examples:verify`.
 *
 * Source of truth: examples/*.mscz. Writes sibling *.musicxml and stamps
 * practice-player-home-key when known.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const examplesDir = path.join(root, "examples");

const HOME_BY_FILE = {
  "blue-christmas-for-barbershopers.mscz": "Bb major",
  "entre-le-boeuf-et-lane-gris.mscz": "G major",
  "gabriels-message-satb.mscz": "A minor",
  "gaudete-christus-est-natus.mscz": "A minor",
  "gloria-in-excelsis-deo.mscz": "G major",
  "gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.mscz": "G major",
  "please-come-home-for-christmas.mscz": "E major",
  "stille-nacht.mscz": "C major",
};

function upsertHomeKey(xml, label) {
  const field = `<miscellaneous-field name="practice-player-home-key">${label}</miscellaneous-field>`;
  if (xml.includes('name="practice-player-home-key"')) {
    return xml.replace(
      /<miscellaneous-field name="practice-player-home-key">[\s\S]*?<\/miscellaneous-field>/,
      field,
    );
  }
  if (/<miscellaneous>/i.test(xml)) {
    return xml.replace(/<miscellaneous>/i, `<miscellaneous>\n      ${field}`);
  }
  if (/<\/identification>/i.test(xml)) {
    return xml.replace(
      /<\/identification>/i,
      `    <miscellaneous>\n      ${field}\n    </miscellaneous>\n  </identification>`,
    );
  }
  return xml;
}

function findMuseScoreCli() {
  const candidates = [
    process.env.MUSESCORE_CLI,
    "mscore",
    "mscore3",
    "mscore4",
    "musescore",
    "MuseScore4",
    "MuseScore3",
    path.join(
      process.env["ProgramFiles"] || "C:\\Program Files",
      "MuseScore 4",
      "bin",
      "MuseScore4.exe",
    ),
    path.join(
      process.env["ProgramFiles"] || "C:\\Program Files",
      "MuseScore 3",
      "bin",
      "MuseScore3.exe",
    ),
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

function convertWithCli(cli, srcPath, outPath) {
  const result = spawnSync(cli, ["-o", outPath, srcPath], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      `MuseScore CLI failed (${result.status}): ${result.stderr || result.stdout || "no output"}`,
    );
  }
  if (!fs.existsSync(outPath)) {
    throw new Error(`MuseScore CLI did not write ${outPath}`);
  }
}

function convertOne(fileName, cli) {
  const srcPath = path.join(examplesDir, fileName);
  const outName = fileName.replace(/\.(mscz|mscx)$/i, ".musicxml");
  const outPath = path.join(examplesDir, outName);

  convertWithCli(cli, srcPath, outPath);
  let xml = fs.readFileSync(outPath, "utf8");

  const home =
    HOME_BY_FILE[fileName]
    || HOME_BY_FILE[fileName.replace(/\.mscx$/i, ".mscz")];
  if (home) xml = upsertHomeKey(xml, home);

  const noteCount = (xml.match(/<note[\s>]/g) || []).length;
  if (noteCount < 1) {
    throw new Error(`${outName}: MuseScore CLI wrote MusicXML with no <note> elements`);
  }

  fs.writeFileSync(outPath, xml, "utf8");
  console.log(`wrote ${outName} (${xml.length} chars, ${noteCount} notes) from ${fileName}`);
}

function main() {
  const sources = fs
    .readdirSync(examplesDir)
    .filter((n) => /\.(mscz|mscx)$/i.test(n))
    .sort();
  if (!sources.length) {
    console.log("No .mscz/.mscx files in examples/ — nothing to do.");
    return;
  }

  const cli = findMuseScoreCli();
  if (!cli) {
    console.error(
      "MuseScore CLI not found. Install MuseScore 4 or set MUSESCORE_CLI.\n"
        + "webmscore is not used for example caches (MuseScore 4 → empty XML).",
    );
    process.exit(1);
  }
  console.log(`Using MuseScore CLI: ${cli}`);

  for (const name of sources) {
    convertOne(name, cli);
  }
  console.log(`Done (${sources.length} file${sources.length === 1 ? "" : "s"}).`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
