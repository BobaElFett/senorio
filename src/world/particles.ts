import * as THREE from "three";

// Partículas sencillas: humo de chimeneas y de incendios, llamas.
// Una malla instanciada por tipo; cada partícula sube, crece y se desvanece encogiéndose.

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; grow: number }

class Pool {
  readonly mesh: THREE.InstancedMesh;
  private list: Particle[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, private max: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  emit(p: Particle) { if (this.list.length < this.max) this.list.push(p); }

  update(dt: number, wind: { x: number; z: number }) {
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.x += (p.vx + wind.x) * dt; p.y += p.vy * dt; p.z += (p.vz + wind.z) * dt;
      p.vy *= 1 - 0.3 * dt;
    }
    for (const p of this.list) {
      const t = p.age / p.life;
      const s = p.size * (1 + p.grow * t) * (t > 0.7 ? (1 - t) / 0.3 : Math.min(1, t * 6));
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q, new THREE.Vector3(s, s, s));
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  private smoke: Pool;
  private dark: Pool;
  private fire: Pool;
  private wind = { x: 0.6, z: 0.25 };

  constructor() {
    const puff = new THREE.IcosahedronGeometry(0.5, 0);
    this.smoke = new Pool(puff, new THREE.MeshStandardMaterial({ color: "#b8b4ac", transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }), 600);
    this.dark = new Pool(puff, new THREE.MeshStandardMaterial({ color: "#3d3a36", transparent: true, opacity: 0.6, depthWrite: false, flatShading: true }), 500);
    const flame = new THREE.ConeGeometry(0.35, 1, 5);
    this.fire = new Pool(flame, new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85, depthWrite: false }), 300);
    this.group.add(this.smoke.mesh, this.dark.mesh, this.fire.mesh);
  }

  /** Bocanada de humo de chimenea. */
  chimney(x: number, y: number, z: number) {
    this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.2, vy: 0.9 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.2, age: 0, life: 5 + Math.random() * 2, size: 0.5, grow: 2.8 });
  }

  /** Incendio en un punto (llamas y humo negro). */
  blaze(x: number, y: number, z: number, spread: number) {
    const ox = (Math.random() - 0.5) * spread, oz = (Math.random() - 0.5) * spread;
    this.fire.emit({ x: x + ox, y: y + Math.random(), z: z + oz, vx: 0, vy: 2 + Math.random() * 1.5, vz: 0, age: 0, life: 0.6 + Math.random() * 0.4, size: 0.8 + Math.random() * 0.6, grow: 0.3 });
    if (Math.random() < 0.5) this.dark.emit({ x: x + ox, y: y + 1.5, z: z + oz, vx: 0, vy: 2.2, vz: 0, age: 0, life: 5, size: 0.8, grow: 3 });
  }

  update(dt: number) {
    for (const p of [this.smoke, this.dark, this.fire]) p.update(dt, this.wind);
  }
}
