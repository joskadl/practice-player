/**
 * Soft real-time tick clock (same idea as JustPlay's MIDI project scheduler).
 */

const PB_CENTER = 8192;

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
    this.tempoPercent = 100;
    this.applyPitchBends = true;
    this._timer = null;
    this._anchorPerf = 0;
    this._anchorTick = 0;
    this._lastTick = 0;
    this._sounding = new Map();
    this._auditionTimers = [];
    /** When true, the next ``_advance`` includes notes/bends at ``_lastTick`` (Play/seek start). */
    this._includeStartTick = false;
  }

  setProject(project) {
    this.stop();
    this.project = project;
    this.playheadTick = 0;
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

  setTempoPercent(pct) {
    const next = Math.max(25, Math.min(200, pct | 0));
    if (this.playing) {
      this._anchorTick = this.currentTick();
      this._anchorPerf = performance.now();
    }
    this.tempoPercent = next;
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
    const rate = Math.max(0.25, this.tempoPercent / 100);
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
    const elapsedSec = (performance.now() - this._anchorPerf) / 1000;
    const rate = this.tempoPercent / 100;
    return this._tickAfterSeconds(this._anchorTick, elapsedSec * rate);
  }

  _tickAfterSeconds(fromTick, seconds) {
    const { durationTicks } = this.project;
    if (seconds <= 0) return fromTick;
    let lo = fromTick;
    let hi = durationTicks;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const dt = this._secondsBetween(fromTick, mid);
      if (dt < seconds) lo = mid;
      else hi = mid;
    }
    return Math.min(durationTicks, Math.round(hi));
  }

  _secondsBetween(a, b) {
    if (b <= a) return 0;
    return this.project.secondsAt(b) - this.project.secondsAt(a);
  }

  play() {
    if (!this.project || this.playing) return;
    if (this.playheadTick >= this.project.durationTicks) this.playheadTick = 0;
    this._clearAudition();
    this._silence({ panic: true });
    this.playing = true;
    this._anchorPerf = performance.now();
    this._anchorTick = this.playheadTick;
    this._lastTick = this.playheadTick;
    // Inclusive first window so notes at the playhead (e.g. tick 0) fire on Play.
    this._includeStartTick = true;
    this._restorePitchBendsAt(this.playheadTick);
    this._timer = setInterval(() => this._advance(), 10);
  }

  pause({ keepPlayhead = false } = {}) {
    if (!this.playing) return;
    const tick = this.currentTick();
    this.playing = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (!keepPlayhead) this.playheadTick = tick;
    this._clearAudition();
    this._silence({ panic: true });
    this.handlers.onTick(this.playheadTick);
  }

  stop() {
    this.pause({ keepPlayhead: true });
    this.playheadTick = 0;
    this._lastTick = 0;
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
      this._restorePitchBendsAt(to);
      this.handlers.onTick(to);
      return;
    }

    const inWindow = (t) => (includeStart ? t >= from && t <= to : t > from && t <= to);

    if (this.applyPitchBends && this.project.pitchBends?.length) {
      for (const pb of this.project.pitchBends) {
        if (inWindow(pb.tick)) this._emitBend(pb.channel, pb.value);
      }
    }

    for (const note of this.project.notes) {
      if (note.end > from && note.end <= to) {
        if (this._sounding.has(note.id)) {
          this._sounding.delete(note.id);
          this.handlers.onNoteOff(note);
        }
      }
    }
    for (const note of this.project.notes) {
      if (!inWindow(note.start)) continue;
      if (!this.handlers.isVoiceAudible(note.voiceId)) continue;
      const sounding = this._soundingNote(note);
      this._sounding.set(note.id, sounding);
      this.handlers.onNoteOn(sounding);
    }

    this._lastTick = to;
    this.playheadTick = to;
    this.handlers.onTick(to);

    if (to >= this.project.durationTicks) {
      this.pause({ keepPlayhead: true });
      this.playheadTick = this.project.durationTicks;
      this.handlers.onTick(this.playheadTick);
    }
  }
}
