import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildScript = path.join(__dirname, "..", "scripts", "build-examples-manifest.mjs");

function runManifest(dir) {
  const r = spawnSync(process.execPath, [buildScript], {
    env: { ...process.env, EXAMPLES_DIR: dir },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
}

describe("setlist-ordered manifest", () => {
  it("orders by setlist.json and sets setlist:true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-setlist-"));
    try {
      for (const name of ["alpha.mscz", "beta.mscz", "gamma.mscz"]) {
        fs.writeFileSync(path.join(dir, name), "x");
        fs.writeFileSync(
          path.join(dir, name.replace(/\.mscz$/i, ".musicxml")),
          `<score-partwise><work><work-title>${name}</work-title></work></score-partwise>`,
        );
      }
      fs.writeFileSync(
        path.join(dir, "setlist.json"),
        JSON.stringify(["gamma.mscz", "alpha.mscz"]),
      );

      const withList = runManifest(dir);
      assert.equal(withList.setlist, true);
      assert.deepEqual(
        withList.examples.map((e) => e.id),
        ["gamma", "alpha", "beta"],
      );

      fs.unlinkSync(path.join(dir, "setlist.json"));
      const without = runManifest(dir);
      assert.equal(without.setlist, undefined);
      assert.deepEqual(
        without.examples.map((e) => e.id),
        ["alpha", "beta", "gamma"],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
