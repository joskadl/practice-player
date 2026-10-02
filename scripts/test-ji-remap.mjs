/**
 * Reliability checks for JI base-note remapping when bend would exceed ±pbRange.
 *
 *   node scripts/test-ji-remap.mjs
 */
import {
  findBestMidiNoteForFrequency,
  getJiFrequency,
  midiNoteTo12tetHz,
  buildJiRetunePlan,
} from "../js/ji-retune.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function centsBetween(targetHz, midiNote) {
  return 1200 * Math.log2(targetHz / midiNoteTo12tetHz(midiNote));
}

{
  const target = midiNoteTo12tetHz(60);
  const { midiNote, signedBend } = findBestMidiNoteForFrequency(target, 67, 2);
  assert(midiNote === 60, `distant preferred → 60, got ${midiNote}`);
  assert(Math.abs(centsBetween(target, midiNote)) <= 200.5, "bend within ±2st");
  assert(Math.abs(signedBend) <= 8192, "signed bend in range");
}

{
  const target = midiNoteTo12tetHz(60) * 2 ** (3.5 / 12);
  const { midiNote } = findBestMidiNoteForFrequency(target, 60, 2);
  assert(midiNote === 63 || midiNote === 64, `between semis got ${midiNote}`);
  assert(Math.abs(centsBetween(target, midiNote)) <= 200.5, "between-semitone bend");
}

{
  // Local search empty → must still snap to target, not saturate on preferred.
  const target = midiNoteTo12tetHz(60);
  const { midiNote, signedBend } = findBestMidiNoteForFrequency(target, 100, 2, 0);
  assert(midiNote === 60, `fallback nearest expected 60, got ${midiNote}`);
  assert(Math.abs(signedBend) < 100, `fallback bend near 0, got ${signedBend}`);
  assert(Math.abs(centsBetween(target, midiNote)) <= 50.5, "fallback within ±50¢");
}

{
  const config = Array(12).fill(null);
  config[0] = [1, 0, 0]; // 3/2 on written unison → needs G base, not huge bend on C
  const markers = [{ tick: 0, config, metadata: { refNote: 60, ji: true } }];
  const notes = [{ id: 1, start: 0, end: 100, note: 60, channel: 0, velocity: 80 }];
  const plan = buildJiRetunePlan(notes, markers, { refNote: 60, pitchBendRange: 2 });
  const rt = plan.noteRetunes[1];
  assert(rt?.note === 67, `plan remap expected 67, got ${rt?.note}`);
  const jiHz = getJiFrequency(0, 0, config, midiNoteTo12tetHz(60));
  assert(Math.abs(centsBetween(jiHz, rt.note)) <= 200.5, "plan bend within range");
}

{
  const config = Array(12).fill(null);
  config[0] = [1, 0, 0];
  const markers = [{ tick: 0, config, metadata: { refNote: 67, ji: true } }];
  const notes = [{ id: 1, start: 0, end: 100, note: 67, channel: 0, velocity: 80 }];
  const plan = buildJiRetunePlan(notes, markers, { refNote: 67, pitchBendRange: 2 });
  assert(plan.noteRetunes[1]?.note === 74, "remains correct after +7 modulation");
}

console.log("test-ji-remap: ok");
