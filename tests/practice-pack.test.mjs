import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PACK_FORMAT,
  createEmptyPack,
  parsePracticePack,
  bumpRevision,
  comparePacks,
  stringifyPack,
  isPracticePack,
} from "../js/practice-pack.js";

describe("practice-pack", () => {
  it("creates and round-trips a pack through JSON", () => {
    const pack = createEmptyPack({
      title: "Stille Nacht",
      musicXml: "<score-partwise/>",
      author: "Joska",
    });
    assert.equal(pack.format, PACK_FORMAT);
    assert.equal(pack.rev, 1);
    const parsed = parsePracticePack(stringifyPack(pack));
    assert.equal(parsed.title, "Stille Nacht");
    assert.equal(parsed.musicXml, "<score-partwise/>");
    assert.ok(isPracticePack(parsed));
  });

  it("rejects non-pack JSON", () => {
    assert.throws(() => parsePracticePack("{}"), /Not a MIDI Practice Pack/);
  });

  it("bumps revision and appends history", () => {
    const pack = createEmptyPack({ title: "A" });
    const next = bumpRevision(pack, "Renamed part", "Ada");
    assert.equal(next.rev, 2);
    assert.equal(next.history.length, 1);
    assert.equal(next.history[0].summary, "Renamed part");
    assert.equal(next.history[0].author, "Ada");
    assert.equal(pack.rev, 1); // original untouched
  });

  it("comparePacks chooses apply/push/same/conflict", () => {
    const a = createEmptyPack({ id: "p1", rev: 1 });
    const b = createEmptyPack({ id: "p1", rev: 2, updatedAt: "2099-01-01T00:00:00.000Z" });
    assert.equal(comparePacks(a, b), "apply-remote");
    assert.equal(comparePacks(b, a), "push-local");
    assert.equal(comparePacks(a, { ...a }), "same");
    assert.equal(comparePacks(a, createEmptyPack({ id: "other", rev: 1 })), "conflict");
    assert.equal(comparePacks(a, null), "push-local");
  });
});
