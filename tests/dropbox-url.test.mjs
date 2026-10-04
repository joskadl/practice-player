import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDropboxDlUrl,
  dropboxShareDisplayUrl,
} from "../scripts/lib/dropbox-url.mjs";

describe("Dropbox shared-folder URL helpers", () => {
  it("forces dl=1 for ZIP download", () => {
    assert.equal(
      normalizeDropboxDlUrl("https://www.dropbox.com/sh/abc/xyz?dl=0"),
      "https://www.dropbox.com/sh/abc/xyz?dl=1",
    );
    assert.equal(
      normalizeDropboxDlUrl("https://www.dropbox.com/sh/abc/xyz"),
      "https://www.dropbox.com/sh/abc/xyz?dl=1",
    );
    assert.equal(
      normalizeDropboxDlUrl("https://www.dropbox.com/sh/abc/xyz?dl=1"),
      "https://www.dropbox.com/sh/abc/xyz?dl=1",
    );
  });

  it("rejects empty URLs", () => {
    assert.throws(() => normalizeDropboxDlUrl(""), /Missing Dropbox/);
  });

  it("strips dl=1 for display metadata", () => {
    assert.equal(
      dropboxShareDisplayUrl("https://www.dropbox.com/sh/abc/xyz?dl=1"),
      "https://www.dropbox.com/sh/abc/xyz",
    );
  });
});
