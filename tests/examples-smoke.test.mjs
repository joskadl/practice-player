import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const examplesDir = path.join(__dirname, "..", "examples");

describe("committed example library smoke", () => {
  it("manifest lists .mscz files that exist with MusicXML siblings containing notes", () => {
    const manifestPath = path.join(examplesDir, "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "examples/manifest.json missing");
    const { examples } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(Array.isArray(examples) && examples.length > 0);

    for (const ex of examples) {
      const mscz = path.join(examplesDir, ex.file);
      assert.ok(fs.existsSync(mscz), `missing ${ex.file}`);
      const xmlName = String(ex.file).replace(/\.mscz$/i, ".musicxml");
      const xmlPath = path.join(examplesDir, xmlName);
      assert.ok(fs.existsSync(xmlPath), `missing sibling ${xmlName}`);
      const xml = fs.readFileSync(xmlPath, "utf8");
      assert.ok(
        xml.includes("<score-partwise") || xml.includes("<score-timewise"),
        `${xmlName} is not MusicXML`,
      );
      assert.ok(/<note[\s>]/.test(xml), `${xmlName} has no notes`);
      assert.ok(ex.title && String(ex.title).trim(), `${ex.id} missing title`);
    }
  });
});
