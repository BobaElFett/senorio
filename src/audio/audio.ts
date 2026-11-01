// Sonido sintetizado con Web Audio: sin archivos, todo se genera en el momento.
//  - Efectos: choque de armas, flechas, cargas, cuerno de alarma, campanas, martillos…
//  - Ambiente: viento, pájaros de día, grillos de noche
//  - Música generativa: laúd y bordón en re dórico; tambores durante las incursiones

export type Sfx = "clash" | "loose" | "thud" | "charge" | "horn" | "bell" | "chime" | "hammer" | "place" | "click" | "fanfare" | "rout";

const D_DORIAN = [0, 2, 3, 5, 7, 9, 10]; // semitonos sobre re
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private noise!: AudioBuffer;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private vols = { master: 0.8, music: 0.5, sfx: 0.8 };
  private listener = { x: 0, z: 0, zoom: 100 };
  private budget = new Map<Sfx, number>();   // límite de sonidos por segundo y tipo
  private musicT = 0;
  private step = 0;
  private phrase: number[] = [];
  private ambT = 0;
  hour = 0.5;
  tension = 0;          // 0 calma … 1 incursión

  constructor() {
    const unlock = () => {
      this.start();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
  }

  private start() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new C();
    } catch { return; }
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.startWind();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.vols = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vols.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vols.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vols.sfx * 0.6, t, 0.05);
  }

  setListener(x: number, z: number, zoom: number) { this.listener = { x, z, zoom }; }

  /** Atenuación por distancia al punto que mira la cámara y por el zoom. */
  private gainAt(x?: number, z?: number): number {
    if (x === undefined || z === undefined) return 1;
    const d = Math.hypot(x - this.listener.x, z - this.listener.z);
    const reach = 60 + this.listener.zoom * 0.9;
    const near = 1 - Math.min(1, d / reach);
    const zoomFall = Math.min(1, 60 / Math.max(30, this.listener.zoom));
    return near * near * (0.35 + 0.65 * zoomFall);
  }

  private noiseSrc(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f: number, t: number, peak: number, attack: number, decay: number, out: AudioNode, f2?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + attack + decay);
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + attack + decay + 0.05);
  }

  private burst(t: number, peak: number, dur: number, type: BiquadFilterType, freq: number, q: number, out: AudioNode, freq2?: number) {
    const ctx = this.ctx!;
    const s = this.noiseSrc(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freq2) f.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    this.env(g, t, peak, 0.004, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /** Reproduce un efecto; x/z = posición en el mundo (sin ella suena siempre igual). */
  play(name: Sfx, x?: number, z?: number, vol = 1) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const limit: Partial<Record<Sfx, number>> = { clash: 9, loose: 4, thud: 6, hammer: 3, charge: 2 };
    const now = this.ctx.currentTime;
    if (limit[name]) {
      const last = this.budget.get(name) ?? 0;
      if (now - last < 1 / limit[name]!) return;
      this.budget.set(name, now);
    }
    const g0 = this.gainAt(x, z) * vol;
    if (g0 < 0.02) return;
    const out = this.ctx.createGain();
    out.gain.value = g0;
    out.connect(this.sfxBus);
    const t = now + 0.01;
    const r = () => 0.85 + Math.random() * 0.3;
    switch (name) {
      case "clash": {
        this.burst(t, 0.35, 0.09, "bandpass", 2600 * r(), 3, out);
        for (const f of [1870, 2930, 4210]) this.tone("sine", f * r(), t, 0.06, 0.002, 0.18 * r(), out);
        break;
      }
      case "loose": this.burst(t, 0.12, 0.22, "highpass", 1800, 0.7, out, 5000); break;
      case "thud": this.tone("sine", 140 * r(), t, 0.25, 0.003, 0.08, out, 60); this.burst(t, 0.08, 0.05, "lowpass", 900, 1, out); break;
      case "charge": {
        this.burst(t, 0.3, 1.4, "lowpass", 260, 0.8, out);
        for (let k = 0; k < 5; k++) {
          const ctx = this.ctx, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = "sawtooth"; o.frequency.value = 150 + Math.random() * 90;
          f.type = "bandpass"; f.frequency.value = 700 + Math.random() * 300; f.Q.value = 4;
          const st = t + Math.random() * 0.25;
          this.env(g, st, 0.05, 0.12, 0.9);
          o.connect(f).connect(g).connect(out);
          o.start(st); o.stop(st + 1.2);
        }
        break;
      }
      case "horn": {
        for (const [f, st, len] of [[146.8, 0, 1.1], [220, 1.2, 1.6]] as const) {
          const ctx = this.ctx, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = "sawtooth"; o.frequency.value = f;
          lfo.frequency.value = 5; lg.gain.value = 2.5; lfo.connect(lg).connect(o.frequency);
          fl.type = "lowpass"; fl.frequency.value = 900;
          g.gain.setValueAtTime(0.0001, t + st);
          g.gain.exponentialRampToValueAtTime(0.25, t + st + 0.25);
          g.gain.setValueAtTime(0.25, t + st + len - 0.3);
          g.gain.exponentialRampToValueAtTime(0.0001, t + st + len);
          o.connect(fl).connect(g).connect(out);
          o.start(t + st); lfo.start(t + st); o.stop(t + st + len + 0.1); lfo.stop(t + st + len + 0.1);
        }
        break;
      }
      case "bell": for (const [f, a] of [[660, 0.18], [1584, 0.07], [2706, 0.04]]) this.tone("sine", f, t, a, 0.004, 2.2, out); break;
      case "chime": [0, 4, 7].forEach((s, i) => this.tone("triangle", midi(74 + s), t + i * 0.09, 0.12, 0.005, 0.8, out)); break;
      case "fanfare": [0, 4, 7, 12, 7, 12].forEach((s, i) => this.tone("sawtooth", midi(62 + s), t + i * 0.16, 0.06, 0.02, i === 5 ? 1.2 : 0.25, out)); break;
      case "hammer": this.burst(t, 0.2, 0.04, "bandpass", 1400 * r(), 5, out); this.tone("sine", 320 * r(), t, 0.1, 0.002, 0.06, out); break;
      case "place": this.tone("sine", 110, t, 0.35, 0.004, 0.18, out, 55); this.burst(t, 0.12, 0.12, "lowpass", 700, 1, out); break;
      case "click": this.tone("triangle", 880, t, 0.06, 0.002, 0.05, out); break;
      case "rout": this.burst(t, 0.15, 1.0, "bandpass", 900, 1.5, out, 400); break;
    }
  }

  private startWind() {
    const ctx = this.ctx!;
    const s = this.noiseSrc(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    filter.type = "lowpass"; filter.frequency.value = 380; filter.Q.value = 0.6;
    gain.gain.value = 0.05;
    s.connect(filter).connect(gain).connect(this.ambBus);
    s.start();
    this.wind = { gain, filter };
  }

  /** Ambiente y música; llamar cada fotograma. */
  update(dt: number) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx, t = ctx.currentTime;
    const day = this.hour > 0.25 && this.hour < 0.8;
    // Viento que va y viene
    if (this.wind) {
      const w = 0.035 + 0.03 * (0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.07));
      this.wind.gain.gain.setTargetAtTime(w, t, 0.5);
      this.wind.filter.frequency.setTargetAtTime(300 + 200 * Math.sin(t * 0.09), t, 0.5);
    }
    // Pájaros de día, grillos de noche (más presentes con la cámara cerca)
    this.ambT -= dt;
    if (this.ambT <= 0) {
      const near = Math.min(1, 80 / Math.max(30, this.listener.zoom));
      this.ambT = day ? 0.6 + Math.random() * 2.5 : 0.25 + Math.random() * 0.4;
      const out = ctx.createGain(); out.gain.value = near; out.connect(this.ambBus);
      if (day && this.tension < 0.5) {
        const base = 2800 + Math.random() * 1600, n = 1 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) this.tone("sine", base, t + k * 0.11, 0.025, 0.01, 0.07, out, base * (1.15 + Math.random() * 0.3));
      } else if (!day) {
        for (let k = 0; k < 3; k++) this.tone("sine", 4300, t + k * 0.05, 0.008, 0.005, 0.03, out);
      }
    }
    this.updateMusic(dt);
  }

  private updateMusic(dt: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const battle = this.tension > 0.5;
    const beat = battle ? 0.32 : 0.48;
    this.musicT -= dt;
    if (this.musicT > 0) return;
    this.musicT += beat;
    const s = this.step++;
    const bar = Math.floor(s / 8), pos = s % 8;
    // Bordón: re y la graves cada dos compases
    if (pos === 0 && bar % 2 === 0) {
      for (const n of [38, 45]) this.tone("sine", midi(n), t, 0.05, 1.2, beat * 15, this.musicBus);
    }
    // Frase nueva cada 4 compases: un paseo por la escala
    if (pos === 0 && bar % 4 === 0) {
      let deg = 7 + Math.floor(Math.random() * 3);
      this.phrase = [];
      for (let k = 0; k < 32; k++) {
        deg = Math.max(3, Math.min(13, deg + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        this.phrase.push(Math.random() < (battle ? 0.7 : 0.55) ? deg : -1);
      }
    }
    const deg = this.phrase[(bar % 4) * 8 + pos];
    if (deg !== undefined && deg >= 0) {
      const scale = battle ? [0, 2, 3, 5, 7, 8, 10] : D_DORIAN;
      const note = 50 + Math.floor(deg / 7) * 12 + scale[deg % 7];
      // Laúd: triángulo con ataque seco y filtro que se cierra
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = midi(note);
      f.type = "lowpass"; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.6);
      this.env(g, t, 0.09, 0.004, 0.9);
      o.connect(f).connect(g).connect(this.musicBus);
      o.start(t); o.stop(t + 1);
    }
    // Tambores durante las incursiones
    if (battle && (pos % 2 === 0 || (pos === 7 && Math.random() < 0.5))) {
      this.tone("sine", 72, t, pos === 0 ? 0.35 : 0.2, 0.003, 0.25, this.musicBus, 45);
      this.burst(t, 0.05, 0.06, "lowpass", 500, 1, this.musicBus);
    }
  }
}
