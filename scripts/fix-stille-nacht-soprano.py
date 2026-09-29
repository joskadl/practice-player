#!/usr/bin/env python3
"""Fix Stille Nacht soprano m6–m8 pitches to match Silent Night / PDF contour."""
from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

path = Path("examples/stille-nacht.musicxml")
root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", path.read_text(encoding="utf-8")))
sop = root.findall("part")[0]

fixes = {
    "6": [("G", "4"), ("E", "4"), ("F", "4"), ("D", "4")],
    "7": [("A", "4"), ("A", "4"), ("C", "5"), ("B", "4"), ("A", "4")],
    "8": [("G", "4"), ("E", "4"), ("F", "4"), ("D", "4")],
}

for m in sop.findall("measure"):
    mn = m.get("number")
    if mn not in fixes:
        continue
    notes = [
        n
        for n in m.findall("note")
        if n.find("chord") is None and n.find("pitch") is not None
    ]
    want = fixes[mn]
    if len(notes) != len(want):
        raise SystemExit(f"m{mn} note count {len(notes)} != {len(want)}")
    for n, (step, oct_) in zip(notes, want):
        p = n.find("pitch")
        p.find("step").text = step
        p.find("octave").text = oct_
        alt = p.find("alter")
        if alt is not None:
            p.remove(alt)
    print(f"fixed m{mn}", want)

body = ET.tostring(root, encoding="unicode")
path.write_text("<?xml version='1.0' encoding='utf-8'?>\n" + body, encoding="utf-8")
print("wrote", path)
