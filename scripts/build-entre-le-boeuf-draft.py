#!/usr/bin/env python3
"""
Draft MusicXML for Entre le bœuf et l'âne gris (Felix de Nobel arr.).
2/4 SATB — opening is best-effort; M7–M15 follow photo verification.
"""
from __future__ import annotations

from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring

OUT = Path("examples/entre-le-boeuf-et-lane-gris.musicxml")
DIV = 2  # quarter=2, eighth=1, half=4

VERSES_TEXT = """1. Entre le bœuf et l'âne gris,
Dort, dort, dort le petit fils;
Mille anges divins,
Mille séraphins,
Volent à l'entour
De ce grand Dieu d'amour.

2. Entre les deux bras de Marie
Dort, dort, dort le petit fils;
…

3. Entre les roses et les lis
…

4. En ce beau jour si solennel
Dort, dort, dort l'Emmanuel;
…
"""

# (step, alter, octave, quarters, lyric_slots)
# 15 measures × 2 beats = 30 quarters per part

S = [
    ("G", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1), ("A", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1),  # M1
    ("F", 1, 4, 0.5, 1), ("G", 0, 4, 0.5, 0), ("F", 1, 4, 0.5, 1), ("E", 0, 4, 0.5, 1),  # M2
    ("D", 0, 4, 1.0, 1), ("G", 0, 4, 1.0, 0),  # M3
    ("A", 0, 4, 2.0, 1),  # M4
    ("B", 0, 4, 2.0, 1),  # M5
    ("G", 0, 4, 2.0, 0),  # M6
    ("G", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1), ("A", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1),  # M7
    ("G", 0, 4, 2.0, 1),  # M8
    ("B", 0, 4, 0.5, 1), ("B", 0, 4, 0.5, 1), ("C", 0, 5, 0.5, 1), ("B", 0, 4, 0.5, 1),  # M9
    ("B", 0, 4, 2.0, 1),  # M10
    ("D", 0, 5, 0.5, 1), ("D", 0, 5, 0.5, 1), ("E", 0, 5, 0.5, 1), ("D", 0, 5, 0.5, 1),  # M11
    ("D", 0, 5, 2.0, 1),  # M12
    ("G", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1), ("A", 0, 4, 0.5, 1), ("B", 0, 4, 0.5, 1),  # M13
    ("C", 0, 5, 0.5, 1), ("B", 0, 4, 0.5, 1), ("A", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1),  # M14
    ("A", 0, 4, 0.5, 1), ("G", 0, 4, 0.5, 1), ("G", 0, 4, 1.0, 1),  # M15
]

VERSE1 = [
    "En", "tre", "le", "bœuf",
    "et", "l'â", "ne",
    "gris",
    "dort", "dort",
    "dort", "le", "pe", "tit",
    "fils",
    "Mil", "le", "an", "ges",
    "vins",
    "mil", "le", "sé", "ra",
    "phins",
    "vo", "lent", "à", "l'en",
    "tour", "de", "ce", "grand",
    "Dieu", "d'a", "mour",
]

A = [
    ("D", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("E", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("D", 0, 4, 0.5, 0), ("C", 0, 4, 0.5, 0), ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0),
    ("B", 0, 3, 1.0, 0), ("D", 0, 4, 1.0, 0),
    ("F", 1, 4, 2.0, 0),
    ("G", 0, 4, 2.0, 0),
    ("D", 0, 4, 2.0, 0),
    ("D", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("E", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("D", 0, 4, 2.0, 0),
    ("D", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("E", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("D", 0, 4, 2.0, 0),
    ("G", 0, 4, 0.5, 0), ("G", 0, 4, 0.5, 0), ("A", 0, 4, 0.5, 0), ("G", 0, 4, 0.5, 0),
    ("G", 0, 4, 2.0, 0),
    ("D", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("G", 0, 4, 0.5, 0), ("G", 0, 4, 0.5, 0),
    ("A", 0, 4, 0.5, 0), ("G", 0, 4, 0.5, 0), ("F", 1, 4, 0.5, 0), ("E", 0, 4, 0.5, 0),
    ("F", 1, 4, 0.5, 0), ("E", 0, 4, 0.5, 0), ("D", 0, 4, 1.0, 0),
]

T = [
    ("B", 0, 3, 0.5, 0), ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0), ("B", 0, 3, 0.5, 0),
    ("A", 0, 3, 0.5, 0), ("G", 0, 3, 0.5, 0), ("G", 0, 3, 0.5, 0), ("A", 0, 3, 0.5, 0),
    ("G", 0, 3, 1.0, 0), ("B", 0, 3, 1.0, 0),
    ("C", 0, 4, 2.0, 0),
    ("D", 0, 4, 2.0, 0),
    ("B", 0, 3, 2.0, 0),
    ("B", 0, 3, 0.5, 0), ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0), ("B", 0, 3, 0.5, 0),
    ("G", 0, 3, 2.0, 0),
    ("B", 0, 3, 0.5, 0), ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("G", 0, 3, 2.0, 0),
    ("B", 0, 3, 0.5, 0), ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("D", 0, 4, 2.0, 0),
    ("B", 0, 3, 0.5, 0), ("C", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0),
    ("E", 0, 4, 0.5, 0), ("D", 0, 4, 0.5, 0), ("C", 0, 4, 0.5, 0), ("B", 0, 3, 0.5, 0),
    ("C", 0, 4, 0.5, 0), ("B", 0, 3, 0.5, 0), ("G", 0, 3, 1.0, 0),
]

B = [
    ("G", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0), ("A", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0),
    ("D", 0, 3, 0.5, 0), ("E", 0, 3, 0.5, 0), ("D", 0, 3, 0.5, 0), ("C", 0, 3, 0.5, 0),
    ("G", 0, 2, 1.0, 0), ("G", 0, 2, 1.0, 0),
    ("D", 0, 3, 2.0, 0),
    ("G", 0, 2, 2.0, 0),
    ("G", 0, 2, 2.0, 0),
    ("G", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0), ("A", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0),
    ("G", 0, 2, 2.0, 0),
    ("G", 0, 3, 0.5, 0), ("G", 0, 3, 0.5, 0), ("F", 1, 3, 0.5, 0), ("G", 0, 3, 0.5, 0),
    ("D", 0, 3, 2.0, 0),
    ("G", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0), ("A", 0, 2, 0.5, 0), ("G", 0, 2, 0.5, 0),
    ("G", 0, 3, 2.0, 0),
    ("G", 0, 3, 0.5, 0), ("F", 1, 3, 0.5, 0), ("G", 0, 3, 0.5, 0), ("G", 0, 3, 0.5, 0),
    ("C", 0, 3, 0.5, 0), ("C", 0, 3, 0.5, 0), ("D", 0, 3, 0.5, 0), ("D", 0, 3, 0.5, 0),
    ("D", 0, 3, 1.0, 0), ("G", 0, 2, 1.0, 0),
]


def dur_type(q: float) -> tuple[str, int, bool]:
    if abs(q - 2.0) < 1e-9:
        return "half", 4, False
    if abs(q - 1.5) < 1e-9:
        return "quarter", 3, True
    if abs(q - 1.0) < 1e-9:
        return "quarter", 2, False
    if abs(q - 0.5) < 1e-9:
        return "eighth", 1, False
    raise ValueError(q)


def chunk_measures(notes: list) -> list[list]:
    measures, cur, acc = [], [], 0.0
    for n in notes:
        cur.append(n)
        acc += n[3]
        if abs(acc - 2.0) < 1e-9:
            measures.append(cur)
            cur, acc = [], 0.0
        elif acc > 2.0 + 1e-9:
            raise SystemExit(f"overflow {acc}: {n}")
    if cur:
        raise SystemExit(f"incomplete {acc}: {cur}")
    return measures


def add_score_part(pl: Element, pid: str, name: str, abbr: str, channel: int) -> None:
    sp = SubElement(pl, "score-part", {"id": pid})
    SubElement(sp, "part-name").text = name
    SubElement(sp, "part-abbreviation").text = abbr
    si = SubElement(sp, "score-instrument", {"id": f"{pid}-I1"})
    SubElement(si, "instrument-name").text = name
    mi = SubElement(sp, "midi-instrument", {"id": f"{pid}-I1"})
    SubElement(mi, "midi-channel").text = str(channel)
    SubElement(mi, "midi-program").text = "53"


def build() -> None:
    for label, part in (("S", S), ("A", A), ("T", T), ("B", B)):
        total = sum(n[3] for n in part)
        assert abs(total - 15 * 2) < 1e-9, f"{label} {total} != 30"
    slots = sum(1 for n in S if n[4] > 0)
    assert len(VERSE1) == slots, f"VERSE1 {len(VERSE1)} vs {slots}"

    root = Element("score-partwise", {"version": "4.0"})
    work = SubElement(root, "work")
    SubElement(work, "work-title").text = "Entre le bœuf et l'âne gris"
    SubElement(root, "movement-title").text = "Entre le bœuf et l'âne gris"
    ident = SubElement(root, "identification")
    SubElement(ident, "creator", {"type": "arranger"}).text = "Felix de Nobel"
    SubElement(ident, "creator", {"type": "lyricist"}).text = "Traditional (France, 13th c.)"
    enc = SubElement(ident, "encoding")
    SubElement(enc, "software").text = "MIDI Practice Player"
    SubElement(enc, "encoding-date").text = "2026-09-29"
    misc = SubElement(ident, "miscellaneous")
    mf = SubElement(misc, "miscellaneous-field", {"name": "remarks"})
    mf.text = (
        "DRAFT from photo (IMG-20260929-WA0000). Meter 2/4; M7–M15 verified from scan; "
        "M1–M6 best-effort — correct in MuseScore, then export MusicXML.\n"
        "Subtitle: Le sommeil de l'enfant Jésus.\n\n" + VERSES_TEXT
    )

    pl = SubElement(root, "part-list")
    pg = SubElement(pl, "part-group", {"type": "start", "number": "1"})
    SubElement(pg, "group-symbol").text = "bracket"
    SubElement(pg, "group-barline").text = "yes"
    add_score_part(pl, "P1", "Soprano", "S", 1)
    add_score_part(pl, "P2", "Alto", "A", 2)
    add_score_part(pl, "P3", "Tenor", "T", 3)
    add_score_part(pl, "P4", "Bass", "B", 4)
    SubElement(pl, "part-group", {"type": "stop", "number": "1"})

    lyric_i = 0
    for pid, notes, clef, oct_change, with_lyr in [
        ("P1", S, "G", None, True),
        ("P2", A, "G", None, False),
        ("P3", T, "G", -1, False),
        ("P4", B, "F", None, False),
    ]:
        part_el = SubElement(root, "part", {"id": pid})
        for mi, meas_notes in enumerate(chunk_measures(notes), 1):
            meas = SubElement(part_el, "measure", {"number": str(mi)})
            if mi == 1:
                attrs = SubElement(meas, "attributes")
                SubElement(attrs, "divisions").text = str(DIV)
                key = SubElement(attrs, "key")
                SubElement(key, "fifths").text = "1"
                time = SubElement(attrs, "time")
                SubElement(time, "beats").text = "2"
                SubElement(time, "beat-type").text = "4"
                clef_el = SubElement(attrs, "clef")
                SubElement(clef_el, "sign").text = clef
                SubElement(clef_el, "line").text = "2" if clef == "G" else "4"
                if oct_change is not None:
                    SubElement(clef_el, "clef-octave-change").text = str(oct_change)
                if pid == "P1":
                    d = SubElement(meas, "direction", {"placement": "above"})
                    SubElement(SubElement(d, "direction-type"), "words").text = (
                        "Le sommeil de l'enfant Jésus · DRAFT (2/4)"
                    )
                    SubElement(meas, "sound", {"tempo": "72"})
            if mi in (7, 12):
                SubElement(meas, "print", {"new-system": "yes"})

            for step, alter, octave, q, lyr_n in meas_notes:
                typ, dur, dotted = dur_type(q)
                note = SubElement(meas, "note")
                if step == "R":
                    SubElement(note, "rest")
                else:
                    pitch = SubElement(note, "pitch")
                    SubElement(pitch, "step").text = step
                    if alter:
                        SubElement(pitch, "alter").text = str(alter)
                    SubElement(pitch, "octave").text = str(octave)
                    SubElement(note, "stem").text = (
                        "up" if (clef == "G" and octave >= 4) or (clef == "F" and octave >= 3) else "down"
                    )
                SubElement(note, "duration").text = str(dur)
                SubElement(note, "voice").text = "1"
                SubElement(note, "type").text = typ
                if dotted:
                    SubElement(note, "dot")
                if with_lyr and lyr_n > 0 and step != "R":
                    text = VERSE1[lyric_i]
                    lyric_i += 1
                    ly = SubElement(note, "lyric", {"number": "1"})
                    SubElement(ly, "syllabic").text = "single"
                    SubElement(ly, "text").text = text

            if mi == 15:
                bl = SubElement(meas, "barline", {"location": "right"})
                SubElement(bl, "bar-style").text = "light-heavy"

    xml = "<?xml version='1.0' encoding='utf-8'?>\n" + tostring(root, encoding="unicode")
    OUT.write_text(xml, encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes), lyrics {lyric_i}/{len(VERSE1)}")


if __name__ == "__main__":
    build()
