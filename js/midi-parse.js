/**
 * Minimal Standard MIDI File parser (format 0/1).
 * Returns flattened timed notes, channel voices, pitch bends, and JustPlay JI meta.
 */

import { buildPitchBendsFromMarkers } from "./ji-retune.js";

const JI_CC_CHANNEL = 15;
const JI_CC_MODE = 101;
const JI_CC_BASE_FIFTHS = 102;
const JI_CC_BASE_THIRDS = 114;
const JI_CC_BYPASS_THRESHOLD = 64;
const JI_CC_COORD_OFFSET = 64;
const JI_CC_COMPLETE_MASK = 0xffffff;
const JI_CC_RPN_CONTROLS = new Set([6, 38, 100]);

function readU16(view, offset) {
  return view.getUint16(offset, false);
}

function readU32(view, offset) {
  return view.getUint32(offset, false);
}

function readVarLen(view, offset) {
  let value = 0;
  let pos = offset;
  while (pos < view.byteLength) {
    const b = view.getUint8(pos++);
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { value, pos };
}

function decodeTrackName(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  } catch {
    return "";
  }
}

/**
 * Build mute/solo voices. Prefer MIDI channels (matches piano-roll colours) when a
 * single track carries several channels (typical JustPlay retuned export).
 * Otherwise keep one voice per note-bearing track (classic multi-track choir MIDI).
 */
function buildVoices(notes, tracks) {
  const channelCounts = new Map();
  const trackChannelCounts = new Map();
  for (const n of notes) {
    channelCounts.set(n.channel, (channelCounts.get(n.channel) || 0) + 1);
    const key = `${n.track}:${n.channel}`;
    trackChannelCounts.set(key, (trackChannelCounts.get(key) || 0) + 1);
  }
  const channels = [...channelCounts.keys()].sort((a, b) => a - b);
  const useChannels =
    channels.length > tracks.length ||
    (tracks.length <= 1 && channels.length > 1) ||
    tracks.some((tr) => {
      let used = 0;
      for (const ch of channels) {
        if (trackChannelCounts.get(`${tr.id}:${ch}`)) used += 1;
      }
      return used > 1;
    });

  if (useChannels) {
    return channels.map((ch) => {
      let bestName = "";
      let bestCount = 0;
      for (const tr of tracks) {
        const c = trackChannelCounts.get(`${tr.id}:${ch}`) || 0;
        if (c > bestCount) {
          bestCount = c;
          bestName = tr.name;
        }
      }
      const onlyThisTrack =
        bestName &&
        tracks.filter((tr) => (trackChannelCounts.get(`${tr.id}:${ch}`) || 0) > 0).length === 1;
      const name =
        onlyThisTrack && bestName && !/^Track\s+\d+$/i.test(bestName)
          ? bestName
          : `Channel ${ch + 1}`;
      return {
        id: `ch:${ch}`,
        kind: "channel",
        channel: ch,
        track: null,
        name,
        noteCount: channelCounts.get(ch) || 0,
      };
    });
  }

  return tracks.map((tr) => ({
    id: `tr:${tr.id}`,
    kind: "track",
    channel: tr.channel,
    track: tr.id,
    name: tr.name,
    noteCount: tr.noteCount,
  }));
}

function voiceIdForNote(note, voiceKind) {
  return voiceKind === "channel" ? `ch:${note.channel}` : `tr:${note.track}`;
}

function parseJiMarkerText(text, streamTick) {
  if (!text.startsWith("JI_MARKER:")) return null;
  try {
    const data = JSON.parse(text.slice("JI_MARKER:".length));
    if (!data || data.type !== "ji_marker") return null;
    const config = (data.config || []).map((c) => (Array.isArray(c) ? c.map(Number) : [0, 0]));
    if (config.length < 12) return null;
    return {
      tick: data.tick != null ? data.tick | 0 : streamTick,
      config,
      bypass: !!data.bypass,
      mode: data.mode || "tonnetz",
      metadata: data.metadata || null,
      name: data.name || null,
      source: "text",
    };
  } catch {
    return null;
  }
}

function markerNeedsTextKeep(marker) {
  if (!marker) return false;
  if (marker.metadata?.refNote != null) return true;
  if (marker.metadata?.ji === false) return true;
  return marker.config?.some((c) => Array.isArray(c) && c.length > 2 && (c[2] | 0) !== 0);
}

/** Incremental CC decoder for JustPlay channel-16 marker protocol. */
class CcMarkerDecoder {
  constructor() {
    this.cfgFifths = Array(12).fill(0);
    this.cfgThirds = Array(12).fill(0);
    this.ccReceived = 0;
  }

  resetPartial() {
    this.ccReceived = 0;
  }

  feed(tick, channel, control, value) {
    if (channel !== JI_CC_CHANNEL) return null;
    if (JI_CC_RPN_CONTROLS.has(control)) return null;
    if (control === JI_CC_MODE) {
      if (value >= JI_CC_BYPASS_THRESHOLD) {
        this.resetPartial();
        return {
          tick,
          config: Array.from({ length: 12 }, () => [0, 0]),
          bypass: true,
          mode: "tonnetz",
          metadata: null,
          name: null,
          source: "cc",
        };
      }
      this.resetPartial();
      return null;
    }
    if (control >= JI_CC_BASE_FIFTHS && control <= JI_CC_BASE_FIFTHS + 11) {
      const k = control - JI_CC_BASE_FIFTHS;
      this.cfgFifths[k] = value - JI_CC_COORD_OFFSET;
      this.ccReceived |= 1 << k;
    } else if (control >= JI_CC_BASE_THIRDS && control <= JI_CC_BASE_THIRDS + 11) {
      const k = control - JI_CC_BASE_THIRDS;
      this.cfgThirds[k] = value - JI_CC_COORD_OFFSET;
      this.ccReceived |= 1 << (k + 12);
    } else {
      return null;
    }
    if (this.ccReceived === JI_CC_COMPLETE_MASK) {
      const config = this.cfgFifths.map((f, i) => [f, this.cfgThirds[i]]);
      this.resetPartial();
      return {
        tick,
        config,
        bypass: false,
        mode: "tonnetz",
        metadata: null,
        name: null,
        source: "cc",
      };
    }
    return null;
  }
}

function mergeMarkers(textMarkers, ccMarkers) {
  const byTick = new Map();
  for (const m of textMarkers) byTick.set(m.tick, m);
  for (const m of ccMarkers) {
    const existing = byTick.get(m.tick);
    if (existing && markerNeedsTextKeep(existing)) continue;
    if (existing?.bypass && !m.bypass) byTick.set(m.tick, m);
    else if (!m.bypass || !existing) byTick.set(m.tick, m);
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

/**
 * @param {ArrayBuffer} buffer
 */
export function parseMidi(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 14) throw new Error("File too small to be MIDI");
  const header = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (header !== "MThd") throw new Error("Not a MIDI file (missing MThd)");

  const headerLen = readU32(view, 4);
  const format = readU16(view, 8);
  const trackCount = readU16(view, 10);
  const division = readU16(view, 12);
  if (division & 0x8000) {
    throw new Error("SMPTE time-division MIDI is not supported");
  }
  const ticksPerBeat = division;
  if (format > 1) throw new Error(`MIDI format ${format} is not supported`);

  let pos = 8 + headerLen;
  const tempoMap = [{ tick: 0, usPerBeat: 500_000 }];
  const tracks = [];
  const notes = [];
  /** @type {{tick: number, channel: number, value: number}[]} */
  const pitchBends = [];
  /** @type {Map<number, number>} channel → semitone range from RPN */
  const bendRangeByChannel = new Map();
  const textMarkers = [];
  const ccMarkers = [];
  const ccDecoder = new CcMarkerDecoder();
  let justPlayMeta = false;
  let jiFileRefNote = null;
  let jiFilePbRange = null;
  let noteId = 0;
  let durationTicks = 0;

  // RPN assemble state per channel: { rpnMsb, rpnLsb, dataMsb }
  const rpnState = Array.from({ length: 16 }, () => ({ msb: 127, lsb: 127, data: 0 }));

  for (let t = 0; t < trackCount; t++) {
    if (pos + 8 > view.byteLength) break;
    const tag = String.fromCharCode(view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2), view.getUint8(pos + 3));
    if (tag !== "MTrk") throw new Error(`Expected MTrk at track ${t}`);
    const trackLen = readU32(view, pos + 4);
    const trackStart = pos + 8;
    const trackEnd = trackStart + trackLen;
    pos = trackEnd;

    let tick = 0;
    let runningStatus = 0;
    let trackName = "";
    let primaryChannel = null;
    let noteCount = 0;
    /** @type {Map<string, {start: number, velocity: number, noteId: number}>} */
    const open = new Map();

    let i = trackStart;
    while (i < trackEnd) {
      const delta = readVarLen(view, i);
      i = delta.pos;
      tick += delta.value;
      if (i >= trackEnd) break;

      let status = view.getUint8(i);
      if (status < 0x80) {
        if (!runningStatus) throw new Error("Invalid running status in MIDI track");
        status = runningStatus;
      } else {
        i += 1;
        if (status < 0xf0) runningStatus = status;
      }

      if (status === 0xff) {
        const type = view.getUint8(i++);
        const len = readVarLen(view, i);
        i = len.pos;
        const data = new Uint8Array(buffer, i, len.value);
        i += len.value;
        if (type === 0x51 && len.value >= 3) {
          const us = (data[0] << 16) | (data[1] << 8) | data[2];
          tempoMap.push({ tick, usPerBeat: us });
        } else if (type === 0x03 && !trackName) {
          trackName = decodeTrackName(data);
        } else if (type === 0x01) {
          const text = decodeTrackName(data);
          if (text.startsWith("JI_FILE:") || text.startsWith("JI_MARKER:")) {
            justPlayMeta = true;
            if (text.startsWith("JI_FILE:")) {
              try {
                const payload = JSON.parse(text.slice("JI_FILE:".length));
                if (payload && typeof payload.refNote === "number") jiFileRefNote = payload.refNote;
                if (payload && typeof payload.pbRange === "number") jiFilePbRange = payload.pbRange;
              } catch {
                /* ignore malformed meta */
              }
            } else {
              const marker = parseJiMarkerText(text, tick);
              if (marker) textMarkers.push(marker);
            }
          }
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const len = readVarLen(view, i);
        i = len.pos + len.value;
        continue;
      }

      const eventType = status & 0xf0;
      const channel = status & 0x0f;
      if (eventType === 0xc0 || eventType === 0xd0) {
        i += 1;
        continue;
      }
      if (eventType === 0x80 || eventType === 0x90 || eventType === 0xa0 || eventType === 0xb0 || eventType === 0xe0) {
        const data1 = view.getUint8(i++);
        const data2 = view.getUint8(i++);
        if (eventType === 0x90 && data2 > 0) {
          const key = `${channel}:${data1}`;
          open.set(key, { start: tick, velocity: data2, noteId: noteId++ });
          if (primaryChannel == null) primaryChannel = channel;
        } else if (eventType === 0x80 || (eventType === 0x90 && data2 === 0)) {
          const key = `${channel}:${data1}`;
          const on = open.get(key);
          if (on) {
            open.delete(key);
            const end = Math.max(on.start + 1, tick);
            notes.push({
              id: on.noteId,
              track: t,
              channel,
              note: data1,
              velocity: on.velocity,
              start: on.start,
              end,
            });
            noteCount += 1;
            durationTicks = Math.max(durationTicks, end);
          }
        } else if (eventType === 0xe0) {
          // 14-bit unsigned pitch bend (0..16383), center 8192
          const value = (data2 << 7) | data1;
          pitchBends.push({ tick, channel, value });
          durationTicks = Math.max(durationTicks, tick);
        } else if (eventType === 0xb0) {
          const st = rpnState[channel];
          if (data1 === 101) st.msb = data2;
          else if (data1 === 100) st.lsb = data2;
          else if (data1 === 6) {
            st.data = data2;
            if (st.msb === 0 && st.lsb === 0) {
              bendRangeByChannel.set(channel, Math.max(1, Math.min(96, data2)));
            }
          }
          const ccMarker = ccDecoder.feed(tick, channel, data1, data2);
          if (ccMarker) {
            justPlayMeta = true;
            ccMarkers.push(ccMarker);
          }
        }
        continue;
      }
      throw new Error(`Unsupported MIDI status 0x${status.toString(16)}`);
    }

    for (const [key, on] of open) {
      const [chStr, noteStr] = key.split(":");
      const end = Math.max(on.start + ticksPerBeat, tick);
      notes.push({
        id: on.noteId,
        track: t,
        channel: Number(chStr),
        note: Number(noteStr),
        velocity: on.velocity,
        start: on.start,
        end,
      });
      noteCount += 1;
      durationTicks = Math.max(durationTicks, end);
    }

    tracks.push({
      id: t,
      name: trackName || `Track ${t + 1}`,
      channel: primaryChannel,
      noteCount,
    });
  }

  tempoMap.sort((a, b) => a.tick - b.tick);
  const compactTempo = [];
  for (const entry of tempoMap) {
    if (compactTempo.length && compactTempo[compactTempo.length - 1].tick === entry.tick) {
      compactTempo[compactTempo.length - 1] = entry;
    } else {
      compactTempo.push(entry);
    }
  }

  notes.sort((a, b) => a.start - b.start || a.end - b.end || a.note - b.note);
  pitchBends.sort((a, b) => a.tick - b.tick || a.channel - b.channel);

  const noteTracks = tracks.filter((tr) => tr.noteCount > 0);
  const voices = buildVoices(notes, noteTracks);
  const voiceKind = voices[0]?.kind || "track";
  for (const n of notes) {
    n.voiceId = voiceIdForNote(n, voiceKind);
  }

  /** Unique note-onset ticks ascending (for arrow-key skip). */
  const onsetTicks = [];
  let prevOnset = -1;
  for (const n of notes) {
    if (n.start !== prevOnset) {
      onsetTicks.push(n.start);
      prevOnset = n.start;
    }
  }

  let pitchBendRange = 2;
  if (jiFilePbRange != null) pitchBendRange = jiFilePbRange;
  else if (bendRangeByChannel.size) {
    pitchBendRange = Math.max(...bendRangeByChannel.values());
  }

  const markers = mergeMarkers(textMarkers, ccMarkers);
  if (markers.length) justPlayMeta = true;

  const filePitchBends = pitchBends.slice();
  let pitchBendSource = "none";
  let activePitchBends = [];
  // Markers win only when they carry real JI (not the inert ji:false load stub).
  // Otherwise prefer baked file bends from a JustPlay MIDI save/export.
  const editableMarkers = markers.filter(
    (m) =>
      m
      && !m.bypass
      && m.metadata?.ji !== false
      && Array.isArray(m.config)
      && m.config.some((c) => c != null && Array.isArray(c)),
  );
  if (editableMarkers.length) {
    activePitchBends = buildPitchBendsFromMarkers(notes, markers, {
      refNote: jiFileRefNote ?? 60,
      pitchBendRange,
    });
    pitchBendSource = activePitchBends.length ? "markers" : "none";
  } else if (filePitchBends.length) {
    activePitchBends = filePitchBends;
    pitchBendSource = "file";
  }

  return {
    ticksPerBeat,
    durationTicks,
    tempoMap: compactTempo,
    tracks: noteTracks,
    voices,
    notes,
    markers,
    pitchBends: activePitchBends,
    filePitchBends,
    pitchBendSource,
    onsetTicks,
    justPlayMeta,
    jiFileRefNote,
    pitchBendRange,
    bendRangeByChannel: Object.fromEntries(bendRangeByChannel),
    hasPitchBends: activePitchBends.length > 0,
  };
}

/** Absolute seconds from tick 0 → tick, using the tempo map. */
export function tickToSeconds(tick, tempoMap, ticksPerBeat) {
  let seconds = 0;
  let cursor = 0;
  let usPerBeat = tempoMap[0]?.usPerBeat ?? 500_000;
  for (let i = 0; i < tempoMap.length; i++) {
    const nextTick = i + 1 < tempoMap.length ? tempoMap[i + 1].tick : tick;
    const segmentEnd = Math.min(tick, nextTick);
    if (segmentEnd > cursor) {
      seconds += ((segmentEnd - cursor) * usPerBeat) / (ticksPerBeat * 1_000_000);
      cursor = segmentEnd;
    }
    if (cursor >= tick) break;
    usPerBeat = tempoMap[i + 1].usPerBeat;
  }
  if (tick > cursor) {
    seconds += ((tick - cursor) * usPerBeat) / (ticksPerBeat * 1_000_000);
  }
  return seconds;
}

export function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

/** Previous onset strictly before `tick`, or 0. */
export function prevOnsetTick(onsetTicks, tick) {
  if (!onsetTicks?.length) return 0;
  let lo = 0;
  let hi = onsetTicks.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (onsetTicks[mid] < tick) {
      ans = onsetTicks[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Next onset strictly after `tick`, or duration. */
export function nextOnsetTick(onsetTicks, tick, durationTicks) {
  if (!onsetTicks?.length) return durationTicks;
  let lo = 0;
  let hi = onsetTicks.length - 1;
  let ans = durationTicks;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (onsetTicks[mid] > tick) {
      ans = onsetTicks[mid];
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}
