// Game sound, synthesized with the Web Audio API (no recorded or licensed files).
// There is no sound in vacuum: these are "cockpit" cues for the player — engine and thrusters
// felt through the structure, the rover's motors, telemetry chimes and alarms.
// The audio context starts on the first user gesture (browser autoplay rules); muting is
// remembered per browser.

const KEY = 'lln.sound';

function loadMuted(): boolean {
  try { return localStorage.getItem(KEY) === 'off'; } catch { return false; }
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engine: { gain: GainNode; filter: BiquadFilterNode; rumble: GainNode } | null = null;
  private rcs: GainNode | null = null;
  private motor: { osc: OscillatorNode; whine: OscillatorNode; gain: GainNode; whineGain: GainNode; filter: BiquadFilterNode } | null = null;
  muted = loadMuted();
  private listeners = new Set<(muted: boolean) => void>();

  /** Create or resume the audio context; call from a user gesture. */
  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? 'off' : 'on'); } catch { /* storage blocked: keep it for this visit */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    this.listeners.forEach((f) => f(m));
  }

  onMute(f: (muted: boolean) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  private noiseSource() {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  /** Main engine: a filtered rumble that opens with the throttle (0..1). */
  setEngine(throttle: number) {
    if (!this.ready) return;
    const c = this.ctx!, t = c.currentTime;
    if (!this.engine) {
      if (throttle <= 0.001) return;
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 200;
      const gain = c.createGain(); gain.gain.value = 0;
      const src = this.noiseSource(); src.connect(filter).connect(gain).connect(this.master); src.start();
      const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = 42;
      const rumble = c.createGain(); rumble.gain.value = 0;
      osc.connect(rumble).connect(this.master); osc.start();
      this.engine = { gain, filter, rumble };
    }
    const k = Math.max(0, Math.min(1, throttle));
    this.engine.gain.gain.setTargetAtTime(0.32 * k, t, 0.06);
    this.engine.filter.frequency.setTargetAtTime(220 + 1100 * k, t, 0.08);
    this.engine.rumble.gain.setTargetAtTime(0.22 * k, t, 0.08);
  }

  /** Lateral thrusters: a hiss while any of them fires. */
  setRcs(on: boolean) {
    if (!this.ready) return;
    const c = this.ctx!;
    if (!this.rcs) {
      if (!on) return;
      const band = c.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 2600; band.Q.value = 0.8;
      this.rcs = c.createGain(); this.rcs.gain.value = 0;
      const src = this.noiseSource(); src.connect(band).connect(this.rcs).connect(this.master); src.start();
    }
    this.rcs.gain.setTargetAtTime(on ? 0.07 : 0, c.currentTime, on ? 0.02 : 0.05);
  }

  /** Rover drives: a motor hum whose pitch follows the speed (0..1 of top speed). */
  setMotor(speed: number) {
    if (!this.ready) return;
    const c = this.ctx!, t = c.currentTime;
    if (!this.motor) {
      if (speed <= 0.01) return;
      const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 700;
      const gain = c.createGain(); gain.gain.value = 0;
      const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 60;
      osc.connect(filter).connect(gain).connect(this.master); osc.start();
      const whineGain = c.createGain(); whineGain.gain.value = 0;
      const whine = c.createOscillator(); whine.type = 'sine'; whine.frequency.value = 500;
      whine.connect(whineGain).connect(this.master); whine.start();
      this.motor = { osc, whine, gain, whineGain, filter };
    }
    const k = Math.max(0, Math.min(1, speed));
    this.motor.osc.frequency.setTargetAtTime(55 + 120 * k, t, 0.1);
    this.motor.whine.frequency.setTargetAtTime(420 + 700 * k, t, 0.1);
    this.motor.gain.gain.setTargetAtTime(k > 0.01 ? 0.05 + 0.05 * k : 0, t, 0.08);
    this.motor.whineGain.gain.setTargetAtTime(k > 0.01 ? 0.012 * k : 0, t, 0.08);
  }

  /** Silence every continuous sound (leaving a phase or the page). */
  stopLoops() {
    this.setEngine(0); this.setRcs(false); this.setMotor(0);
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number, to?: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master);
    o.start(at); o.stop(at + dur + 0.05);
  }

  private burst(at: number, dur: number, vol: number, from: number, to: number, type: BiquadFilterType = 'bandpass') {
    const c = this.ctx!, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.setValueAtTime(from, at); f.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(at); src.stop(at + dur + 0.05);
  }

  /** Ship flight between stations or the dive to the surface. */
  whoosh(ms: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime, d = Math.max(0.6, ms / 1000);
    this.burst(t, d, 0.22, 260, 1700);
    this.tone(70, t, d, 'sine', 0.08, 110);
  }

  /** Arrived at a station, objective done. */
  chime() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(660, t, 0.35, 'sine', 0.12);
    this.tone(990, t + 0.12, 0.5, 'sine', 0.1);
  }

  /** Objective completed: a brighter three-note arpeggio. */
  success() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784].forEach((f, k) => this.tone(f, t + k * 0.11, 0.45, 'triangle', 0.11));
  }

  /** Warning (sunset, low battery, cold, crash). */
  alarm() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let k = 0; k < 3; k++) { this.tone(880, t + k * 0.32, 0.14, 'square', 0.045); this.tone(660, t + k * 0.32 + 0.15, 0.14, 'square', 0.045); }
  }

  /** Science scan: rising telemetry blips. */
  scan() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    [800, 1000, 1300, 1700].forEach((f, k) => this.tone(f, t + k * 0.09, 0.12, 'sine', 0.07));
  }

  /** Touchdown: a soft thump, or a crunch when it was a crash. */
  touchdown(ok: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.tone(ok ? 75 : 55, t, ok ? 0.45 : 0.9, 'sine', ok ? 0.35 : 0.5, ok ? 40 : 30);
    this.burst(t, ok ? 0.35 : 0.8, ok ? 0.15 : 0.35, ok ? 500 : 900, 120, 'lowpass');
    if (!ok) this.alarm();
  }
}

export const sfx = new Sfx();
