/**
 * Build examples/manifest.json from examples/*.mscz (+ optional setlist.json).
 * Titles come from sibling .musicxml <work-title> / <movement-title> when present,
 * else from the filename.
 *
 *   node scripts/build-examples-manifest.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples");

function titleFromMusicXml(xmlPath) {
  if (!fs.existsSync(xmlPath)) return null;
  const xml = fs.readFileSync(xmlPath, "utf8");
  const work = xml.match(/<work-title[^>]*>([\s\S]*?)<\/work-title>/i);
  if (work?.[1]) return work[1].replace(/<[^>]+>/g, "").trim();
  const mov = xml.match(/<movement-title[^>]*>([\s\S]*?)<\/movement-title>/i);
  if (mov?.[1]) return mov[1].replace(/<[^>]+>/g, "").trim();
  return null;
}

function titleFromFileName(file) {
  return file
    .replace(/\.mscz$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugId(file) {
  return file.replace(/\.mscz$/i, "").toLowerCase();
}

function main() {
  const mscz = fs
    .readdirSync(examplesDir)
    .filter((n) => /\.mscz$/i.test(n))
    .sort((a, b) => a.localeCompare(b));

  /** @type {Map<string, number>} */
  let order = null;
  const setlistPath = path.join(examplesDir, "setlist.json");
  if (fs.existsSync(setlistPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(setlistPath, "utf8"));
      const list = Array.isArray(raw) ? raw : raw?.order || raw?.files || [];
      order = new Map();
      list.forEach((item, i) => {
        const name = String(typeof item === "string" ? item : item?.file || "")
          .replace(/^\/+/, "");
        if (name) order.set(name.replace(/\.mscz$/i, "").toLowerCase(), i);
      });
    } catch (err) {
      console.warn("Could not parse setlist.json:", err.message);
    }
  }

  let examples = mscz.map((file) => {
    const xmlSibling = file.replace(/\.mscz$/i, ".musicxml");
    const title =
      titleFromMusicXml(path.join(examplesDir, xmlSibling)) || titleFromFileName(file);
    return {
      id: slugId(file),
      title,
      file,
      format: "mscz",
      description: "From Dropbox score library",
    };
  });

  if (order) {
    examples.sort((a, b) => {
      const ai = order.has(a.id) ? order.get(a.id) : 1e9;
      const bi = order.has(b.id) ? order.get(b.id) : 1e9;
      if (ai !== bi) return ai - bi;
      return a.title.localeCompare(b.title);
    });
  }

  const out = { examples };
  fs.writeFileSync(
    path.join(examplesDir, "manifest.json"),
    `${JSON.stringify(out, null, 2)}\n`,
    "utf8",
  );
  console.log(`Wrote manifest.json (${examples.length} example${examples.length === 1 ? "" : "s"})`);
}

main();
