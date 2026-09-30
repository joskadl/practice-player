#!/usr/bin/env python3
"""Improved pitch/key detection for Entre le boeuf scan."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("dp", "scripts/detect-pdf-pitches.py")
dp = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(dp)

OUT = Path("examples/_img_crops")
DBG = OUT / "dbg2"
DBG.mkdir(exist_ok=True)


def count_accidentals(gray: np.ndarray, lines: list[int]) -> tuple[str, int]:
    """Rough key signature: count sharp-like blobs just after the clef."""
    h, w = gray.shape
    spacing = (lines[4] - lines[0]) / 4.0
    # clef occupies ~ left 10-14%; key sig next ~8%
    x0 = int(w * 0.10)
    x1 = int(w * 0.18)
    y0 = max(0, int(lines[0] - spacing))
    y1 = min(h, int(lines[4] + spacing))
    region = gray[y0:y1, x0:x1]
    ink = (region < 100).astype(np.uint8)
    # vertical projection
    col = ink.sum(axis=0)
    # find vertical streaks (sharps are tall)
    streaks = 0
    i = 0
    while i < len(col):
        if col[i] > spacing * 1.2:
            j = i
            while j < len(col) and col[j] > spacing * 0.5:
                j += 1
            width = j - i
            if 2 <= width <= spacing * 1.2:
                streaks += 1
            i = j
        else:
            i += 1
    # flats are usually fewer tall streaks; sharps look like # with 2 verticals each
    # crude: if streaks >= 2 -> likely 1 sharp (2 verticals), >=4 -> 2 sharps
    if streaks >= 4:
        return "sharps", 2
    if streaks >= 2:
        return "sharps", 1
    # check for flat: round blobs on middle line
    return "naturals", 0


def pitch_from_y(y: float, lines: list[int], clef: str) -> str:
    spacing = (lines[4] - lines[0]) / 4.0
    steps = int(round((lines[4] - y) / (spacing / 2.0)))
    map_pc = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}
    midi = (64 if clef.startswith("treble") else 43) + steps
    pc = midi % 12
    oct_ = midi // 12 - 1
    if pc not in map_pc:
        for d in (-1, 1, -2, 2):
            if (pc + d) % 12 in map_pc:
                pc = (pc + d) % 12
                break
    return f"{map_pc[pc]}{oct_}"


def detect_heads(gray: np.ndarray, lines: list[int], clef: str, cut_frac: float = 0.18):
    h, w = gray.shape
    spacing = (lines[4] - lines[0]) / 4.0
    y0 = max(0, int(lines[0] - 3 * spacing))
    y1 = min(h, int(lines[4] + 3 * spacing))
    band = gray[y0:y1, :].copy()
    ink = (band < 115).astype(np.uint8)
    # erase staff lines
    for ly in lines:
        yy = ly - y0
        if 0 <= yy < ink.shape[0]:
            ink[max(0, yy - 1) : yy + 2, :] = 0
    # connected components
    visited = np.zeros_like(ink, dtype=bool)
    blobs = []
    hh, ww = ink.shape
    for y in range(hh):
        for x in range(ww):
            if not ink[y, x] or visited[y, x]:
                continue
            stack = [(x, y)]
            visited[y, x] = True
            cells = []
            minx = maxx = x
            miny = maxy = y
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                minx = min(minx, cx)
                maxx = max(maxx, cx)
                miny = min(miny, cy)
                maxy = max(maxy, cy)
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < ww and 0 <= ny < hh and ink[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((nx, ny))
            bw = maxx - minx + 1
            bh = maxy - miny + 1
            area = len(cells)
            if area < 12 or area > spacing * spacing * 6:
                continue
            if bw < spacing * 0.35 or bw > spacing * 2.8:
                continue
            if bh < spacing * 0.28 or bh > spacing * 2.4:
                continue
            aspect = bw / max(bh, 1)
            if aspect < 0.5 or aspect > 2.8:
                continue
            # reject tall thin stems leftover
            if bh > spacing * 1.6 and aspect < 0.75:
                continue
            cx = sum(c[0] for c in cells) / area
            cy = sum(c[1] for c in cells) / area + y0
            blobs.append((cx, cy, area, bw, bh))
    blobs.sort(key=lambda b: b[0])
    merged = []
    for b in blobs:
        if (
            merged
            and abs(b[0] - merged[-1][0]) < spacing * 0.45
            and abs(b[1] - merged[-1][1]) < spacing * 0.55
        ):
            if b[2] > merged[-1][2]:
                merged[-1] = b
            continue
        merged.append(b)
    cut = w * cut_frac
    out = []
    for cx, cy, area, bw, bh in merged:
        if cx < cut:
            continue
        out.append((int(cx), int(cy), pitch_from_y(cy, lines, clef), int(area)))
    return out, spacing


def main() -> None:
    for name, clef in [
        ("s1S", "treble"),
        ("s1A", "treble"),
        ("s1T", "treble"),
        ("s1B", "bass"),
        ("s2S", "treble"),
        ("s2A", "treble"),
        ("s2T", "treble"),
        ("s2B", "bass"),
        ("s3S", "treble"),
        ("s3A", "treble"),
        ("s3T", "treble"),
        ("s3B", "bass"),
    ]:
        path = OUT / f"{name}.png"
        im = Image.open(path).convert("L")
        gray = np.array(im)
        try:
            lines = dp.staff_line_ys(gray)
        except Exception as e:
            print(name, "NO LINES", e)
            continue
        kind, n = count_accidentals(gray, lines)
        heads, sp = detect_heads(gray, lines, clef)
        rgb = im.convert("RGB")
        draw = ImageDraw.Draw(rgb)
        for y in lines:
            draw.line([(0, y), (rgb.size[0], y)], fill=(0, 180, 0), width=1)
        # mark cut
        draw.line([(int(gray.shape[1] * 0.18), 0), (int(gray.shape[1] * 0.18), rgb.size[1])], fill=(0, 0, 255), width=1)
        parts = []
        for x, y, p, a in heads:
            draw.ellipse([x - 6, y - 6, x + 6, y + 6], outline=(255, 0, 0), width=2)
            draw.text((x - 10, y - 20), p, fill=(220, 0, 0))
            parts.append(p)
        rgb.save(DBG / f"{name}.png")
        print(f"{name}: key~{kind}{n} sp={sp:.1f} n={len(parts)} :: {' '.join(parts)}")


if __name__ == "__main__":
    main()
