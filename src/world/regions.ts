import { MAP_SIZE } from "./terrain";
import { ValueNoise } from "./noise";
import { P } from "./navgrid";

export type Owner = "player" | "rival" | null;

export interface Region {
  id: number;
  name: string;
  center: P;                 // donde está su estandarte
  owner: Owner;
  fertility: number;         // multiplica lo que dan las granjas
  woods: number;             // multiplica lo que dan los leñadores
  note: string;              // rasgo que se enseña en el mapa
  capital?: boolean;         // sede del señor rival
  neighbors: number[];
  area: number;              // celdas
}

interface Seed { name: string; x: number; z: number; owner: Owner; fertility: number; woods: number; note: string; capital?: boolean }

// −x es el oeste, −z el norte. El río baja de norte a sur hacia x ≈ 95.
const SEEDS: Seed[] = [
  { name: "La Explanada", x: 0, z: 0, owner: "player", fertility: 1, woods: 1, note: "Tu aldea" },
  { name: "Bosque Negro", x: -60, z: -205, owner: null, fertility: 0.8, woods: 1.35, note: "Bosque espeso: los leñadores rinden +35%" },
  { name: "Colinas de Poniente", x: -235, z: -20, owner: null, fertility: 0.9, woods: 1, note: "Por aquí entran los bandidos" },
  { name: "Prados del Sur", x: -70, z: 215, owner: null, fertility: 1.25, woods: 0.9, note: "Buena tierra: granjas +25%" },
  { name: "Vega del Río", x: 105, z: 60, owner: null, fertility: 1.4, woods: 0.9, note: "La tierra más fértil: granjas +40%" },
  { name: "Vado del Norte", x: 150, z: -215, owner: null, fertility: 1, woods: 1.15, note: "Paso del río al norte" },
  { name: "Hondonada", x: -250, z: -255, owner: null, fertility: 0.9, woods: 1.2, note: "Valle boscoso: leñadores +20%" },
  { name: "Sierra Alta", x: -250, z: 250, owner: null, fertility: 0.8, woods: 1.1, note: "Tierra pobre y alta" },
  { name: "Castro de Montfort", x: 265, z: -30, owner: "rival", fertility: 1.1, woods: 1, note: "Sede del señor de Montfort", capital: true },
  { name: "Llanos de Levante", x: 245, z: 235, owner: "rival", fertility: 1.2, woods: 1, note: "Tierras de Montfort: granjas +20%" },
];

export const CLAIM_BASE = 25;       // monedas por reclamar la primera tierra libre
export const CLAIM_STEP = 15;       // y cada una más
export const TRIBUTE = 0.4;         // monedas al día por cada tierra además de la tuya

/**
 * Tierras del mapa (regiones de Voronoi con bordes irregulares). Solo se construye en las propias.
 * Las libres se reclaman pagando; las del señor rival se toman ocupando su estandarte.
 */
export class Regions {
  readonly cell = 6;
  readonly n = Math.round(MAP_SIZE / 6);
  readonly half = MAP_SIZE / 2;
  readonly grid: Int8Array;
  readonly list: Region[];
  version = 0;

  constructor(seed = 31) {
    const warp = new ValueNoise(seed);
    this.grid = new Int8Array(this.n * this.n);
    this.list = SEEDS.map((s, id) => ({
      id, name: s.name, center: { x: s.x, z: s.z }, owner: s.owner, fertility: s.fertility, woods: s.woods,
      note: s.note, capital: s.capital, neighbors: [], area: 0,
    }));
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      let x = -this.half + (i + 0.5) * this.cell, z = -this.half + (j + 0.5) * this.cell;
      // Bordes ondulados: se deforma el punto antes de buscar la semilla más cercana
      x += warp.fbm(x * 0.008, z * 0.008, 2) * 45;
      z += warp.fbm(x * 0.008 + 7.3, z * 0.008 - 2.1, 2) * 45;
      let best = 0, bd = Infinity;
      for (const r of this.list) {
        const d = (r.center.x - x) ** 2 + (r.center.z - z) ** 2;
        if (d < bd) { bd = d; best = r.id; }
      }
      this.grid[j * this.n + i] = best;
      this.list[best].area++;
    }
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const a = this.grid[j * this.n + i];
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= this.n || j + dj >= this.n) continue;
        const b = this.grid[(j + dj) * this.n + i + di];
        if (a !== b && !this.list[a].neighbors.includes(b)) { this.list[a].neighbors.push(b); this.list[b].neighbors.push(a); }
      }
    }
  }

  idAt(x: number, z: number): number {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
    return this.grid[j * this.n + i];
  }
  at(x: number, z: number): Region { return this.list[this.idAt(x, z)]; }
  ownedBy(x: number, z: number, o: Owner) { return this.at(x, z).owner === o; }
  get home() { return this.list[0]; }
  get capital() { return this.list.find((r) => r.capital)!; }
  count(o: Owner) { return this.list.filter((r) => r.owner === o).length; }

  /** Tramos de borde entre tierras distintas (en coordenadas del mundo), para dibujarlos. */
  borders(): { ax: number; az: number; bx: number; bz: number; a: number; b: number }[] {
    const out: { ax: number; az: number; bx: number; bz: number; a: number; b: number }[] = [];
    const c = this.cell, h = this.half;
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const a = this.grid[j * this.n + i];
      if (i + 1 < this.n) {
        const b = this.grid[j * this.n + i + 1];
        if (a !== b) { const x = -h + (i + 1) * c; out.push({ ax: x, az: -h + j * c, bx: x, bz: -h + (j + 1) * c, a, b }); }
      }
      if (j + 1 < this.n) {
        const b = this.grid[(j + 1) * this.n + i];
        if (a !== b) { const z = -h + (j + 1) * c; out.push({ ax: -h + i * c, az: z, bx: -h + (i + 1) * c, bz: z, a, b }); }
      }
    }
    return out;
  }

  claimCost() { return CLAIM_BASE + CLAIM_STEP * Math.max(0, this.count("player") - 1); }
}
