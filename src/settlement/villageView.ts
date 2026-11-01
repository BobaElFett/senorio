import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Village, Building, Rect } from "./village";
import { buildingModel, constructionModel } from "./models";
import { BuildingKind } from "../data/buildings";
import { Terrain } from "../world/terrain";

interface BView {
  root: THREE.Group;
  model: THREE.Group | null;
  site: { group: THREE.Group; walls: THREE.Mesh } | null;
  field: THREE.Mesh | null;
  built: boolean;
}

const JOB_COLOR: Record<string, string> = {
  woodcutter: "#7a5232", farm: "#5f8a3a", market: "#8a4fa0", storehouse: "#9a7a4a", builder: "#d98a2b", idle: "#8c8a84",
  mill: "#c9c2b0", bakery: "#b5643a",
};
const FIELD_COLORS = ["#86a64a", "#a8b84c", "#d2b14c", "#8a6e4a"]; // primavera, verano, otoño, invierno

/**
 * Dibuja la aldea: edificios (con cimientos que salvan la pendiente), obras,
 * campos que cambian con la estación, aldeanos y el fantasma de colocación.
 */
export class VillageView {
  readonly group = new THREE.Group();
  private views = new Map<Building, BView>();
  private villagers: THREE.InstancedMesh;
  private ghost: THREE.Group | null = null;
  private ghostKind: BuildingKind | null = null;
  private ghostField: THREE.LineLoop;
  private ghostMats = { ok: new THREE.MeshBasicMaterial({ color: "#7be08a", transparent: true, opacity: 0.45, depthWrite: false }),
    bad: new THREE.MeshBasicMaterial({ color: "#ff6a5a", transparent: true, opacity: 0.45, depthWrite: false }) };
  private outline: THREE.LineLoop;
  private fieldMat = new THREE.MeshStandardMaterial({ color: FIELD_COLORS[0], flatShading: true, roughness: 1 });
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, private terrain: Terrain) {
    scene.add(this.group);
    const body = new THREE.CylinderGeometry(0.2, 0.26, 1.05, 6).toNonIndexed();
    body.translate(0, 0.525, 0);
    const head = new THREE.IcosahedronGeometry(0.18, 0).toNonIndexed();
    head.translate(0, 1.24, 0);
    const geo = mergeGeometries([body, head])!;
    geo.computeVertexNormals();
    this.villagers = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ flatShading: true }), 400);
    this.villagers.castShadow = true;
    this.villagers.frustumCulled = false;
    this.group.add(this.villagers);
    this.outline = this.makeLoop("#ffe39a");
    this.ghostField = this.makeLoop("#ffffff");
    this.group.add(this.outline, this.ghostField);
  }

  private makeLoop(color: string): THREE.LineLoop {
    const l = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(48 * 3), 3)),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    l.renderOrder = 3; l.frustumCulled = false; l.visible = false;
    return l;
  }

  private writeLoop(line: THREE.LineLoop, r: Rect, pad: number) {
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const c = [[r.minX - pad, r.minZ - pad], [r.maxX + pad, r.minZ - pad], [r.maxX + pad, r.maxZ + pad], [r.minX - pad, r.maxZ + pad]];
    let k = 0;
    for (let e = 0; e < 4; e++) {
      const a = c[e], b = c[(e + 1) % 4];
      for (let j = 0; j < 12; j++) {
        const x = a[0] + (b[0] - a[0]) * j / 12, z = a[1] + (b[1] - a[1]) * j / 12;
        pos.setXYZ(k++, x, Math.max(0, this.terrain.heightAt(x, z)) + 0.3, z);
      }
    }
    pos.needsUpdate = true;
    line.visible = true;
  }

  /** Altura de asiento: la cota más alta de la huella; los cimientos bajan hasta la más baja. */
  private seat(r: Rect): { top: number; low: number } {
    let top = -Infinity, low = Infinity;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
      const h = this.terrain.heightAt(r.minX + (r.maxX - r.minX) * i / 4, r.minZ + (r.maxZ - r.minZ) * j / 4);
      top = Math.max(top, h); low = Math.min(low, h);
    }
    return { top, low };
  }

  private create(b: Building): BView {
    const root = new THREE.Group();
    const { top, low } = this.seat(b.rect);
    root.position.set(b.x, top, b.z);
    root.rotation.y = b.rot * Math.PI / 2;
    root.userData.building = b;
    // Cimientos de piedra
    const fw = b.type.w - 0.6, fd = b.type.d - 0.6, fh = top - low + 0.5;
    const found = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fd), new THREE.MeshStandardMaterial({ color: "#8d897c", flatShading: true }));
    found.position.y = -fh / 2 + 0.12;
    found.receiveShadow = true;
    root.add(found);
    this.group.add(root);
    const v: BView = { root, model: null, site: null, field: null, built: !b.built };
    if (b.fieldRect) {
      v.field = this.makeField(b.fieldRect, b.rot);
      v.field.userData.building = b;
      this.group.add(v.field);
    }
    return v;
  }

  /** Surcos que siguen el relieve, en una sola malla. */
  private makeField(r: Rect, rot: number): THREE.Mesh {
    const parts: THREE.BufferGeometry[] = [];
    const alongX = rot % 2 === 0; // surcos paralelos a la fachada
    const len = alongX ? r.maxX - r.minX : r.maxZ - r.minZ;
    const across = alongX ? r.maxZ - r.minZ : r.maxX - r.minX;
    const rows = Math.floor(across / 1.4);
    const segs = Math.ceil(len / 2);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < segs; j++) {
        const a = (i + 0.5) * (across / rows), s = (j + 0.5) * (len / segs);
        const x = alongX ? r.minX + s : r.minX + a, z = alongX ? r.minZ + a : r.minZ + s;
        const g = new THREE.BoxGeometry(alongX ? len / segs + 0.05 : 0.7, 0.5, alongX ? 0.7 : len / segs + 0.05);
        g.translate(x, Math.max(0.2, this.terrain.heightAt(x, z)) + 0.05, z);
        parts.push(g.toNonIndexed());
      }
    }
    const m = new THREE.Mesh(mergeGeometries(parts)!, this.fieldMat);
    m.receiveShadow = true;
    return m;
  }

  update(v: Village, selected: Building | null, dt: number) {
    // Alta y baja de edificios
    for (const b of v.buildings) if (!this.views.has(b)) this.views.set(b, this.create(b));
    for (const [b, bv] of this.views) {
      if (v.buildings.includes(b)) continue;
      this.group.remove(bv.root);
      if (bv.field) this.group.remove(bv.field);
      this.views.delete(b);
    }
    for (const [b, bv] of this.views) {
      if (b.built !== bv.built) {
        bv.built = b.built;
        if (bv.site) { bv.root.remove(bv.site.group); bv.site = null; }
        if (bv.model) { bv.root.remove(bv.model); bv.model = null; }
        if (b.built) { bv.model = buildingModel(b.type.kind); bv.root.add(bv.model); }
        else { bv.site = constructionModel(b.type.kind); bv.root.add(bv.site.group); }
      }
      if (bv.site) bv.site.walls.scale.y = Math.max(0.01, b.progress);
      // Aspas del molino: giran mientras hay molinero y grano que moler
      if (bv.model && b.type.kind === "mill" && b.workers.length && v.res.food > 10 && !v.underAttack) {
        bv.model.traverse((o) => { if (o.userData.spin) o.rotation.z -= dt * 1.2; });
      }
    }

    // Campos según la estación: brotes en primavera, altos en verano, dorados en otoño, tierra en invierno
    const sf = v.seasonFloat, s = Math.floor(sf), into = sf - s;
    this.c.set(FIELD_COLORS[s]).lerp(new THREE.Color(FIELD_COLORS[(s + 1) % 4]), Math.max(0, into - 0.85) / 0.15);
    this.fieldMat.color.copy(this.c);
    const growth = [0.25 + into * 0.5, 0.75 + into * 0.25, 1 - Math.max(0, into - 0.6) * 2.2, 0.12][s];
    for (const bv of this.views.values()) if (bv.field) {
      bv.field.scale.y = 1;
      bv.field.position.y = (Math.max(0.12, growth) - 1) * 0.3;
    }

    // Aldeanos
    let i = 0;
    for (const f of v.families) {
      const a = f.v;
      if (!a.visible) continue;
      const bob = a.path.length ? Math.abs(Math.sin(a.anim)) * 0.1 : 0;
      const lean = a.working ? Math.max(0, Math.sin(a.anim)) * 0.45 : 0;
      this.e.set(lean, a.heading, 0, "YXZ");
      this.q.setFromEuler(this.e);
      this.m.compose(new THREE.Vector3(a.x, a.y + bob, a.z), this.q, new THREE.Vector3(1, 1, 1));
      this.villagers.setMatrixAt(i, this.m);
      const job = f.work ? f.work.type.kind : f.site ? "builder" : "idle";
      this.villagers.setColorAt(i, this.c.set(JOB_COLOR[job] ?? JOB_COLOR.idle));
      i++;
    }
    this.villagers.count = i;
    this.villagers.instanceMatrix.needsUpdate = true;
    if (this.villagers.instanceColor) this.villagers.instanceColor.needsUpdate = true;

    // Selección
    if (selected && this.views.has(selected)) {
      const r = selected.fieldRect ? {
        minX: Math.min(selected.rect.minX, selected.fieldRect.minX), minZ: Math.min(selected.rect.minZ, selected.fieldRect.minZ),
        maxX: Math.max(selected.rect.maxX, selected.fieldRect.maxX), maxZ: Math.max(selected.rect.maxZ, selected.fieldRect.maxZ),
      } : selected.rect;
      this.writeLoop(this.outline, r, 1);
    } else this.outline.visible = false;
    void dt;
  }

  /** Fantasma de colocación: verde si se puede construir, rojo si no. */
  setGhost(v: Village, kind: BuildingKind | null, x: number, z: number, rot: number, ok: boolean) {
    if (kind !== this.ghostKind) {
      if (this.ghost) this.group.remove(this.ghost);
      this.ghost = null;
      this.ghostKind = kind;
      if (kind) {
        this.ghost = buildingModel(kind);
        this.group.add(this.ghost);
      }
    }
    if (!this.ghost || !kind) { this.ghostField.visible = false; return; }
    const { rect, field } = v.rects(kind, x, z, rot);
    const { top } = this.seat(rect);
    this.ghost.position.set(x, top, z);
    this.ghost.rotation.y = rot * Math.PI / 2;
    const mat = ok ? this.ghostMats.ok : this.ghostMats.bad;
    this.ghost.traverse((o) => { if ((o as THREE.Mesh).isMesh) { (o as THREE.Mesh).material = mat; o.castShadow = false; } });
    (this.ghostField.material as THREE.LineBasicMaterial).color.set(ok ? "#bff5c6" : "#ffb0a6");
    if (field) this.writeLoop(this.ghostField, field, 0); else this.ghostField.visible = false;
  }

  /** Edificio bajo un rayo (para seleccionar con el ratón). */
  pick(ray: THREE.Raycaster): Building | null {
    const targets: THREE.Object3D[] = [];
    for (const bv of this.views.values()) { targets.push(bv.root); if (bv.field) targets.push(bv.field); }
    const hits = ray.intersectObjects(targets, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.building) o = o.parent;
      if (o) return o.userData.building as Building;
    }
    return null;
  }
}
