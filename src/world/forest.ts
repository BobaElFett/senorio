import * as THREE from "three";
import { Terrain, MAP_SIZE, WATER_LEVEL } from "./terrain";
import { ValueNoise, mulberry32 } from "./noise";

export interface Tree { x: number; z: number; y: number; s: number; r: number; alive: boolean }

/**
 * Bosques en manchas, dibujados con InstancedMesh (miles de árboles en 2 draw calls).
 * Los árboles se pueden talar (leñadores) o despejar (al construir encima).
 */
export class Forest {
  readonly group = new THREE.Group();
  readonly trees: Tree[] = [];
  private trunks: THREE.InstancedMesh;
  private crowns: THREE.InstancedMesh;
  private crownMat: THREE.MeshStandardMaterial;
  private grid = new Map<number, Tree[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(terrain: Terrain, seed = 11) {
    const rnd = mulberry32(seed);
    const patches = new ValueNoise(seed + 5);
    const half = MAP_SIZE / 2 - 6;
    for (let tries = 0; tries < 100000 && this.trees.length < 8000; tries++) {
      const x = (rnd() * 2 - 1) * half;
      const z = (rnd() * 2 - 1) * half;
      if (patches.fbm(x * 0.012, z * 0.012, 3) < 0.12) continue;     // fuera de una mancha de bosque
      if (terrain.isVillageArea(x, z, 25) || terrain.isRivalSeat(x, z, 18)) continue;
      if (terrain.riverDistance(x, z) < 22) continue;
      const y = terrain.heightAt(x, z);
      if (y < WATER_LEVEL + 1) continue;
      const slope = Math.abs(terrain.heightAt(x + 1, z) - y) + Math.abs(terrain.heightAt(x, z + 1) - y);
      if (slope > 1.3) continue;
      const t: Tree = { x, z, y, s: 0.8 + rnd() * 0.7, r: rnd() * Math.PI * 2, alive: true };
      this.trees.push(t);
      const k = this.key(x, z);
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, (b = []));
      b.push(t);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.6, 5);
    trunkGeo.translate(0, 0.8, 0);
    const crownGeo = new THREE.ConeGeometry(1.4, 3.6, 6);
    crownGeo.translate(0, 3.2, 0);
    this.crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", flatShading: true });
    this.trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: "#6a4a2f", flatShading: true }), this.trees.length);
    this.crowns = new THREE.InstancedMesh(crownGeo, this.crownMat, this.trees.length);
    const tint = new THREE.Color(), dark = new THREE.Color("#2f5a2c"), light = new THREE.Color("#4d7d35");
    this.trees.forEach((t, i) => {
      this.writeTree(i);
      this.crowns.setColorAt(i, tint.copy(dark).lerp(light, rnd()));
    });
    for (const mesh of [this.trunks, this.crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    this.group.name = "forest";
    this.group.add(this.trunks, this.crowns);
  }

  private key(x: number, z: number) { return (Math.floor(x / 10) + 100) * 1000 + Math.floor(z / 10) + 100; }

  private writeTree(i: number) {
    const t = this.trees[i];
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r);
    const s = t.alive ? t.s : 0;
    this.m.compose(new THREE.Vector3(t.x, t.y - 0.1, t.z), this.q, new THREE.Vector3(s, s, s));
    this.trunks.setMatrixAt(i, this.m);
    this.crowns.setMatrixAt(i, this.m);
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
  }

  /** Árboles vivos en un radio. */
  within(x: number, z: number, radius: number): Tree[] {
    const out: Tree[] = [];
    const r = Math.ceil(radius / 10), cx = Math.floor(x / 10), cz = Math.floor(z / 10);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const b = this.grid.get((cx + dx + 100) * 1000 + cz + dz + 100);
      if (!b) continue;
      for (const t of b) if (t.alive && Math.hypot(t.x - x, t.z - z) <= radius) out.push(t);
    }
    return out;
  }

  fell(t: Tree) {
    if (!t.alive) return;
    t.alive = false;
    this.writeTree(this.trees.indexOf(t));
  }

  /** Despeja los árboles dentro de un rectángulo alineado con los ejes. */
  clearRect(minX: number, minZ: number, maxX: number, maxZ: number): number {
    let n = 0;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    for (const t of this.within(cx, cz, Math.hypot(maxX - minX, maxZ - minZ) / 2 + 2)) {
      if (t.x > minX - 1 && t.x < maxX + 1 && t.z > minZ - 1 && t.z < maxZ + 1) { this.fell(t); n++; }
    }
    return n;
  }

  /** Tinte estacional de las copas (blanco = sin cambio). */
  setTint(c: THREE.Color) { this.crownMat.color.copy(c); }
}
