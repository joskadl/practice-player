import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clusterStaffBandIndices,
  expandStaffBraceFromSeeds,
  selectStaffBraceWindow,
  staffBreakGap,
} from "../js/sheet-view.js";

describe("clusterStaffBandIndices", () => {
  it("keeps 3- and 4-stave braces apart across a wide system gap", () => {
    // System A: 3 staves. System B: 4 staves. Fixed-count expand used to steal
    // A's bass when filling B up to 4.
    const staffH = 20;
    const within = 30;
    const betweenSystems = 90;
    let y = 0;
    /** @type {{top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push({ top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += betweenSystems - within;
    for (let i = 0; i < 4; i++) {
      items.push({ top: y, bottom: y + staffH });
      y += staffH + within;
    }

    const clusters = clusterStaffBandIndices(items);
    assert.deepEqual(
      clusters.map((c) => c.length),
      [3, 4],
    );
    assert.deepEqual(clusters[0], [0, 1, 2]);
    assert.deepEqual(clusters[1], [3, 4, 5, 6]);
  });

  it("does not split a dense SATB brace", () => {
    const items = [
      { top: 0, bottom: 18 },
      { top: 40, bottom: 58 },
      { top: 80, bottom: 98 },
      { top: 120, bottom: 138 },
    ];
    assert.deepEqual(clusterStaffBandIndices(items), [[0, 1, 2, 3]]);
  });
});

describe("staffBreakGap", () => {
  it("splits systems when inter-system gap is only ~1.6× the within-brace gap", () => {
    const within = 54;
    const between = 90;
    const staffH = 19;
    let y = 0;
    /** @type {{top:number, bottom:number}[]} */
    const items = [];
    for (let sys = 0; sys < 4; sys++) {
      for (let s = 0; s < 4; s++) {
        items.push({ top: y, bottom: y + staffH });
        y += staffH + within;
      }
      y += between - within;
    }
    const breakAt = staffBreakGap(items);
    assert.ok(breakAt < between, `breakAt ${breakAt} should be below system gap ${between}`);
    assert.ok(breakAt > within, `breakAt ${breakAt} should stay above within gap ${within}`);
    const clusters = clusterStaffBandIndices(items);
    assert.equal(clusters.length, 4);
    assert.deepEqual(
      clusters.map((c) => c.length),
      [4, 4, 4, 4],
    );
  });
});

describe("expandStaffBraceFromSeeds", () => {
  it("expands from a seed staff to the full SATB brace, not the next system", () => {
    const staffH = 20;
    const within = 30;
    const betweenSystems = 90;
    let y = 0;
    /** @type {{g:{id:number}, top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 4; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += betweenSystems - within;
    for (let i = 4; i < 8; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }

    const band = expandStaffBraceFromSeeds(items, new Set([items[1].g]), 4);
    assert.ok(band);
    assert.equal(band.staffCount, 4);
    assert.equal(band.top, items[0].top);
    assert.equal(band.bottom, items[3].bottom);
  });

  it("does not span two systems when the seed is in the upper brace", () => {
    const staffH = 18;
    const within = 28;
    const betweenSystems = 100;
    let y = 0;
    /** @type {{g:{id:number}, top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += betweenSystems - within;
    for (let i = 3; i < 7; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }

    const band = expandStaffBraceFromSeeds(items, new Set([items[2].g]), 3);
    assert.ok(band);
    assert.equal(band.staffCount, 3);
    assert.equal(band.bottom, items[2].bottom);
    assert.ok(band.bottom < items[3].top);
  });

  it("same brace height whether only the top or only the bottom voice is sounding", () => {
    const staffH = 20;
    const within = 90;
    let y = 0;
    /** @type {{g:{id:number}, top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 4; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }
    const fromTop = expandStaffBraceFromSeeds(items, new Set([items[0].g]), 4);
    const fromBass = expandStaffBraceFromSeeds(items, new Set([items[3].g]), 4);
    assert.ok(fromTop && fromBass);
    assert.equal(fromTop.top, fromBass.top);
    assert.equal(fromTop.bottom, fromBass.bottom);
    assert.equal(fromTop.staffCount, 4);
  });

  it("fills a SATB brace even when multi-verse lyrics inflate within-brace gaps", () => {
    // Within-brace gaps (~95px) exceed the old breakAt (~median×1.35), which used
    // to stop after 1–2 staves so the playhead never reached the bass.
    const staffH = 19;
    const within = 95;
    const betweenSystems = 150;
    let y = 0;
    /** @type {{g:{id:number}, top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 4; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += betweenSystems - within;
    for (let i = 4; i < 8; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }

    const band = expandStaffBraceFromSeeds(items, new Set([items[0].g]), 4);
    assert.ok(band);
    assert.equal(band.staffCount, 4);
    assert.equal(band.top, items[0].top);
    assert.equal(band.bottom, items[3].bottom);
    assert.ok(band.bottom < items[4].top);
  });

  it("with maxStaves=3 does not steal into the next system across a wide gap", () => {
    const staffH = 19;
    const within = 95;
    const betweenSystems = 150;
    let y = 0;
    /** @type {{g:{id:number}, top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 3; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += betweenSystems - within;
    for (let i = 3; i < 7; i++) {
      items.push({ g: { id: i }, top: y, bottom: y + staffH });
      y += staffH + within;
    }

    const band = expandStaffBraceFromSeeds(items, new Set([items[1].g]), 3);
    assert.ok(band);
    assert.equal(band.staffCount, 3);
    assert.equal(band.bottom, items[2].bottom);
  });

  it("selectStaffBraceWindow prefers the tight brace over one that crosses a system gap", () => {
    const staffH = 20;
    const within = 40;
    const between = 120;
    let y = 0;
    /** @type {{top:number, bottom:number}[]} */
    const items = [];
    for (let i = 0; i < 4; i++) {
      items.push({ top: y, bottom: y + staffH });
      y += staffH + within;
    }
    y += between - within;
    for (let i = 0; i < 4; i++) {
      items.push({ top: y, bottom: y + staffH });
      y += staffH + within;
    }
    // Seed on bass of first system — windows [0,3] vs [1,4]…; pick [0,3].
    const win = selectStaffBraceWindow(items, [3], 4);
    assert.deepEqual(win, { lo: 0, hi: 3 });
  });
});
