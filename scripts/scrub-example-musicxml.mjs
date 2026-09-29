#!/usr/bin/env node
/**
 * Strip personal name metadata (creators / person credits) from example MusicXML.
 *
 * Usage:
 *   node scripts/scrub-example-musicxml.mjs [file.musicxml ...]
 *   node scripts/scrub-example-musicxml.mjs   # all *.musicxml under examples/
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const examplesDir = path.join(root, "examples");

const PERSONAL_CREDIT_TYPES = new Set([
  "composer",
  "lyricist",
  "arranger",
  "translator",
  "poet",
  "librettist",
  "transcriber",
  "encoder",
]);

function localName(el) {
  return el?.localName || el?.tagName?.replace(/^.*:/, "") || "";
}

function childrenByName(parent, name) {
  if (!parent?.children) return [];
  return [...parent.children].filter((el) => localName(el) === name);
}

function firstChild(parent, name) {
  return childrenByName(parent, name)[0] || null;
}

function scrubXml(xmlText) {
  // Prefer DOMParser when available (browsers); Node 22+ has it via undici/experimental.
  const { DOMParser, XMLSerializer } = globalThis;
  if (!DOMParser || !XMLSerializer) {
    // Lightweight tag scrub without a full XML DOM dependency.
    let out = xmlText.replace(/<creator\b[^>]*>[\s\S]*?<\/creator>/gi, "");
    out = out.replace(/<rights\b[^>]*>[\s\S]*?<\/rights>/gi, "");
    out = out.replace(/<source\b[^>]*>[\s\S]*?<\/source>/gi, "");
    out = out.replace(/<credit\b[^>]*>[\s\S]*?<\/credit>/gi, (block) => {
      const typeMatch = block.match(/<credit-type[^>]*>\s*([^<]+)\s*<\/credit-type>/i);
      const type = typeMatch?.[1]?.trim().toLowerCase() || "";
      if (!type || PERSONAL_CREDIT_TYPES.has(type)) return "";
      return block;
    });
    return out;
  }
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid MusicXML");
  const root = doc.documentElement;
  const identification = firstChild(root, "identification");
  if (identification) {
    for (const name of ["creator", "rights", "source"]) {
      for (const el of [...childrenByName(identification, name)]) el.remove();
    }
  }
  for (const credit of [...childrenByName(root, "credit")]) {
    const type = firstChild(credit, "credit-type")?.textContent?.trim().toLowerCase();
    if (!type || PERSONAL_CREDIT_TYPES.has(type)) credit.remove();
  }
  const serialized = new XMLSerializer().serializeToString(doc);
  return serialized.startsWith("<?xml") ? serialized : `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
}

function collectTargets(argv) {
  if (argv.length) return argv.map((p) => path.resolve(p));
  if (!fs.existsSync(examplesDir)) return [];
  return fs
    .readdirSync(examplesDir)
    .filter((f) => /\.(musicxml|xml)$/i.test(f))
    .map((f) => path.join(examplesDir, f));
}

const targets = collectTargets(process.argv.slice(2));
if (!targets.length) {
  console.error("No MusicXML files found.");
  process.exit(1);
}

let changed = 0;
for (const file of targets) {
  const before = fs.readFileSync(file, "utf8");
  const after = scrubXml(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    changed += 1;
    console.log(`scrubbed ${path.relative(root, file)}`);
  } else {
    console.log(`clean    ${path.relative(root, file)}`);
  }
}
console.log(`Done (${changed} updated).`);
