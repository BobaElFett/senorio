import { Terrain, MAP_SIZE } from "./terrain";

export interface P { x: number; z: number }

/**
 * Cuadrícula de navegación de 2 m sobre el terreno, con búsqueda A* (8 vecinos)
 * y suavizado del camino por línea de visión. El agua profunda y las pendientes
 * muy fuertes bloquean; el bosque y las cuestas cuestan más.
 */
export class NavGrid {
  readonly cell = 2;
  readonly n: number;
  private readonly half = MAP_SIZE / 2;
  readonly blocked: Uint8Array;
  /** Para los bandidos las puertas de la empalizada también están cerradas. */
  readonly blockedEnemy: Uint8Array;
  private readonly baseBlocked: Uint8Array;
  private readonly occupied: Uint8Array;
  private readonly gates: Uint8Array;
  readonly cost: Float32Array;
  private g: Float32Array;
  private came: Int32Array;
  private closed: Uint8Array;

  constructor(terrain: Terrain, trees: P[]) {
    this.n = Math.round(MAP_SIZE / this.cell);
    const n = this.n, size = n * n;
    this.blocked = new Uint8Array(size);
    this.cost = new Float32Array(size);
    this.g = new Float32Array(size);
    this.came = new Int32Array(size);
    this.closed = new Uint8Array(size);

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = this.cx(ix), z = this.cx(iz);
        const h = terrain.heightAt(x, z);
        const hx = terrain.heightAt(x + this.cell, z), hz = terrain.heightAt(x, z + this.cell);
        const slope = Math.max(Math.abs(hx - h), Math.abs(hz - h));
        const i = iz * n + ix;
        const edge = ix < 2 || iz < 2 || ix >= n - 2 || iz >= n - 2;
        this.blocked[i] = h < -0.4 || slope > 2.4 || edge ? 1 : 0;
        this.cost[i] = 1 + slope * 0.5;
      }
    }
    this.baseBlocked = this.blocked.slice();
    this.blockedEnemy = this.blocked.slice();
    this.occupied = new Uint8Array(size);
    this.gates = new Uint8Array(size);
    for (const t of trees) {
      const i = this.index(t.x, t.z);
      if (i >= 0) this.cost[i] = Math.min(this.cost[i] + 0.8, 4);
    }
  }

  private cx(i: number) { return -this.half + (i + 0.5) * this.cell; }

  index(x: number, z: number): number {
    const ix = Math.floor((x + this.half) / this.cell), iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  /** Marca (o libera) un rectángulo ocupado por un edificio. */
  setOccupied(minX: number, minZ: number, maxX: number, maxZ: number, on: boolean) {
    const n = this.n;
    const ix0 = Math.max(0, Math.floor((minX + this.half) / this.cell)), ix1 = Math.min(n - 1, Math.floor((maxX + this.half) / this.cell));
    const iz0 = Math.max(0, Math.floor((minZ + this.half) / this.cell)), iz1 = Math.min(n - 1, Math.floor((maxZ + this.half) / this.cell));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * n + ix;
      this.occupied[i] = Math.max(0, this.occupied[i] + (on ? 1 : -1));
      this.refresh(i);
    }
  }

  private refresh(i: number) {
    this.blocked[i] = this.baseBlocked[i] || this.occupied[i] > 0 ? 1 : 0;
    this.blockedEnemy[i] = this.blocked[i] || this.gates[i] > 0 ? 1 : 0;
  }

  /** Celdas que cubre un tramo de muro (con grosor, para que no haya rendijas en diagonal). */
  wallCells(ax: number, az: number, bx: number, bz: number): number[] {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const out = new Set<number>();
    for (let t = 0; t <= len; t += 0.4) {
      const x = ax + (bx - ax) * (t / len), z = az + (bz - az) * (t / len);
      for (const o of [-0.7, 0, 0.7]) {
        const i = this.index(x + nx * o, z + nz * o);
        if (i >= 0) out.add(i);
      }
    }
    return [...out];
  }

  /** Muro (bloquea a todos) o puerta (solo a los bandidos). */
  setWall(cells: number[], on: boolean, gate: boolean) {
    for (const i of cells) {
      if (gate) this.gates[i] = Math.max(0, this.gates[i] + (on ? 1 : -1));
      else this.occupied[i] = Math.max(0, this.occupied[i] + (on ? 1 : -1));
      this.refresh(i);
    }
  }

  blockedAt(x: number, z: number, enemy = false): boolean {
    const i = this.index(x, z);
    return i < 0 || (enemy ? this.blockedEnemy : this.blocked)[i] === 1;
  }

  /** Punto transitable más cercano (búsqueda en espiral). */
  nearestOpen(x: number, z: number, enemy = false): P {
    if (!this.blockedAt(x, z, enemy)) return { x, z };
    for (let r = 1; r < 40; r++) {
      let best: P | null = null, bd = Infinity;
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const px = x + Math.cos(ang) * r * this.cell, pz = z + Math.sin(ang) * r * this.cell;
        if (!this.blockedAt(px, pz, enemy)) {
          const d = Math.hypot(px - x, pz - z);
          if (d < bd) { bd = d; best = { x: px, z: pz }; }
        }
      }
      if (best) return best;
    }
    return { x, z };
  }

  /** ¿Se puede ir en línea recta de a a b sin pisar celdas bloqueadas? */
  lineOfSight(ax: number, az: number, bx: number, bz: number, enemy = false): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (this.blockedAt(ax + (bx - ax) * t, az + (bz - az) * t, enemy)) return false;
    }
    return true;
  }

  /** Camino de (sx,sz) a (tx,tz) como lista de puntos, sin incluir el inicio. */
  findPath(sx: number, sz: number, tx: number, tz: number, enemy = false): P[] | null {
    const goal = this.nearestOpen(tx, tz, enemy);
    if (this.lineOfSight(sx, sz, goal.x, goal.z, enemy)) return [goal];
    const start = this.nearestOpen(sx, sz, enemy);
    const B = enemy ? this.blockedEnemy : this.blocked;
    const s = this.index(start.x, start.z), t = this.index(goal.x, goal.z);
    if (s < 0 || t < 0) return null;

    const n = this.n;
    this.g.fill(Infinity);
    this.closed.fill(0);
    this.came.fill(-1);
    const heap = new MinHeap();
    const tix = t % n, tiz = (t / n) | 0;
    const h = (i: number) => {
      const dx = Math.abs((i % n) - tix), dz = Math.abs(((i / n) | 0) - tiz);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz));
    };
    this.g[s] = 0;
    heap.push(s, h(s));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === t) break;
      if (this.closed[cur]) continue;
      this.closed[cur] = 1;
      if (++expanded > 60000) return null;
      const ix = cur % n, iz = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const ni = nz * n + nx;
          if (B[ni] || this.closed[ni]) continue;
          // Sin cortar esquinas en diagonal
          if (dx && dz && (B[iz * n + nx] || B[nz * n + ix])) continue;
          const step = (dx && dz ? Math.SQRT2 : 1) * (this.cost[ni] + this.cost[cur]) * 0.5;
          const ng = this.g[cur] + step;
          if (ng < this.g[ni]) {
            this.g[ni] = ng;
            this.came[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
    }
    if (this.came[t] === -1 && s !== t) return null;

    const cells: P[] = [];
    for (let c = t; c !== -1 && c !== s; c = this.came[c]) cells.push({ x: this.cx(c % n), z: this.cx((c / n) | 0) });
    cells.reverse();
    cells[cells.length - 1] = goal;

    // Suavizado: saltar a la vista más lejana
    const out: P[] = [];
    let ax = sx, az = sz, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineOfSight(ax, az, cells[j].x, cells[j].z, enemy)) j--;
      out.push(cells[j]);
      ax = cells[j].x; az = cells[j].z;
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p]; keys[i] = keys[p];
      i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    if (ids.length) {
      let i = 0;
      const n = ids.length;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mk = lastKey;
        if (l < n && keys[l] < mk) { m = l; mk = keys[l]; }
        if (r < n && keys[r] < mk) { m = r; mk = keys[r]; }
        if (m === i) break;
        ids[i] = ids[m]; keys[i] = keys[m];
        i = m;
      }
      ids[i] = lastId; keys[i] = lastKey;
    }
    return top;
  }
}
