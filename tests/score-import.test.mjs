import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "../vendor/fflate.js";
import {
  isScoreXmlName,
  isMuseScoreName,
  musicXmlSiblingName,
  metaTagsFromMscz,
  musicXmlFromMxl,
} from "../js/score-import.js";
import {
  HOME_KEY_FIELD,
  REMARKS_FIELD,
  JI_FILE_FIELD,
} from "../js/score-meta.js";

describe("score-import name helpers", () => {
  it("detects MusicXML / MuseScore extensions", () => {
    assert.equal(isScoreXmlName("a.musicxml"), true);
    assert.equal(isScoreXmlName("a.mscz"), true);
    assert.equal(isScoreXmlName("a.mid"), false);
    assert.equal(isMuseScoreName("x.MSCZ"), true);
    assert.equal(isMuseScoreName("x.musicxml"), false);
  });

  it("maps MuseScore names to sibling MusicXML deploy artifacts", () => {
    assert.equal(musicXmlSiblingName("stille-nacht.mscz"), "stille-nacht.musicxml");
    assert.equal(musicXmlSiblingName("foo.mscx"), "foo.musicxml");
  });
});

describe("metaTagsFromMscz", () => {
  it("reads shared metaTags from a minimal .mscz ZIP", () => {
    const mscx = `<?xml version="1.0"?>
<museScore version="4.00">
  <Score>
    <metaTag name="${HOME_KEY_FIELD}">C major</metaTag>
    <metaTag name="${REMARKS_FIELD}">Soft entrance</metaTag>
    <metaTag name="${JI_FILE_FIELD}">{"type":"ji_file","version":1,"refNote":60}</metaTag>
    <metaTag name="workTitle">Demo</metaTag>
  </Score>
</museScore>
`;
    const bytes = zipSync({
      "score.mscx": new TextEncoder().encode(mscx),
    });
    const tags = metaTagsFromMscz(bytes, "demo.mscz");
    assert.equal(tags[HOME_KEY_FIELD], "C major");
    assert.equal(tags[REMARKS_FIELD], "Soft entrance");
    assert.match(tags[JI_FILE_FIELD], /ji_file/);
    assert.equal(tags.workTitle, undefined);
  });

  it("reads raw .mscx bytes", () => {
    const mscx = `<metaTag name="${HOME_KEY_FIELD}">G major</metaTag>`;
    const tags = metaTagsFromMscz(new TextEncoder().encode(mscx), "x.mscx");
    assert.equal(tags[HOME_KEY_FIELD], "G major");
  });
});

describe("musicXmlFromMxl", () => {
  it("extracts score.musicxml from a compressed .mxl", () => {
    const score = `<?xml version="1.0"?><score-partwise version="3.1"></score-partwise>`;
    const bytes = zipSync({
      "META-INF/container.xml": new TextEncoder().encode(
        `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>`,
      ),
      "score.musicxml": new TextEncoder().encode(score),
    });
    const xml = musicXmlFromMxl(bytes);
    assert.match(xml, /score-partwise/);
  });
});
