/**
 * Stamp practice-player-home-key + <mode> on example MusicXML scores.
 *
 *   node scripts/stamp-example-keys.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples");

const HOME_KEY_FIELD = "practice-player-home-key";

/** Curated home keys (override ambiguous / wrong first-measure signatures). */
const HOME_BY_FILE = {
  "blue-christmas-for-barbershopers.musicxml": "Bb major",
  "entre-le-boeuf-et-lane-gris.musicxml": "G major",
  "gabriels-message-satb.musicxml": "A minor",
  "gaudete-christus-est-natus.musicxml": "A minor",
  "gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.musicxml": "G major",
  "please-come-home-for-christmas.musicxml": "E major",
  "stille-nacht.musicxml": "C major",
};

function ensureModeInFirstKeys(xml, mode) {
  // Insert <mode>…</mode> after each <fifths>…</fifths> inside <key> when missing.
  return xml.replace(/<key>([\s\S]*?)<\/key>/g, (block) => {
    if (/<mode>/i.test(block)) return block;
    return block.replace(
      /(<fifths>\s*-?\d+\s*<\/fifths>)/i,
      `$1\n        <mode>${mode}</mode>`,
    );
  });
}

function upsertHomeKeyField(xml, label) {
  const fieldXml = `<miscellaneous-field name="${HOME_KEY_FIELD}">${label}</miscellaneous-field>`;
  if (xml.includes(`name="${HOME_KEY_FIELD}"`)) {
    return xml.replace(
      new RegExp(
        `<miscellaneous-field\\s+name="${HOME_KEY_FIELD}"\\s*>[\\s\\S]*?<\\/miscellaneous-field>`,
        "i",
      ),
      fieldXml,
    );
  }
  if (/<miscellaneous>/i.test(xml)) {
    return xml.replace(/<miscellaneous>/i, `<miscellaneous>\n      ${fieldXml}`);
  }
  if (/<\/identification>/i.test(xml)) {
    return xml.replace(
      /<\/identification>/i,
      `  <miscellaneous>\n      ${fieldXml}\n    </miscellaneous>\n  </identification>`,
    );
  }
  // No identification — insert after movement-title / work.
  if (/<\/movement-title>/i.test(xml)) {
    return xml.replace(
      /<\/movement-title>/i,
      `</movement-title>\n  <identification>\n    <miscellaneous>\n      ${fieldXml}\n    </miscellaneous>\n  </identification>`,
    );
  }
  return xml.replace(
    /<score-partwise([^>]*)>/i,
    `<score-partwise$1>\n  <identification>\n    <miscellaneous>\n      ${fieldXml}\n    </miscellaneous>\n  </identification>`,
  );
}

const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith(".musicxml"));

let missing = 0;
for (const file of files) {
  const full = path.join(examplesDir, file);
  const home =
    HOME_BY_FILE[file] ||
    HOME_BY_FILE[file.replace(/_ji(?=\.musicxml$)/i, "")] ||
    null;
  if (!home) {
    console.warn("skip (no curated key):", file);
    missing += 1;
    continue;
  }
  const mode = /\bminor\b/i.test(home) ? "minor" : "major";
  let xml = fs.readFileSync(full, "utf8");
  xml = ensureModeInFirstKeys(xml, mode);
  xml = upsertHomeKeyField(xml, home);
  fs.writeFileSync(full, xml, "utf8");
  console.log(`${file}: ${home}`);
}
if (missing) process.exitCode = 1;
