// Ruido de valor 2D con semilla, sin dependencias. Suficiente para terreno low-poly.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ValueNoise {
  private perm: Uint8Array;
  private vals: Float32Array;

  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    this.vals = new Float32Array(256);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
      this.vals[i] = rnd() * 2 - 1;
    }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private lattice(ix: number, iz: number): number {
    return this.vals[this.perm[(this.perm[ix & 255] + iz) & 511]];
  }

  /** Ruido suave en [-1, 1]. */
  noise(x: number, z: number): number {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = this.lattice(ix, iz), b = this.lattice(ix + 1, iz);
    const c = this.lattice(ix, iz + 1), d = this.lattice(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }

  /** Ruido fractal (varias octavas), aproximadamente en [-1, 1]. */
  fbm(x: number, z: number, octaves = 4): number {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
