/**
 * Ensure every examples/*.mscz has a sibling .musicxml with parseable notes.
 * Run after `npm run examples:build` (MuseScore CLI). Used by Pages deploy.
 *
 *   npm run examples:verify
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples");

const sources = fs
  .readdirSync(examplesDir)
  .filter((n) => /\.mscz$/i.test(n))
  .sort();

if (!sources.length) {
  console.error("No examples/*.mscz found");
  process.exit(1);
}

let failed = 0;
for (const mscz of sources) {
  const xmlName = mscz.replace(/\.mscz$/i, ".musicxml");
  const xmlPath = path.join(examplesDir, xmlName);
  if (!fs.existsSync(xmlPath)) {
    console.error(`MISSING ${xmlName} (run: npm run examples:build)`);
    failed += 1;
    continue;
  }
  const text = fs.readFileSync(xmlPath, "utf8");
  const hasScore =
    text.includes("<score-partwise") || text.includes("<score-timewise");
  const noteCount = (text.match(/<note[\s>]/g) || []).length;
  if (!hasScore || noteCount < 1) {
    console.error(
      `BAD ${xmlName}: score=${hasScore} notes=${noteCount} (rebuild with MuseScore CLI)`,
    );
    failed += 1;
    continue;
  }
  console.log(`ok ${xmlName} (${noteCount} notes)`);
}

// Manifest files must also have siblings when they point at .mscz
const manifestPath = path.join(examplesDir, "manifest.json");
if (fs.existsSync(manifestPath)) {
  const { examples = [] } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const ex of examples) {
    const file = String(ex.file || "");
    if (!/\.mscz$/i.test(file)) continue;
    const sibling = file.replace(/\.mscz$/i, ".musicxml");
    if (!fs.existsSync(path.join(examplesDir, sibling))) {
      console.error(`MISSING ${sibling} for manifest entry ${ex.id || file}`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n${failed} example MusicXML issue(s).`);
  process.exit(1);
}
console.log(`\nAll ${sources.length} example MusicXML caches look good.`);
