/**
 * Cross-platform test runner (Windows npm does not expand globs reliably).
 *
 *   node scripts/run-tests.mjs
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const unit = globSync("tests/**/*.test.mjs", { cwd: root }).map((f) =>
  path.join(root, f),
);
const files = [...unit, path.join(root, "scripts/test-ji-remap.mjs")];
const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
