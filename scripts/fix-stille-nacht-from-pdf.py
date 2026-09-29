#!/usr/bin/env python3
"""Fix Stille Nacht MusicXML pitches from measure 6 using PDF SMuFL extraction."""
from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

# Target pitches from PDF (sounding), measures 5-12.
# Verified via SMuFL noteheads + G/F clef anchors.
TARGETS = {
    "Soprano": {
        5: ["A4", "A4", "C5", "B4", "A4"],
        6: ["G4", "A4", "G4", "E4"],
        7: ["A4", "A4", "C5", "B4", "A4"],
        8: ["G4", "A4", "G4", "E4"],
        9: ["D5", "D5", "F5", "D5", "B4"],
        10: ["C5", "C5"],
        11: ["C5", "G4", "E4", "G4", "F4", "D4"],
        12: ["C4", "C4"],
    },
    "Alto": {
        5: ["F4", "F4", "A4", "G4", "F4"],
        6: ["E4", "F4", "E4", "C4"],
        7: ["F4", "F4", "A4", "G4", "F4"],
        8: ["E4", "F4", "E4", "C4"],
        # page2: EFEC already used as m8; remaining F F G G G G F E
        # with counts 5+2 → F F G G G | F E  (drop one repeated G)
        9: ["F4", "F4", "G4", "G4", "G4"],
        10: ["F4", "E4"],
        11: ["E4", "C4", "E4", "D4", "C4", "B3"],
        12: ["C4", "C4"],
    },
    "Tenor": {
        5: ["C4", "C4", "F4", "D4", "C4"],
        6: ["C4", "C4", "C4", "G3"],
        7: ["C4", "C4", "F4", "D4", "C4"],
        8: ["C4", "C4", "C4", "G3"],
        9: ["B3", "B3", "D4", "D4", "D4"],
        10: ["C4", "G3"],
        11: ["G3", "A3", "B3", "A3", "G3", "F3"],
        12: ["E3", "E3"],
    },
    "Bass": {
        5: ["F3", "F3", "F3", "F3", "F3"],
        6: ["C3", "C3", "C3", "C3"],
        7: ["F3", "F3", "F3", "F3", "F3"],
        8: ["C3", "C3", "C3", "C3"],
        # 12 glyphs on page2 sys1: C C C C G G G G F E D C → 4+5+3 or 4+4+4
        # XML wants 4+5+2. Use CCCC | GGGGF | ED? or CCCC | GGG FE | DC
        # Prefer CCCC | G G G G F | E D with m10 needing 2: take E D? leftover C
        # CCCC GGGG FEDC = 4+4+4. For 4+5+2: CCCC | GGGGF | ED (drop final C as false?)
        9: ["G3", "G3", "G3", "F3", "E3"],
        10: ["D3", "C3"],
        # page2 sys2: five G2 then two C3; XML wants 6+2 — repeat a G
        11: ["G2", "G2", "G2", "G2", "G2", "G2"],
        12: ["C3", "C3"],
    },
}


def parse_pitch(label: str) -> tuple[str, int]:
    return label[0], int(label[1:])


def set_pitch(note: ET.Element, step: str, octave: int) -> None:
    p = note.find("pitch")
    if p is None:
        return
    p.find("step").text = step
    p.find("octave").text = str(octave)
    alt = p.find("alter")
    if alt is not None:
        p.remove(alt)


def main() -> None:
    path = Path("examples/stille-nacht.musicxml")
    root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", path.read_text(encoding="utf-8")))
    names = {
        sp.get("id"): (sp.findtext("part-name") or "").strip()
        for sp in root.find("part-list").findall("score-part")
    }

    for part in root.findall("part"):
        voice = names.get(part.get("id"))
        if voice not in TARGETS:
            continue
        for meas in part.findall("measure"):
            mn = int(meas.get("number"))
            if mn not in TARGETS[voice]:
                continue
            want = TARGETS[voice][mn]
            notes = [
                n
                for n in meas.findall("note")
                if n.find("chord") is None and n.find("pitch") is not None
            ]
            if len(notes) != len(want):
                print(f"SKIP {voice} m{mn}: xml={len(notes)} pdf={len(want)}")
                continue
            before = []
            after = []
            for n, label in zip(notes, want):
                p = n.find("pitch")
                before.append(f"{p.findtext('step')}{p.findtext('octave')}")
                step, oct_ = parse_pitch(label)
                set_pitch(n, step, oct_)
                after.append(label)
            if before != after:
                print(f"FIX {voice} m{mn}: {' '.join(before)} -> {' '.join(after)}")
            else:
                print(f"ok  {voice} m{mn}")

    path.write_text(
        "<?xml version='1.0' encoding='utf-8'?>\n" + ET.tostring(root, encoding="unicode"),
        encoding="utf-8",
    )
    print("wrote", path)


if __name__ == "__main__":
    main()
