#!/usr/bin/env python3
"""Clean notehead detection after erasing staff lines."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps


def staff_lines(gray: np.ndarray) -> list[int]:
    h, w = gray.shape
    ink = (gray < 140).astype(np.float32)
    row = ink.sum(axis=1)
    sm = np.convolve(row, np.ones(5) / 5, mode="same")
    peaks = []
    for y in range(2, h - 2):
        if sm[y] > sm[y - 1] and sm[y] >= sm[y + 1] and sm[y] > w * 0.12:
            peaks.append((sm[y], y))
    peaks.sort(reverse=True)
    ys = sorted({y for _, y in peaks[:15]})
    best = None
    from itertools import combinations

    for comb in combinations(ys, 5):
        sp = [comb[k + 1] - comb[k] for k in range(4)]
        if min(sp) < 12 or max(sp) > 40:
            continue
        if max(sp) / min(sp) > 1.45:
            continue
        mean = float(np.mean(sp))
        score = abs(mean - 20) + float(np.std(sp)) * 2
        if best is None or score < best[0]:
            best = (score, list(comb), mean)
    if not best:
        raise RuntimeError("no lines")
    return best[1]


def pname(y: float, lines: list[int], clef: str) -> tuple[str, int]:
    sp = (lines[4] - lines[0]) / 4.0
    steps = int(round((lines[4] - y) / (sp / 2.0)))
    diat = "CDEFGAB"
    base = (4 * 7 + 2) if clef == "treble" else (2 * 7 + 4)
    idx = base + steps
    return f"{diat[idx % 7]}{idx // 7}", steps


def detect(path: Path, clef="treble", cut_frac=0.12, out_name=None):
    im = ImageOps.autocontrast(Image.open(path).convert("L"))
    g = np.array(im).astype(np.uint8)
    lines = staff_lines(g)
    sp = (lines[4] - lines[0]) / 4.0
    h, w = g.shape
    # erase staff lines (widen a bit)
    work = g.copy()
    for ly in lines:
        work[max(0, ly - 1) : ly + 2, :] = 255
    # also erase thin horizontal remnants
    ink = (work < 105).astype(np.uint8)
    # remove thin vertical stems: open with elliptical kernel approx notehead
    # manual CC
    visited = np.zeros_like(ink, bool)
    blobs = []
    y0 = max(0, int(lines[0] - 3.5 * sp))
    y1 = min(h, int(lines[4] + 3.5 * sp))
    for y in range(y0, y1):
        for x in range(int(w * cut_frac), w):
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
                    if 0 <= nx < w and 0 <= ny < h and ink[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((nx, ny))
            bw = maxx - minx + 1
            bh = maxy - miny + 1
            area = len(cells)
            if area < 18 or area > sp * sp * 8:
                continue
            if bw < sp * 0.4 or bw > sp * 2.6:
                continue
            if bh < sp * 0.28 or bh > sp * 2.0:
                continue
            aspect = bw / max(bh, 1)
            if aspect < 0.55 or aspect > 2.5:
                continue
            # reject leftover stem fragments
            if bh > sp * 1.5 and aspect < 0.8:
                continue
            cx = sum(c[0] for c in cells) / area
            cy = sum(c[1] for c in cells) / area
            blobs.append((cx, cy, area, bw, bh))
    blobs.sort()
    merged = []
    for b in blobs:
        if (
            merged
            and abs(b[0] - merged[-1][0]) < sp * 0.5
            and abs(b[1] - merged[-1][1]) < sp * 0.55
        ):
            if b[2] > merged[-1][2]:
                merged[-1] = b
            continue
        merged.append(b)

    rgb = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(rgb)
    for ly in lines:
        draw.line([(0, ly), (w, ly)], fill=(0, 180, 0), width=1)
    print(f"\n=== {path.name} sp={sp:.1f} n={len(merged)} ===")
    results = []
    for cx, cy, area, bw, bh in merged:
        p, steps = pname(cy, lines, clef)
        draw.ellipse([cx - 7, cy - 7, cx + 7, cy + 7], outline=(255, 0, 0), width=2)
        draw.text((cx - 10, cy - 22), p, fill=(220, 0, 0))
        print(f"  x={cx:6.1f} y={cy:6.1f} {p:3} steps={steps:2} area={area:3} {bw}x{bh}")
        results.append((cx, p))
    out = Path("examples/_img_crops/dbg") / (out_name or f"clean_{path.stem}.png")
    rgb.save(out)
    print("saved", out)
    print("sequence:", " ".join(p for _, p in results))
    return results


def main():
    base = Path("examples/_img_crops")
    detect(base / "sop_m1_3.png", cut_frac=0.10)
    detect(base / "clef_ks_0.png", cut_frac=0.30)
    detect(base / "key_clef.png", cut_frac=0.40)
    detect(base / "s1S.png", cut_frac=0.13)
    detect(base / "s1A.png", cut_frac=0.13)
    detect(base / "s1T.png", cut_frac=0.13)
    detect(base / "s1B.png", clef="bass", cut_frac=0.13)
    detect(base / "s2S.png", cut_frac=0.13)
    detect(base / "s3S.png", cut_frac=0.13)
    detect(base / "s3A.png", cut_frac=0.13)
    detect(base / "s3T.png", cut_frac=0.13)
    detect(base / "s3B.png", clef="bass", cut_frac=0.13)


if __name__ == "__main__":
    main()
