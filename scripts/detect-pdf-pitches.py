#!/usr/bin/env python3
"""Detect notehead pitches on cropped staff images for Stille Nacht PDF."""
from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path("examples/_pdf_pages")


def staff_line_ys(gray: np.ndarray) -> list[int]:
    """Return 5 staff line y positions (top to bottom) within a crop."""
    h, w = gray.shape
    # Prefer the densest band of horizontal lines in the upper portion.
    row = (gray < 140).mean(axis=1)
    # Smooth
    kernel = np.ones(3) / 3
    sm = np.convolve(row, kernel, mode="same")
    # Find local peaks
    peaks = []
    for y in range(2, h - 2):
        if sm[y] > 0.08 and sm[y] >= sm[y - 1] and sm[y] >= sm[y + 1]:
            peaks.append((sm[y], y))
    peaks.sort(reverse=True)
    # Take candidate peaks and cluster into ~5 lines with similar spacing
    cands = sorted(y for _, y in peaks[:20])
    best = None
    best_score = -1
    for i in range(len(cands)):
        for j in range(i + 1, len(cands)):
            spacing = cands[j] - cands[i]
            if spacing < 6 or spacing > 28:
                continue
            lines = [cands[i] + k * spacing for k in range(5)]
            if lines[-1] >= h - 2:
                continue
            score = 0.0
            matched = []
            for ly in lines:
                # nearest peak
                nearest = min(cands, key=lambda y: abs(y - ly))
                if abs(nearest - ly) <= 3:
                    score += sm[nearest]
                    matched.append(nearest)
                else:
                    score -= 0.05
            if len(set(matched)) >= 4 and score > best_score:
                best_score = score
                best = [int(round(ly)) for ly in lines]
    if best is None:
        # fallback: densest 5 peaks with median spacing
        top = sorted(y for _, y in peaks[:12])
        if len(top) >= 5:
            return top[:5]
        raise RuntimeError("Could not find staff lines")
    return best


def pitch_from_y(y: float, lines: list[int], clef: str = "treble") -> str:
    """Map notehead center y to pitch name for treble or bass clef."""
    # lines[0]=top line ... lines[4]=bottom line
    spacing = (lines[4] - lines[0]) / 4.0
    # position in steps from bottom line: 0 = bottom line, +2 = next line up, etc.
    # In image coords, smaller y is higher pitch.
    steps_from_bottom = (lines[4] - y) / (spacing / 2.0)
    step = int(round(steps_from_bottom))
    # Treble: bottom line = E4 (step 0), F4=1, G4=2, A4=3, B4=4, C5=5, D5=6, E5=7, F5=8
    # Bass: bottom line = G2
    names = ["C", "D", "E", "F", "G", "A", "B"]
    if clef == "treble":
        # step 0 => E4
        midi = 64 + step  # E4=64
    elif clef == "bass":
        midi = 43 + step  # G2=43
    else:
        raise ValueError(clef)
    # midi to name
    pc = midi % 12
    oct_ = midi // 12 - 1
    # C C# D D# E F F# G G# A A# B
    map_pc = {0: "C", 2: "D", 4: "E", 5: "F", 7: "G", 9: "A", 11: "B"}
    # Snap to diatonic natural for C major reading
    # Prefer nearest natural if we landed on sharp due to rounding
    if pc not in map_pc:
        # choose closer natural
        for d in (-1, 1, -2, 2):
            if (pc + d) % 12 in map_pc:
                pc = (pc + d) % 12
                break
    return f"{map_pc[pc]}{oct_}"


def detect_noteheads(gray: np.ndarray, lines: list[int]) -> list[tuple[int, int, str]]:
    """Return list of (x, y, pitch) for filled noteheads left-to-right."""
    h, w = gray.shape
    spacing = (lines[4] - lines[0]) / 4.0
    # Search band around staff ± 2 spaces for ledger lines
    y0 = max(0, int(lines[0] - 2.5 * spacing))
    y1 = min(h, int(lines[4] + 2.5 * spacing))
    band = gray[y0:y1, :]
    # Invert: noteheads are dark blobs
    ink = (band < 100).astype(np.uint8)
    # Remove thin horizontal staff lines roughly
    for ly in lines:
        yy = ly - y0
        if 0 <= yy < ink.shape[0]:
            ink[max(0, yy - 1) : yy + 2, :] = 0

    # Connected components via simple flood
    visited = np.zeros_like(ink, dtype=bool)
    blobs = []
    hh, ww = ink.shape
    for y in range(hh):
        for x in range(ww):
            if not ink[y, x] or visited[y, x]:
                continue
            # BFS
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
            # Notehead size roughly ~ spacing
            if area < 12 or area > spacing * spacing * 4:
                continue
            if bw < spacing * 0.45 or bw > spacing * 2.2:
                continue
            if bh < spacing * 0.35 or bh > spacing * 2.0:
                continue
            aspect = bw / max(bh, 1)
            if aspect < 0.7 or aspect > 2.4:
                continue
            cx = sum(c[0] for c in cells) / area
            cy = sum(c[1] for c in cells) / area + y0
            blobs.append((cx, cy, area, bw, bh))

    # Merge near-duplicates
    blobs.sort(key=lambda b: b[0])
    merged = []
    for b in blobs:
        if merged and abs(b[0] - merged[-1][0]) < spacing * 0.55 and abs(b[1] - merged[-1][1]) < spacing * 0.55:
            # keep larger
            if b[2] > merged[-1][2]:
                merged[-1] = b
            continue
        merged.append(b)

    results = []
    for cx, cy, *_ in merged:
        # skip far left clef region
        if cx < 55:
            continue
        pitch = pitch_from_y(cy, lines)
        results.append((int(cx), int(cy), pitch))
    return results


def annotate(path: Path, clef: str = "treble") -> list[str]:
    im = Image.open(path).convert("L")
    gray = np.array(im)
    lines = staff_line_ys(gray)
    heads = detect_noteheads(gray, lines)
    # draw debug
    rgb = im.convert("RGB")
    draw = ImageDraw.Draw(rgb)
    for y in lines:
        draw.line([(0, y), (rgb.size[0], y)], fill=(0, 180, 0), width=1)
    pitches = []
    for x, y, p in heads:
        draw.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 0, 0), width=2)
        draw.text((x - 6, y - 16), p, fill=(200, 0, 0))
        pitches.append(p)
    dbg = OUT / f"dbg-{path.stem}.png"
    rgb.save(dbg)
    print(f"{path.name}: lines={lines} pitches={pitches}")
    return pitches


def main() -> None:
    for name in [
        "n-p1s2-sop",
        "n-p1s2-alt",
        "n-p1s2-ten",
        "n-p1s2-bas",
        "n-p2s1-sop",
        "n-p2s1-alt",
        "n-p2s1-ten",
        "n-p2s1-bas",
        "n-p2s2-sop",
        "n-p2s2-alt",
        "n-p2s2-ten",
        "n-p2s2-bas",
    ]:
        p = OUT / f"{name}.png"
        if p.exists():
            try:
                annotate(p)
            except Exception as e:
                print(f"{name}: FAIL {e}")


if __name__ == "__main__":
    main()
