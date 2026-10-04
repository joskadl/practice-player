import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHARED_MISC_FIELDS,
  JI_FILE_FIELD,
  JI_MARKERS_FIELD,
  REMARKS_FIELD,
  HOME_KEY_FIELD,
  RECORDING_URL_FIELD,
  VOICE_COLORS_FIELD,
  LAYERS_FIELD,
  upsertMiscFieldsInMusicXml,
} from "../js/score-meta.js";

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <identification>
    <creator type="composer">Test</creator>
  </identification>
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>
`;

describe("score-meta field registry", () => {
  it("exports the shared Practice Player ↔ JustPlay field set", () => {
    assert.deepEqual([...SHARED_MISC_FIELDS], [
      JI_FILE_FIELD,
      JI_MARKERS_FIELD,
      REMARKS_FIELD,
      HOME_KEY_FIELD,
      RECORDING_URL_FIELD,
      VOICE_COLORS_FIELD,
      LAYERS_FIELD,
    ]);
    assert.equal(JI_FILE_FIELD, "justplay-ji-file");
    assert.equal(JI_MARKERS_FIELD, "justplay-ji-markers");
    assert.equal(REMARKS_FIELD, "practice-player-remarks");
    assert.equal(HOME_KEY_FIELD, "practice-player-home-key");
  });
});

describe("upsertMiscFieldsInMusicXml", () => {
  it("inserts miscellaneous fields before </identification>", () => {
    const out = upsertMiscFieldsInMusicXml(MINIMAL_XML, {
      [REMARKS_FIELD]: "Soft entrance",
      [HOME_KEY_FIELD]: "C major",
    });
    assert.match(out, /<miscellaneous>/);
    assert.match(out, new RegExp(`name="${REMARKS_FIELD}"`));
    assert.match(out, /Soft entrance/);
    assert.match(out, /C major/);
  });

  it("escapes XML special characters in values", () => {
    const out = upsertMiscFieldsInMusicXml(MINIMAL_XML, {
      [REMARKS_FIELD]: `A & B <C> "quote"`,
    });
    assert.match(out, /A &amp; B &lt;C&gt; &quot;quote&quot;/);
  });

  it("replaces an existing field by name", () => {
    const once = upsertMiscFieldsInMusicXml(MINIMAL_XML, {
      [HOME_KEY_FIELD]: "G major",
    });
    const twice = upsertMiscFieldsInMusicXml(once, {
      [HOME_KEY_FIELD]: "A minor",
    });
    assert.equal((twice.match(/practice-player-home-key/g) || []).length, 1);
    assert.match(twice, /A minor/);
    assert.doesNotMatch(twice, /G major/);
  });

  it("onlyMissing leaves existing values alone", () => {
    const once = upsertMiscFieldsInMusicXml(MINIMAL_XML, {
      [REMARKS_FIELD]: "Keep me",
    });
    const twice = upsertMiscFieldsInMusicXml(
      once,
      { [REMARKS_FIELD]: "Overwrite?" },
      { onlyMissing: true },
    );
    assert.match(twice, /Keep me/);
    assert.doesNotMatch(twice, /Overwrite\?/);
  });

  it("preserves JI fields when adding remarks", () => {
    const withJi = upsertMiscFieldsInMusicXml(MINIMAL_XML, {
      [JI_FILE_FIELD]: '{"type":"ji_file","version":1,"refNote":60}',
      [JI_MARKERS_FIELD]: "[]",
    });
    const withRemarks = upsertMiscFieldsInMusicXml(withJi, {
      [REMARKS_FIELD]: "Watch breath",
    });
    assert.match(withRemarks, /justplay-ji-file/);
    assert.match(withRemarks, /Watch breath/);
  });
});
