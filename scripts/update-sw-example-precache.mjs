/**
 * Rewrite the example MusicXML entries in sw.js PRECACHE from examples/*.musicxml.
 *
 *   node scripts/update-sw-example-precache.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const swPath = path.join(root, "sw.js");
const examplesDir = path.join(root, "examples");

const musicxml = fs
  .readdirSync(examplesDir)
  .filter((n) => /\.musicxml$/i.test(n))
  .sort((a, b) => a.localeCompare(b));

let sw = fs.readFileSync(swPath, "utf8");
const re =
  /\/\/ Pre-converted MusicXML[\s\S]*?(?=\n\];)/;
if (!re.test(sw)) {
  console.error("Could not find example MusicXML PRECACHE block in sw.js");
  process.exit(1);
}
const block = [
  "// Pre-converted MusicXML (from examples/*.mscz via npm run examples:build)",
  ...musicxml.map((n) => `  "./examples/${n}",`),
].join("\n");
sw = sw.replace(re, block);
fs.writeFileSync(swPath, sw, "utf8");
console.log(
  `Updated sw.js PRECACHE (${musicxml.length} MusicXML file${musicxml.length === 1 ? "" : "s"})`,
);
