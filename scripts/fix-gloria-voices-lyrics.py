#!/usr/bin/env python3
"""
Split Gloria MusicXML into SATB parts (one score-part per staff voice)
and replace Italian lyrics with Dutch.

Reads the committed single-part source from git when the working tree
file is already split, otherwise uses the path on disk.
"""
from __future__ import annotations

import copy
import re
import subprocess
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "examples/gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.musicxml"
GIT_PATH = "examples/gloria-in-excelsis-deo-oggi-e-nato-il-salvatore.musicxml"

# Syllables sized to existing lyric slots on staff1/voice1.
VERSE1 = [
    "En", "gel", "kens", "door", "het", "lucht", "ruim", "zwe", "vend",
    "Zon", "gen", "zo", "blij", "zo", "won", "der", "zacht",
    "He", "den", "is", "Gods", "zoon", "ge", "bo", "ren",
    "Die", "ons", "vre", "de", "op", "aar", "de", "bracht",
    "Glo", "ri", "a", "in", "ex", "cel", "sis", "De", "o",
    "Glo", "ri", "a", "in", "ex", "cel", "sis", "De", "o",
]  # 51

# 31 slots on lyric number 2 — compress kla-re→klare, krib-be→kribbe.
VERSE2 = [
    "Zon", "gen", "zo", "blij", "en", "won", "der", "klare",
    "Van't", "zoe", "te", "Kind", "je", "rein", "en", "teer",
    "En", "de", "her", "der", "kens", "die", "er", "wa", "ren",
    "Kniel", "den", "bij", "de", "kribbe", "neer",
]  # 31

VOICE_MAP = [
    ("1", "1", "Soprano", "S", "P1"),
    ("1", "2", "Alto", "A", "P2"),
    ("2", "5", "Tenor", "T", "P3"),
    ("3", "9", "Bass", "B", "P4"),
]


def local(tag: str | None) -> str:
    return tag.split("}")[-1] if tag else ""


def children(parent: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in list(parent) if local(c.tag) == name]


def first(parent: ET.Element, name: str) -> ET.Element | None:
    cs = children(parent, name)
    return cs[0] if cs else None


def deep_copy(el: ET.Element) -> ET.Element:
    return copy.deepcopy(el)


def load_source_xml() -> str:
    """Prefer the committed single-part source so re-runs are idempotent."""
    try:
        raw = subprocess.check_output(
            ["git", "show", f"HEAD:{GIT_PATH}"],
            cwd=ROOT,
            stderr=subprocess.DEVNULL,
        )
        text = raw.decode("utf-8")
        root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", text))
        parts = root.findall("part")
        voices = {
            (n.findtext("staff") or "1", n.findtext("voice") or "1")
            for part in parts
            for n in part.iter("note")
        }
        if len(parts) == 1 and len(voices) >= 3:
            print("source: git HEAD (single multi-voice part)")
            return text
    except (subprocess.CalledProcessError, ET.ParseError, OSError):
        pass
    print("source: working tree file")
    return SRC.read_text(encoding="utf-8")


def make_rest(duration: int, voice: str = "1") -> ET.Element:
    n = ET.Element("note")
    ET.SubElement(n, "rest")
    ET.SubElement(n, "duration").text = str(duration)
    ET.SubElement(n, "voice").text = voice
    # type hint for common lengths (divisions=2 in this score → quarter=2)
    # Leave type optional; OSMD tolerates duration-only rests.
    ET.SubElement(n, "staff").text = "1"
    return n


def measure_length(measure: ET.Element, default_len: int) -> int:
    """Max timeline position reached while walking the measure."""
    pos = 0
    max_pos = 0
    for child in list(measure):
        tag = local(child.tag)
        if tag == "note":
            if child.find("chord") is not None or child.find("grace") is not None:
                continue
            dur = int(child.findtext("duration") or 0)
            pos += dur
            max_pos = max(max_pos, pos)
        elif tag == "backup":
            pos -= int(child.findtext("duration") or 0)
        elif tag == "forward":
            pos += int(child.findtext("duration") or 0)
            max_pos = max(max_pos, pos)
    attrs = measure.find("attributes")
    if attrs is not None:
        d = attrs.findtext("divisions")
        time = attrs.find("time")
        if d and time is not None:
            beats = int(time.findtext("beats") or 4)
            beat_type = int(time.findtext("beat-type") or 4)
            theoretical = int(d) * beats * 4 // beat_type
            return max(max_pos, theoretical, default_len)
    return max(max_pos, default_len)


def filter_measure_for_voice(
    measure: ET.Element,
    staff: str,
    voice: str,
    default_len: int,
) -> ET.Element:
    """Keep this staff+voice; pad leading/trailing gaps with rests (drop backup/forward)."""
    out = ET.Element("measure", measure.attrib)
    target_len = measure_length(measure, default_len)
    pos = 0
    out_pos = 0

    for child in list(measure):
        tag = local(child.tag)
        if tag == "note":
            st = child.findtext("staff") or "1"
            vo = child.findtext("voice") or "1"
            is_chord = child.find("chord") is not None
            is_grace = child.find("grace") is not None
            dur = int(child.findtext("duration") or 0)
            start = pos
            if st == staff and vo == voice:
                if not is_chord and not is_grace and out_pos < start:
                    gap = start - out_pos
                    out.append(make_rest(gap))
                    out_pos = start
                n = deep_copy(child)
                st_el = n.find("staff")
                if st_el is not None:
                    st_el.text = "1"
                vo_el = n.find("voice")
                if vo_el is not None:
                    vo_el.text = "1"
                out.append(n)
                if not is_chord and not is_grace:
                    out_pos = start + dur
            if not is_chord and not is_grace:
                pos += dur
            continue
        if tag == "backup":
            pos -= int(child.findtext("duration") or 0)
            continue
        if tag == "forward":
            pos += int(child.findtext("duration") or 0)
            continue
        if tag == "attributes":
            attrs = deep_copy(child)
            staves = attrs.find("staves")
            if staves is not None:
                staves.text = "1"
            for clef in list(attrs.findall("clef")):
                num = clef.get("number") or "1"
                if num != staff:
                    attrs.remove(clef)
                elif "number" in clef.attrib:
                    del clef.attrib["number"]
            out.append(attrs)
            continue
        out.append(deep_copy(child))

    if out_pos < target_len:
        out.append(make_rest(target_len - out_pos))
    return out


def apply_dutch_lyrics(part: ET.Element) -> None:
    slots: dict[str, list[ET.Element]] = {"1": [], "2": []}
    for measure in part.findall("measure"):
        for note in measure.findall("note"):
            if note.find("chord") is not None:
                continue
            for ly in note.findall("lyric"):
                num = ly.get("number") or "1"
                text_el = ly.find("text")
                if text_el is None:
                    continue
                slots.setdefault(num, []).append(text_el)

    for num, words in (("1", VERSE1), ("2", VERSE2)):
        texts = slots.get(num) or []
        if not texts:
            continue
        n = min(len(texts), len(words))
        for i in range(n):
            texts[i].text = words[i]
        for i in range(n, len(texts)):
            texts[i].text = ""
        print(f"  lyrics#{num}: filled {n}/{len(texts)} (verse has {len(words)})")


def main() -> None:
    assert len(VERSE1) == 51, len(VERSE1)
    assert len(VERSE2) == 31, len(VERSE2)

    raw = load_source_xml()
    root = ET.fromstring(re.sub(r"<!DOCTYPE[^>]*>", "", raw))
    src_part = root.find("part")
    if src_part is None:
        raise SystemExit("no part")

    work = first(root, "work")
    if work is None:
        work = ET.Element("work")
        root.insert(0, work)
    wt = first(work, "work-title")
    if wt is None:
        wt = ET.SubElement(work, "work-title")
    wt.text = "Gloria in excelsis Deo"
    mt = first(root, "movement-title")
    if mt is None:
        mt = ET.Element("movement-title")
        root.insert(1, mt)
    mt.text = "Gloria in excelsis Deo"

    old_pl = first(root, "part-list")
    pl = ET.Element("part-list")
    pg_start = ET.SubElement(pl, "part-group", {"type": "start", "number": "1"})
    ET.SubElement(pg_start, "group-symbol").text = "bracket"
    for staff, voice, name, abbr, pid in VOICE_MAP:
        sp = ET.SubElement(pl, "score-part", {"id": pid})
        ET.SubElement(sp, "part-name").text = name
        ET.SubElement(sp, "part-abbreviation").text = abbr
        si = ET.SubElement(sp, "score-instrument", {"id": f"{pid}-I1"})
        ET.SubElement(si, "instrument-name").text = name
        mi = ET.SubElement(sp, "midi-instrument", {"id": f"{pid}-I1"})
        ch = {"Soprano": "1", "Alto": "2", "Tenor": "3", "Bass": "4"}[name]
        ET.SubElement(mi, "midi-channel").text = ch
        ET.SubElement(mi, "midi-program").text = "53"
    ET.SubElement(pl, "part-group", {"type": "stop", "number": "1"})

    if old_pl is not None:
        idx = list(root).index(old_pl)
        root.remove(old_pl)
        root.insert(idx, pl)
    else:
        root.append(pl)

    for p in list(root.findall("part")):
        root.remove(p)

    measures = src_part.findall("measure")
    default_len = 8
    for staff, voice, name, abbr, pid in VOICE_MAP:
        part = ET.Element("part", {"id": pid})
        for m in measures:
            part.append(filter_measure_for_voice(m, staff, voice, default_len))
        print(f"{name} ({pid}) staff={staff} voice={voice}")
        apply_dutch_lyrics(part)
        root.append(part)

    ident = first(root, "identification")
    if ident is not None:
        for el in children(ident, "creator") + children(ident, "rights") + children(ident, "source"):
            ident.remove(el)
        enc = first(ident, "encoding")
        if enc is not None:
            for sw in children(enc, "software"):
                sw.text = "MIDI Practice Player"

    xml = ET.tostring(root, encoding="unicode")
    if not xml.startswith("<?xml"):
        xml = "<?xml version='1.0' encoding='utf-8'?>\n" + xml
    SRC.write_text(xml, encoding="utf-8")
    print(f"wrote {SRC} bytes {SRC.stat().st_size}")


if __name__ == "__main__":
    main()
