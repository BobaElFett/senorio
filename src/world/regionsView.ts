import * as THREE from "three";
import { Regions, Owner } from "./regions";
import { Terrain } from "./terrain";

const OWNER_COLOR: Record<string, string> = { player: "#3f6fd0", rival: "#c0392b", none: "#e8e2c8" };
const colorOf = (o: Owner) => OWNER_COLOR[o ?? "none"];

/**
 * Las tierras en el mundo: lindes sobre el terreno y un estandarte en el centro de cada una,
 * del color de su dueño.
 */
export class RegionsView {
  readonly group = new THREE.Group();
  private lines: THREE.LineSegments;
  private segs: { a: number; b: number }[] = [];
  private flags: THREE.MeshStandardMaterial[] = [];
  private version = -1;

  constructor(private regions: Regions, terrain: Terrain) {
    const borders = regions.borders();
    const pos = new Float32Array(borders.length * 6);
    borders.forEach((s, i) => {
      const ya = Math.max(0, terrain.heightAt(s.ax, s.az)) + 0.35, yb = Math.max(0, terrain.heightAt(s.bx, s.bz)) + 0.35;
      pos.set([s.ax, ya, s.az, s.bx, yb, s.bz], i * 6);
      this.segs.push({ a: s.a, b: s.b });
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(borders.length * 6), 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 }));
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    // Estandartes
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.14, 9, 6); poleGeo.translate(0, 4.5, 0);
    const flagGeo = new THREE.BoxGeometry(3.2, 2, 0.06); flagGeo.translate(1.7, 7.6, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: "#5a4330", flatShading: true });
    for (const r of regions.list) {
      const g = new THREE.Group();
      const y = Math.max(0, terrain.heightAt(r.center.x, r.center.z));
      g.position.set(r.center.x, y, r.center.z);
      const mat = new THREE.MeshStandardMaterial({ color: colorOf(r.owner), flatShading: true });
      this.flags.push(mat);
      const pole = new THREE.Mesh(poleGeo, poleMat), flag = new THREE.Mesh(flagGeo, mat);
      pole.castShadow = flag.castShadow = true;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 0.6, 7), new THREE.MeshStandardMaterial({ color: "#8d897c", flatShading: true }));
      base.position.y = 0.2;
      g.add(base, pole, flag);
      g.rotation.y = r.id * 1.3;
      this.group.add(g);
    }
    this.refresh();
  }

  refresh() {
    if (this.version === this.regions.version) return;
    this.version = this.regions.version;
    const col = this.lines.geometry.attributes.color as THREE.BufferAttribute;
    const c = new THREE.Color();
    this.segs.forEach((s, i) => {
      const A = this.regions.list[s.a].owner, B = this.regions.list[s.b].owner;
      // La linde se pinta del dueño más «importante» de los dos lados
      c.set(A === "player" || B === "player" ? (A === "rival" || B === "rival" ? "#e0a030" : OWNER_COLOR.player) : A === "rival" || B === "rival" ? OWNER_COLOR.rival : OWNER_COLOR.none);
      col.setXYZ(i * 2, c.r, c.g, c.b); col.setXYZ(i * 2 + 1, c.r, c.g, c.b);
    });
    col.needsUpdate = true;
    this.regions.list.forEach((r, i) => this.flags[i].color.set(colorOf(r.owner)));
  }
}
