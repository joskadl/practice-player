#!/usr/bin/env python3
"""Annotate note heads on Entre soprano crops for visual verification."""
from __future__ import annotations

from itertools import combinations
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

OUT = Path("examples/_img_crops/dbg")
OUT.mkdir(exist_ok=True)


def staff_lines(gray: np.ndarray) -> tuple[list[int], float]:
    h, w = gray.shape
    ink = (gray < 140).astype(np.float32)
    row = ink.sum(axis=1)
    sm = np.convolve(row, np.ones(5) / 5, mode="same")
    peaks = []
    for y in range(2, h - 2):
        if sm[y] > sm[y - 1] and sm[y] >= sm[y + 1] and sm[y] > w * 0.12:
            peaks.append((sm[y], y))
    peaks.sort(reverse=True)
    ys = sorted({y for _, y in peaks[:12]})
    best = None
    for comb in combinations(ys, 5):
        sp = [comb[k + 1] - comb[k] for k in range(4)]
        if min(sp) <= 0:
            continue
        if max(sp) / min(sp) < 1.4:
            var = float(np.var(sp))
            if best is None or var < best[0]:
                best = (var, list(comb), float(np.mean(sp)))
    if not best:
        raise RuntimeError("no staff lines")
    return best[1], best[2]


def pitch2(y: float, lines: list[int], clef: str = "treble") -> str:
    sp = (lines[4] - lines[0]) / 4.0
    steps = int(round((lines[4] - y) / (sp / 2.0)))
    diat = ["C", "D", "E", "F", "G", "A", "B"]
    if clef == "treble":
        midi_like = 4 * 7 + 2 + steps  # E4
    else:
        midi_like = 2 * 7 + 4 + steps  # G2
    return f"{diat[midi_like % 7]}{midi_like // 7}"


def detect(path: Path, clef: str = "treble", cut: float = 0.12) -> None:
    im = ImageOps.autocontrast(Image.open(path).convert("L"))
    gray = np.array(im)
    lines, sp = staff_lines(gray)
    h, w = gray.shape
    y0 = max(0, int(lines[0] - 3 * sp))
    y1 = min(h, int(lines[4] + 3 * sp))
    band = gray[y0:y1]
    ink = (band < 100).astype(np.uint8)
    for ly in lines:
        yy = ly - y0
        ink[max(0, yy - 1) : yy + 2, :] = 0
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
            if area < 10 or area > sp * sp * 8:
                continue
            if bw < sp * 0.3 or bw > sp * 3:
                continue
            if bh < sp * 0.25 or bh > sp * 2.5:
                continue
            aspect = bw / max(bh, 1)
            if aspect < 0.45 or aspect > 3:
                continue
            if bh > sp * 1.7 and aspect < 0.7:
                continue
            cx = sum(c[0] for c in cells) / area
            cy = sum(c[1] for c in cells) / area + y0
            if cx < w * cut:
                continue
            blobs.append((cx, cy, area, bw, bh))
    blobs.sort()
    merged = []
    for b in blobs:
        if (
            merged
            and abs(b[0] - merged[-1][0]) < sp * 0.5
            and abs(b[1] - merged[-1][1]) < sp * 0.6
        ):
            if b[2] > merged[-1][2]:
                merged[-1] = b
            continue
        merged.append(b)
    rgb = im.convert("RGB")
    draw = ImageDraw.Draw(rgb)
    for ly in lines:
        draw.line([(0, ly), (w, ly)], fill=(0, 200, 0), width=1)
    print(f"\n=== {path.name} lines={lines} sp={sp:.1f} ===")
    parts = []
    for cx, cy, a, bw, bh in merged:
        p = pitch2(cy, lines, clef)
        draw.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], outline=(255, 0, 0), width=2)
        draw.text((cx - 8, cy - 22), p, fill=(255, 0, 0))
        print(f"  x={cx:.0f} y={cy:.0f} {p} area={a} {bw}x{bh}")
        parts.append(p)
    out = OUT / f"annot_{path.stem}.png"
    rgb.save(out)
    print(f"saved {out} :: {' '.join(parts)}")


def main() -> None:
    base = Path("examples/_img_crops")
    for name, clef, cut in [
        ("sop_m1_3.png", "treble", 0.10),
        ("s1S.png", "treble", 0.14),
        ("s1A.png", "treble", 0.14),
        ("s1T.png", "treble", 0.14),
        ("s1B.png", "bass", 0.14),
        ("s2S.png", "treble", 0.14),
        ("s3S.png", "treble", 0.14),
        ("key_clef.png", "treble", 0.35),
        ("m1_stack.png", "treble", 0.20),
    ]:
        try:
            detect(base / name, clef, cut)
        except Exception as e:
            print(name, "FAIL", e)


if __name__ == "__main__":
    main()
