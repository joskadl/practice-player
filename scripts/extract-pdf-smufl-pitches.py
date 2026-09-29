#!/usr/bin/env python3
"""Build measure-aligned pitch tables from the Stille Nacht PDF."""
from __future__ import annotations

import sys

import fitz

sys.stdout.reconfigure(encoding="utf-8")

NOTEHEAD = 0xE0A4
G_CLEF = 0xE050
G_CLEF_8VB = 0xE052
F_CLEF = 0xE062
SPACE = 5.0
NAMES = ["C", "D", "E", "F", "G", "A", "B"]


def glyphs(page):
    out = []
    d = page.get_text("rawdict")
    for b in d["blocks"]:
        if b.get("type") != 0:
            continue
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                for ch in span.get("chars", []):
                    c = ch.get("c") or ""
                    if not c:
                        continue
                    x0, y0, x1, y1 = ch["bbox"]
                    out.append({"cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2, "ord": ord(c)})
    return out


def pitch_from_diatonic(ref_name: str, ref_oct: int, steps_up: int) -> str:
    idx = NAMES.index(ref_name) + steps_up
    oct_ = ref_oct + (idx // 7 if idx >= 0 else -((-idx + 6) // 7))
    # simpler:
    oct_ = ref_oct
    i = NAMES.index(ref_name)
    i += steps_up
    while i < 0:
        i += 7
        oct_ -= 1
    while i >= 7:
        i -= 7
        oct_ += 1
    return f"{NAMES[i]}{oct_}"


def pitch_from_clef(cy: float, clef_cy: float, clef_kind: str) -> str:
    steps_up = round((clef_cy - cy) / (SPACE / 2))
    if clef_kind == "g":
        return pitch_from_diatonic("G", 4, steps_up)
    if clef_kind == "g8":
        return pitch_from_diatonic("G", 3, steps_up)
    return pitch_from_diatonic("F", 3, steps_up)


def clefs_of(g):
    out = []
    for gg in g:
        if gg["ord"] == G_CLEF:
            out.append(("g", gg["cy"]))
        elif gg["ord"] == G_CLEF_8VB:
            out.append(("g8", gg["cy"]))
        elif gg["ord"] == F_CLEF:
            out.append(("f", gg["cy"]))
    out.sort(key=lambda c: c[1])
    return out


def staff_notes(g, clefs, staff_index):
    kind, ccy = clefs[staff_index]
    notes = []
    for h in g:
        if h["ord"] != NOTEHEAD:
            continue
        # nearest clef
        i = min(range(len(clefs)), key=lambda j: abs(clefs[j][1] - h["cy"]))
        if i != staff_index:
            continue
        notes.append((h["cx"], pitch_from_clef(h["cy"], ccy, kind), h["cy"]))
    return sorted(notes, key=lambda n: n[0])


def chunk(notes, counts):
    out = []
    i = 0
    for c in counts:
        out.append(notes[i : i + c])
        i += c
    if i != len(notes):
        raise SystemExit(f"count mismatch used={i} have={len(notes)} counts={counts}")
    return out


def main():
    doc = fitz.open(r"examples/stille-nacht- bladmuziek (1).pdf")
    # Manual counts from Silent Night phrase structure + note totals per system
    # P1S1: 14 notes → 4,4,3,3
    # P1S2: 14 notes → 5,4,5  (measures 5-7)
    # P2S1: sop 11 → 4,5,2 (measures 8-10)
    # P2S2: sop 8 → 6,2 (measures 11-12)
    plan = [
        # page, system, counts_per_voice [S,A,T,B] each list of per-measure counts
        (0, 0, {"Soprano": [4, 4, 3, 3], "Alto": [4, 4, 3, 3], "Tenor": [3, 3, 3, 3], "Bass": [3, 3, 3, 3]}),
        (0, 1, {"Soprano": [5, 4, 5], "Alto": [5, 4, 5], "Tenor": [5, 4, 5], "Bass": [5, 4, 5]}),
        (1, 0, {"Soprano": [4, 5, 2], "Alto": [4, 5, 2], "Tenor": [4, 5, 2], "Bass": [4, 5, 2]}),
        (1, 1, {"Soprano": [6, 2], "Alto": [6, 2], "Tenor": [6, 2], "Bass": [5, 2]}),  # bass may differ
    ]

    voices = ["Soprano", "Alto", "Tenor", "Bass"]
    result = {v: [] for v in voices}

    for page_i, sys_i, counts in plan:
        page = doc[page_i]
        g = glyphs(page)
        clefs = clefs_of(g)
        base = sys_i * 4
        print(f"\nPAGE {page_i+1} SYS {sys_i+1}")
        for vi, voice in enumerate(voices):
            notes = staff_notes(g, clefs, base + vi)
            cnt = counts[voice]
            # fix if total mismatch - print and adjust bass especially
            if sum(cnt) != len(notes):
                print(f"  {voice}: expected {sum(cnt)} got {len(notes)} pitches={[p for _,p,_ in notes]}")
                # try auto: don't chunk
                result[voice].append(("AUTO", notes))
                continue
            measures = chunk(notes, cnt)
            for m in measures:
                result[voice].append([p for _, p, _ in m])
            print(f"  {voice}: " + " | ".join(" ".join(p for _, p, _ in m) for m in measures))

    print("\n=== FINAL TABLE ===")
    n = max(len(result[v]) for v in voices)
    # filter AUTO
    for v in voices:
        result[v] = [m for m in result[v] if not (isinstance(m, tuple) and m[0] == "AUTO")]
    n = max(len(result[v]) for v in voices)
    for i in range(n):
        print(f"m{i+1}:")
        for v in voices:
            if i < len(result[v]):
                print(f"  {v:8s} {' '.join(result[v][i])}")


if __name__ == "__main__":
    main()
