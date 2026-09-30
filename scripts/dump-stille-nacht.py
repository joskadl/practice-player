#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET

text = Path("examples/stille-nacht.musicxml").read_text(encoding="utf-8")
root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", text))
names = {
    sp.get("id"): (sp.findtext("part-name") or "").strip()
    for sp in root.find("part-list").findall("score-part")
}


def pitch(note: ET.Element) -> str:
    p = note.find("pitch")
    if p is None:
        return "R"
    step = p.findtext("step")
    oct_ = int(p.findtext("octave"))
    alt = int(p.findtext("alter") or 0)
    acc = "#" if alt == 1 else "b" if alt == -1 else ""
    return f"{step}{acc}{oct_}"


def dur_label(note: ET.Element) -> str:
    typ = note.findtext("type") or "?"
    dots = len(note.findall("dot"))
    return typ + ("." * dots)


for part in root.findall("part"):
    print("====", names.get(part.get("id")))
    for meas in part.findall("measure"):
        total = 0
        notes = []
        for n in meas.findall("note"):
            if n.find("chord") is not None:
                continue
            d = int(n.findtext("duration") or 0)
            total += d
            notes.append(f"{pitch(n)}:{dur_label(n)}")
        ok = "OK" if total == 30240 else f"BAD({total})"
        print(f"  m{meas.get('number')} {ok}:", " ".join(notes))
