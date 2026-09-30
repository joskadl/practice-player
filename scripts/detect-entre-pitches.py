#!/usr/bin/env python3
"""Detect pitches on Entre le boeuf staff crops."""
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
DBG = OUT / "dbg"
DBG.mkdir(exist_ok=True)


def pitch_from_y(y: float, lines: list[int], clef: str = "treble") -> str:
    spacing = (lines[4] - lines[0]) / 4.0
    steps_from_bottom = (lines[4] - y) / (spacing / 2.0)
    step = int(round(steps_from_bottom))
    map_pc = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}
    midi = (64 if clef.startswith("treble") else 43) + step
    pc = midi % 12
    oct_ = midi // 12 - 1
    if pc not in map_pc:
        for d in (-1, 1, -2, 2):
            if (pc + d) % 12 in map_pc:
                pc = (pc + d) % 12
                break
    return f"{map_pc[pc]}{oct_}"


def detect(gray: np.ndarray, lines: list[int], clef: str):
    h, w = gray.shape
    spacing = (lines[4] - lines[0]) / 4.0
    y0 = max(0, int(lines[0] - 2.5 * spacing))
    y1 = min(h, int(lines[4] + 2.5 * spacing))
    band = gray[y0:y1, :]
    ink = (band < 110).astype(np.uint8)
    for ly in lines:
        yy = ly - y0
        if 0 <= yy < ink.shape[0]:
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
            if area < 15 or area > spacing * spacing * 5:
                continue
            if bw < spacing * 0.4 or bw > spacing * 2.5:
                continue
            if bh < spacing * 0.3 or bh > spacing * 2.2:
                continue
            aspect = bw / max(bh, 1)
            if aspect < 0.55 or aspect > 2.6:
                continue
            cx = sum(c[0] for c in cells) / area
            cy = sum(c[1] for c in cells) / area + y0
            blobs.append((cx, cy, area))
    blobs.sort(key=lambda b: b[0])
    merged = []
    for b in blobs:
        if (
            merged
            and abs(b[0] - merged[-1][0]) < spacing * 0.5
            and abs(b[1] - merged[-1][1]) < spacing * 0.5
        ):
            if b[2] > merged[-1][2]:
                merged[-1] = b
            continue
        merged.append(b)
    cut = w * 0.16
    out = []
    for cx, cy, area in merged:
        if cx < cut:
            continue
        out.append((int(cx), int(cy), pitch_from_y(cy, lines, clef), area))
    return out


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
        heads = detect(gray, lines, clef)
        rgb = im.convert("RGB")
        draw = ImageDraw.Draw(rgb)
        for y in lines:
            draw.line([(0, y), (rgb.size[0], y)], fill=(0, 180, 0), width=1)
        pitches = []
        for x, y, p, _a in heads:
            draw.ellipse([x - 5, y - 5, x + 5, y + 5], outline=(255, 0, 0), width=2)
            draw.text((x - 8, y - 18), p, fill=(200, 0, 0))
            pitches.append(f"{p}@{x}")
        rgb.save(DBG / f"{name}.png")
        print(f"{name}: {' '.join(pitches)}")


if __name__ == "__main__":
    main()
