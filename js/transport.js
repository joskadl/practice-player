/**
 * Soft real-time tick clock driven by the AudioContext (when available)
 * or performance.now(). Audio events advance on a short setInterval so CPU
 * spikes / missed rAF frames do not stall note on/off; UI uses rAF.
 */

const PB_CENTER = 8192;
/** Audio poll interval — short enough for 16th notes at fast tempos. */
const AUDIO_POLL_MS = 8;

export class Transport {
  /**
   * @param {{
   *   onNoteOn: (n: object) => void,
   *   onNoteOff: (n: object) => void,
   *   onPitchBend?: (channel: number, value14: number) => void,
   *   onPanic?: () => void,
   *   onTick: (tick: number) => void,
   *   isVoiceAudible: (voiceId: string) => boolean,
   * }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.project = null;
    this.playing = false;
    this.playheadTick = 0;
    /** User-facing BPM (scaled against scoreBpm). */
    this.tempoBpm = 120;
    /** Score's initial BPM from the tempo map. */
    this.scoreBpm = 120;
    this.applyPitchBends = true;
    /** @type {AudioContext|null} */
    this._audioCtx = null;
    this._audioTimer = 0;
    this._uiRaf = 0;
    /** Wall / audio seconds at last anchor. */
    this._anchorTime = 0;
    this._anchorTick = 0;
    this._lastTick = 0;
    this._sounding = new Map();
    this._auditionTimers = [];
    /** When true, the next ``_advance`` includes notes/bends at ``_lastTick`` (Play/seek start). */
    this._includeStartTick = false;
    /** @type {object[]} */
    this._byStart = [];
    /** @type {object[]} */
    this._byEnd = [];
    this._startIdx = 0;
    this._endIdx = 0;
    this._bendIdx = 0;
    this._lastUiTick = -1;
  }

  /** Prefer AudioContext.currentTime for a clock that tracks the audio thread. */
  setAudioContext(ctx) {
    this._audioCtx = ctx || null;
  }

  _nowSec() {
    const ctx = this._audioCtx;
    if (ctx && typeof ctx.currentTime === "number") {
      return ctx.currentTime;
    }
    return performance.now() / 1000;
  }

  _tempoRate() {
    const base = Math.max(1, this.scoreBpm);
    return Math.max(0.05, Math.min(4, this.tempoBpm / base));
  }

  setProject(project) {
    this.stop();
    this.project = project;
    this.playheadTick = 0;
    this._rebuildNoteIndex();
    const us = project?.tempoMap?.[0]?.usPerBeat ?? 500_000;
    this.scoreBpm = us > 0 ? Math.max(1, Math.round(60_000_000 / us)) : 120;
    this.tempoBpm = this.scoreBpm;
  }

  _rebuildNoteIndex() {
    const notes = this.project?.notes || [];
    this._byStart = notes.slice().sort((a, b) => a.start - b.start || a.id - b.id);
    this._byEnd = notes.slice().sort((a, b) => a.end - b.end || a.id - b.id);
    this._startIdx = 0;
    this._endIdx = 0;
    this._bendIdx = 0;
  }

  setApplyPitchBends(enabled) {
    this.applyPitchBends = !!enabled;
    this._restorePitchBendsAt(this.playheadTick);
  }

  /** Note as heard: remapped MIDI number / play channel when JI markers require it. */
  _soundingNote(note) {
    if (!this.applyPitchBends || !this.project?.noteRetunes) return note;
    const rt = this.project.noteRetunes[note.id];
    if (!rt) return note;
    return {
      ...note,
      note: rt.note,
      channel: rt.channel,
    };
  }

  /**
   * Set playback BPM. Scales the whole score tempo map relative to scoreBpm.
   * @param {number} bpm
   */
  setTempoBpm(bpm) {
    const next = Math.max(20, Math.min(400, Number(bpm) || this.scoreBpm));
    if (this.playing) {
      this._anchorTick = this.currentTick();
      this._anchorTime = this._nowSec();
    }
    this.tempoBpm = next;
  }

  /** @deprecated Use setTempoBpm — kept for any leftover callers. */
  setTempoPercent(pct) {
    const rate = Math.max(0.25, Math.min(2, (pct | 0) / 100));
    this.setTempoBpm(this.scoreBpm * rate);
  }

  seek(tick) {
    const max = this.project?.durationTicks ?? 0;
    const next = Math.max(0, Math.min(max, tick | 0));
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause({ keepPlayhead: true });
    this._clearAudition();
    this._silence({ panic: true });
    this.playheadTick = next;
    this._lastTick = next;
    this._resyncNoteCursors(next);
    this._restorePitchBendsAt(next);
    this.handlers.onTick(next);
    if (wasPlaying) this.play();
  }

  /**
   * Preview audible notes that start at ``tick`` (JustPlay ←/→ behaviour).
   * No-op while transport is playing — seek already resumes from the new position.
   */
  auditionAt(tick) {
    if (!this.project || this.playing) return;
    this._clearAudition();
    this._silence({ panic: true });
    this._restorePitchBendsAt(tick);
    const atTick = this.project.notes.filter(
      (n) => n.start === tick && this.handlers.isVoiceAudible(n.voiceId),
    );
    for (const note of atTick) {
      const sounding = this._soundingNote(note);
      this._sounding.set(note.id, sounding);
      this.handlers.onNoteOn(sounding);
      const durTicks = Math.max(1, note.end - note.start);
      const ms = Math.min(8000, Math.max(80, this._ticksToMs(tick, durTicks)));
      const timer = setTimeout(() => {
        if (!this._sounding.has(note.id)) return;
        const held = this._sounding.get(note.id);
        this._sounding.delete(note.id);
        this.handlers.onNoteOff(held);
      }, ms);
      this._auditionTimers.push(timer);
    }
  }

  _ticksToMs(fromTick, ticks) {
    if (!this.project || ticks <= 0) return 0;
    const rate = this._tempoRate();
    const sec =
      this.project.secondsAt(fromTick + ticks) - this.project.secondsAt(fromTick);
    return (sec / rate) * 1000;
  }

  _clearAudition() {
    for (const id of this._auditionTimers) clearTimeout(id);
    this._auditionTimers = [];
  }

  currentTick() {
    if (!this.playing || !this.project) return this.playheadTick;
    const elapsedSec = Math.max(0, this._nowSec() - this._anchorTime);
    return this._tickAfterSeconds(this._anchorTick, elapsedSec * this._tempoRate());
  }

  _tickAfterSeconds(fromTick, seconds) {
    const { durationTicks } = this.project;
    if (seconds <= 0) return fromTick;
    if ((this.project.tempoMap?.length || 0) <= 1) {
      const tpb = this.project.ticksPerBeat || 480;
      const us = this.project.tempoMap?.[0]?.usPerBeat || 500_000;
      const secPerTick = us / 1_000_000 / tpb;
      if (secPerTick > 0) {
        return Math.min(durationTicks, fromTick + Math.floor(seconds / secPerTick + 1e-9));
      }
    }
    let lo = fromTick;
    let hi = durationTicks;
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2;
      const dt = this._secondsBetween(fromTick, mid);
      if (dt < seconds) lo = mid;
      else hi = mid;
    }
    return Math.min(durationTicks, Math.floor(hi + 1e-9));
  }

  _secondsBetween(a, b) {
    if (b <= a) return 0;
    return this.project.secondsAt(b) - this.project.secondsAt(a);
  }

  /** Lower-bound index in a sorted-by-field array. */
  _lowerBound(arr, field, value) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid][field] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  _resyncNoteCursors(tick) {
    this._startIdx = this._lowerBound(this._byStart, "start", tick + 1);
    this._endIdx = this._lowerBound(this._byEnd, "end", tick + 1);
    const bends = this.project?.pitchBends || [];
    this._bendIdx = this._lowerBound(bends, "tick", tick + 1);
  }

  play() {
    if (!this.project || this.playing) return;
    if (this.playheadTick >= this.project.durationTicks) this.playheadTick = 0;
    this._clearAudition();
    this._silence({ panic: true });
    this.playing = true;
    this._anchorTime = this._nowSec();
    this._anchorTick = this.playheadTick;
    this._lastTick = this.playheadTick;
    this._includeStartTick = true;
    this._resyncNoteCursors(this.playheadTick);
    // Start cursor so notes at the playhead are still eligible when includeStart.
    this._startIdx = this._lowerBound(this._byStart, "start", this.playheadTick);
    this._endIdx = this._lowerBound(this._byEnd, "end", this.playheadTick + 1);
    this._bendIdx = this._lowerBound(this.project.pitchBends || [], "tick", this.playheadTick);
    this._restorePitchBendsAt(this.playheadTick);
    this._startClocks();
  }

  _startClocks() {
    this._stopClocks();
    // High-rate audio poll independent of display refresh / main-thread paint load.
    this._audioTimer = setInterval(() => {
      if (!this.playing) return;
      this._advance();
    }, AUDIO_POLL_MS);
    const uiLoop = () => {
      this._uiRaf = 0;
      if (!this.playing) return;
      const tick = this.playheadTick;
      if (tick !== this._lastUiTick) {
        this._lastUiTick = tick;
        this.handlers.onTick(tick);
      }
      this._uiRaf = requestAnimationFrame(uiLoop);
    };
    this._uiRaf = requestAnimationFrame(uiLoop);
    // Fire first audio window immediately (don't wait for first interval).
    this._advance();
  }

  _stopClocks() {
    if (this._audioTimer) {
      clearInterval(this._audioTimer);
      this._audioTimer = 0;
    }
    if (this._uiRaf) {
      cancelAnimationFrame(this._uiRaf);
      this._uiRaf = 0;
    }
  }

  pause({ keepPlayhead = false } = {}) {
    if (!this.playing) return;
    const tick = this.currentTick();
    this.playing = false;
    this._stopClocks();
    if (!keepPlayhead) this.playheadTick = tick;
    this._clearAudition();
    this._silence({ panic: true });
    this.handlers.onTick(this.playheadTick);
  }

  stop() {
    this.pause({ keepPlayhead: true });
    this.playheadTick = 0;
    this._lastTick = 0;
    this._resyncNoteCursors(0);
    this._restorePitchBendsAt(0);
    this.handlers.onTick(0);
  }

  _silence({ panic = false } = {}) {
    this._clearAudition();
    for (const note of this._sounding.values()) this.handlers.onNoteOff(note);
    this._sounding.clear();
    if (panic && this.handlers.onPanic) this.handlers.onPanic();
  }

  /**
   * Drop sounding notes that are no longer audible (mute/solo/accomp → 0).
   * Call after the mix changes while notes may still be held.
   */
  resyncAudibility() {
    for (const [id, note] of [...this._sounding.entries()]) {
      if (this.handlers.isVoiceAudible(note.voiceId)) continue;
      this._sounding.delete(id);
      this.handlers.onNoteOff(note);
    }
  }

  _emitBend(channel, value14) {
    if (!this.handlers.onPitchBend) return;
    this.handlers.onPitchBend(channel, value14);
  }

  /** Reset all used channels to center, or last bend ≤ tick when JI is on. */
  _restorePitchBendsAt(tick) {
    if (!this.project || !this.handlers.onPitchBend) return;
    const channels = new Set();
    for (const n of this.project.notes) channels.add(n.channel);
    for (const pb of this.project.pitchBends || []) channels.add(pb.channel);
    for (const rt of Object.values(this.project.noteRetunes || {})) {
      if (rt?.channel != null) channels.add(rt.channel);
    }

    if (!this.applyPitchBends || !this.project.hasPitchBends) {
      for (const ch of channels) this._emitBend(ch, PB_CENTER);
      return;
    }

    const last = new Map();
    for (const pb of this.project.pitchBends) {
      if (pb.tick > tick) break;
      last.set(pb.channel, pb.value);
    }
    for (const ch of channels) {
      this._emitBend(ch, last.has(ch) ? last.get(ch) : PB_CENTER);
    }
  }

  _advance() {
    if (!this.project || !this.playing) return;
    const tick = this.currentTick();
    const from = this._lastTick;
    const to = tick;
    const includeStart = this._includeStartTick;
    this._includeStartTick = false;
    if (to < from) {
      this._silence({ panic: true });
      this._lastTick = to;
      this.playheadTick = to;
      this._includeStartTick = true;
      this._resyncNoteCursors(to);
      this._restorePitchBendsAt(to);
      return;
    }

    const startMin = includeStart ? from : from + 1;

    if (this.applyPitchBends && this.project.pitchBends?.length) {
      const bends = this.project.pitchBends;
      while (this._bendIdx < bends.length && bends[this._bendIdx].tick < startMin) {
        this._bendIdx += 1;
      }
      while (this._bendIdx < bends.length && bends[this._bendIdx].tick <= to) {
        const pb = bends[this._bendIdx++];
        this._emitBend(pb.channel, pb.value);
      }
    }

    while (this._endIdx < this._byEnd.length && this._byEnd[this._endIdx].end <= to) {
      const note = this._byEnd[this._endIdx++];
      if (note.end <= from) continue;
      if (this._sounding.has(note.id)) {
        const held = this._sounding.get(note.id);
        this._sounding.delete(note.id);
        this.handlers.onNoteOff(held);
      }
    }

    while (this._startIdx < this._byStart.length && this._byStart[this._startIdx].start <= to) {
      const note = this._byStart[this._startIdx];
      if (note.start < startMin) {
        this._startIdx += 1;
        continue;
      }
      this._startIdx += 1;
      if (!this.handlers.isVoiceAudible(note.voiceId)) continue;
      const sounding = this._soundingNote(note);
      this._sounding.set(note.id, sounding);
      this.handlers.onNoteOn(sounding);
    }

    this._lastTick = to;
    this.playheadTick = to;

    if (to >= this.project.durationTicks) {
      this.pause({ keepPlayhead: true });
      this.playheadTick = this.project.durationTicks;
      this.handlers.onTick(this.playheadTick);
    }
  }
}
