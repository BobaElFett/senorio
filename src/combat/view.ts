import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Battle, Regiment, Soldier } from "./battle";
import { Terrain } from "../world/terrain";
import { P } from "../world/navgrid";

const TEAM_COLORS: Record<string, string> = {
  "0-spear": "#3d63b8", "0-archer": "#5f93d4", "0-militia": "#46559a",
  "1-spear": "#b23a2e", "1-archer": "#d1724c", "1-militia": "#8c3a2a",
  "0-cavalry": "#2b4c9a", "1-cavalry": "#9a2c24",
};
const HORSE_COATS = ["#6b4a2e", "#4a3424", "#8a6a4a", "#2f2a26", "#a89c8c"];
const RIDER_LIFT = 1.0;
const FLAG_COLORS = ["#2f58b0", "#a8302a"];
// Colores ya convertidos: parsear «#rrggbb» por soldado y fotograma salía caro
const TEAM_COLOR = new Map(Object.entries(TEAM_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
const ROUT_GREY = new THREE.Color("#c9c3b5");
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const CORPSE = new THREE.Color("#4a3d30");

interface Banner { group: THREE.Group; flag: THREE.Mesh; mat: THREE.MeshBasicMaterial; pole: THREE.Mesh }

/**
 * Dibuja la batalla: soldados (InstancedMesh, vivos y caídos), lanzas, flechas,
 * estandartes por regimiento, contorno de los seleccionados y marcas de órdenes.
 */
export class BattleView {
  private group = new THREE.Group();
  private bodies!: THREE.InstancedMesh;
  private heads = new Map<string, THREE.InstancedMesh>();
  private headIndex = new Map<Soldier, [THREE.InstancedMesh, number]>();
  private bows!: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh[] = [];
  private legM = new THREE.Matrix4();
  private hip = new THREE.Matrix4();
  private bowIndex = new Map<Soldier, number>();
  private spears!: THREE.InstancedMesh;
  private horses!: THREE.InstancedMesh;
  private horseIndex = new Map<Soldier, number>();
  private lift = new THREE.Matrix4();
  private spearIndex = new Map<Soldier, number>();
  private arrows: THREE.InstancedMesh;
  private markers: THREE.InstancedMesh;
  private banners = new Map<Regiment, Banner>();
  private outlines = new Map<Regiment, THREE.LineLoop>();
  private version = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(private scene: THREE.Scene, private terrain: Terrain) {
    scene.add(this.group);
    const arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.95);
    this.arrows = new THREE.InstancedMesh(arrowGeo, new THREE.MeshBasicMaterial({ color: "#3b2f22" }), 2000);
    this.arrows.frustumCulled = false;
    const markGeo = new THREE.CircleGeometry(0.32, 10);
    markGeo.rotateX(-Math.PI / 2);
    this.markers = new THREE.InstancedMesh(markGeo, new THREE.MeshBasicMaterial({
      color: "#ffffff", transparent: true, opacity: 0.75, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4,
    }), 3000);
    this.markers.frustumCulled = false;
    this.markers.renderOrder = 2;
    scene.add(this.arrows, this.markers);
  }

  private rebuild(b: Battle) {
    this.version = b.version;
    this.group.clear();
    this.banners.clear();
    this.outlines.clear();
    this.spearIndex.clear();

    // Torso (las piernas van aparte para poder moverlas al andar)
    const body = new THREE.CylinderGeometry(0.22, 0.27, 0.66, 6);
    body.translate(0, 0.86, 0);
    const shield = new THREE.BoxGeometry(0.5, 0.65, 0.07);
    shield.translate(-0.12, 0.75, 0.3);
    const soldierGeo = mergeGeometries([body.toNonIndexed(), shield.toNonIndexed()])!;
    soldierGeo.computeVertexNormals();
    this.bodies = new THREE.InstancedMesh(soldierGeo, new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 }), b.soldiers.length);
    this.bodies.castShadow = true;
    this.bodies.frustumCulled = false;

    const spearGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.9, 4);
    spearGeo.translate(0.3, 1.45, 0.15);
    const spearHolders = b.soldiers.filter((s) => s.reg.type.kind !== "archer");
    spearHolders.forEach((s, i) => this.spearIndex.set(s, i));
    this.spears = new THREE.InstancedMesh(spearGeo, new THREE.MeshStandardMaterial({ color: "#7a6044", flatShading: true }), Math.max(1, spearHolders.length));
    this.spears.frustumCulled = false;
    this.group.add(this.bodies, this.spears);

    const legGeo = new THREE.BoxGeometry(0.15, 0.58, 0.17);
    legGeo.translate(0, -0.29, 0);
    const legMat = new THREE.MeshStandardMaterial({ color: "#3a3128", flatShading: true });
    this.legs = [0, 1].map(() => {
      const m = new THREE.InstancedMesh(legGeo, legMat, b.soldiers.length);
      m.castShadow = true; m.frustumCulled = false;
      this.group.add(m);
      return m;
    });

    // Cabezas con su tocado según el tipo: yelmo (lanceros), capucha (arqueros), gorro (milicia)
    const paint = (g: THREE.BufferGeometry, hex: string) => {
      const n = g.toNonIndexed(), c = new THREE.Color(hex), arr = new Float32Array(n.attributes.position.count * 3);
      for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
      n.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      return n;
    };
    const skull = new THREE.IcosahedronGeometry(0.19, 0); skull.translate(0, 1.36, 0);
    const helm = new THREE.SphereGeometry(0.22, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); helm.translate(0, 1.4, 0);
    const nasal = new THREE.BoxGeometry(0.04, 0.16, 0.05); nasal.translate(0, 1.34, 0.2);
    const hood = new THREE.ConeGeometry(0.25, 0.42, 6); hood.translate(0, 1.5, -0.04);
    const cap = new THREE.CylinderGeometry(0.2, 0.21, 0.1, 7); cap.translate(0, 1.5, 0);
    const kinds: Record<string, THREE.BufferGeometry> = {
      spear: mergeGeometries([paint(skull, "#d6aa84"), paint(helm, "#8f979e"), paint(nasal, "#8f979e")])!,
      archer: mergeGeometries([paint(skull, "#d6aa84"), paint(hood, "#5d5a36")])!,
      militia: mergeGeometries([paint(skull, "#d6aa84"), paint(cap, "#6e3a28")])!,
      cavalry: mergeGeometries([paint(skull, "#d6aa84"), paint(helm.clone(), "#b8bec4"), paint(nasal.clone(), "#b8bec4"),
        paint(new THREE.ConeGeometry(0.07, 0.3, 4).translate(0, 1.72, -0.02), "#c9a23a")])!,
    };
    this.heads.clear(); this.headIndex.clear(); this.bowIndex.clear();
    const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7 });
    for (const [kind, geo] of Object.entries(kinds)) {
      geo.computeVertexNormals();
      const list = b.soldiers.filter((s) => s.reg.type.kind === kind);
      const mesh = new THREE.InstancedMesh(geo, headMat, Math.max(1, list.length));
      mesh.castShadow = true; mesh.frustumCulled = false;
      if (!list.length) mesh.count = 0;
      list.forEach((s, i) => this.headIndex.set(s, [mesh, i]));
      this.heads.set(kind, mesh);
      this.group.add(mesh);
    }
    const bowGeo = new THREE.TorusGeometry(0.55, 0.03, 4, 10, Math.PI);
    bowGeo.rotateZ(-Math.PI / 2);
    bowGeo.translate(-0.42, 0.95, 0.12);
    const archers = b.soldiers.filter((s) => s.reg.type.kind === "archer");
    archers.forEach((s, i) => this.bowIndex.set(s, i));
    this.bows = new THREE.InstancedMesh(bowGeo, new THREE.MeshStandardMaterial({ color: "#5a3d22", flatShading: true }), Math.max(1, archers.length));
    this.bows.frustumCulled = false;
    if (!archers.length) this.bows.count = 0;
    this.group.add(this.bows);

    // Caballos de los jinetes
    const coat = (g: THREE.BufferGeometry) => paint(g, "#ffffff");
    const hb = new THREE.BoxGeometry(0.62, 0.62, 1.7); hb.translate(0, 1.2, 0);
    const neck = new THREE.BoxGeometry(0.3, 0.8, 0.35); neck.rotateX(0.55); neck.translate(0, 1.62, 0.85);
    const hd = new THREE.BoxGeometry(0.26, 0.28, 0.6); hd.rotateX(0.35); hd.translate(0, 1.95, 1.15);
    const tail = new THREE.BoxGeometry(0.1, 0.6, 0.12); tail.rotateX(-0.4); tail.translate(0, 1.15, -0.95);
    const legParts = [[-0.2, 0.62], [0.2, 0.62], [-0.2, -0.62], [0.2, -0.62]].map(([x, z]) => {
      const l = new THREE.BoxGeometry(0.15, 0.95, 0.17); l.translate(x, 0.47, z); return coat(l);
    });
    const saddle = paint(new THREE.BoxGeometry(0.68, 0.12, 0.6).translate(0, 1.55, -0.05), "#5a3a22");
    const horseGeo = mergeGeometries([coat(hb), coat(neck), coat(hd), paint(tail, "#2a2018"), ...legParts, saddle])!;
    horseGeo.computeVertexNormals();
    const riders = b.soldiers.filter((s) => s.reg.type.mounted);
    this.horseIndex.clear();
    riders.forEach((s, i) => this.horseIndex.set(s, i));
    this.horses = new THREE.InstancedMesh(horseGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }), Math.max(1, riders.length));
    this.horses.castShadow = true; this.horses.frustumCulled = false;
    if (!riders.length) this.horses.count = 0;
    riders.forEach((s, i) => this.horses.setColorAt(i, this.c.set(HORSE_COATS[s.id % HORSE_COATS.length])));
    if (this.horses.instanceColor) this.horses.instanceColor.needsUpdate = true;
    this.group.add(this.horses);

    for (const r of b.regiments) {
      this.banners.set(r, this.makeBanner(r));
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(32 * 3), 3)),
        new THREE.LineBasicMaterial({ color: r.team === 0 ? "#ffe39a" : "#ff8a7a", depthTest: false, transparent: true }),
      );
      line.renderOrder = 3;
      line.frustumCulled = false;
      this.outlines.set(r, line);
      this.group.add(line);
    }
  }

  private makeBanner(r: Regiment): Banner {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 5), new THREE.MeshStandardMaterial({ color: "#4a3a28" }));
    pole.position.y = 3.5;
    const canvas = document.createElement("canvas");
    canvas.width = 128; canvas.height = 80;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = FLAG_COLORS[r.team];
    ctx.fillRect(0, 0, 128, 80);
    ctx.strokeStyle = "#f4ead2"; ctx.fillStyle = "#f4ead2"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath();
    if (r.type.kind === "spear") {                       // lanza
      ctx.moveTo(64, 70); ctx.lineTo(64, 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(64, 8); ctx.lineTo(52, 28); ctx.lineTo(76, 28); ctx.closePath(); ctx.fill();
    } else if (r.type.kind === "archer") {               // arco
      ctx.arc(52, 40, 28, -1.2, 1.2); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(62, 14); ctx.lineTo(62, 66); ctx.stroke();
      ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(36, 40); ctx.lineTo(96, 40); ctx.stroke();
    } else if (r.type.kind === "cavalry") {             // herradura
      ctx.lineWidth = 9; ctx.arc(64, 34, 22, Math.PI * 0.85, Math.PI * 2.15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(43, 41); ctx.lineTo(41, 66); ctx.moveTo(85, 41); ctx.lineTo(87, 66); ctx.stroke();
    } else {                                             // hachas cruzadas
      ctx.moveTo(40, 14); ctx.lineTo(88, 66); ctx.moveTo(88, 14); ctx.lineTo(40, 66); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: "#d6d6d6" });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), mat);
    flag.position.set(1.25, 6.1, 0);
    const holder = new THREE.Group();
    holder.add(pole, flag);
    g.add(holder);
    this.group.add(g);
    return { group: g, flag, mat, pole };
  }

  setVisible(on: boolean) {
    this.group.visible = on;
    this.arrows.visible = on;
    this.markers.visible = on;
  }

  /** Punto del estandarte (para elegir regimientos con el ratón). */
  bannerPoint(r: Regiment, out: THREE.Vector3): THREE.Vector3 {
    const b = this.banners.get(r);
    if (!b) return out.set(r.cx, 0, r.cz);
    return out.set(b.group.position.x, b.group.position.y + 5.5 * b.group.scale.y, b.group.position.z);
  }

  update(b: Battle, camera: THREE.Camera, selected: Set<Regiment>, previews: P[], showDest: boolean) {
    if (b.version !== this.version) this.rebuild(b);
    const t = b.time;

    // Soldados
    b.soldiers.forEach((s, i) => {
      const k = s.reg.type.kind;
      if (s.fled) {
        this.m.makeScale(0, 0, 0);
      } else if (!s.alive) {
        this.e.set(Math.PI / 2, s.heading, 0, "YXZ");
        this.q.setFromEuler(this.e);
        this.m.compose(this.v.set(s.x, s.y + 0.25, s.z), this.q, this.sc.set(1, 1, 1));
      } else {
        const bob = Math.abs(Math.sin(s.bob)) * 0.12;
        const lunge = s.attackAnim * 0.35;
        this.e.set(lunge * 0.6, s.heading, 0, "YXZ");
        this.q.setFromEuler(this.e);
        const fx = Math.sin(s.heading) * lunge, fz = Math.cos(s.heading) * lunge;
        this.m.compose(this.v.set(s.x + fx, s.y + bob, s.z + fz), this.q, this.sc.set(1, 1, 1));
      }
      const speed = Math.hypot(s.vx, s.vz);
      const hi0 = this.horseIndex.get(s);
      if (hi0 !== undefined) {
        // El caballo va donde el soldado; el jinete, encima
        if (!s.alive && !s.fled) {
          // Caballo caído, de costado
          this.e.set(0, s.heading, Math.PI / 2, "YXZ");
          this.q.setFromEuler(this.e);
          this.legM.compose(this.v.set(s.x, s.y + 0.32, s.z), this.q, this.sc.set(1, 1, 1));
          this.horses.setMatrixAt(hi0, this.legM);
        } else this.horses.setMatrixAt(hi0, this.m);
        if (s.alive && !s.fled) {
          const gallop = Math.sin(s.bob * 1.2) * Math.min(1, speed / 4) * 0.05;
          this.hip.makeRotationX(gallop);
          this.legM.multiplyMatrices(this.m, this.hip);
          this.horses.setMatrixAt(hi0, this.legM);
        }
        if (s.alive && !s.fled) this.m.multiply(this.lift.makeTranslation(0, RIDER_LIFT, -0.05));
      }
      this.bodies.setMatrixAt(i, this.m);
      // Piernas: balanceo al andar, quietas en formación; a caballo, a horcajadas
      const swing = s.alive && !s.fled && hi0 === undefined ? Math.sin(s.bob * 2) * Math.min(1, speed / 2.5) * 0.65 : 0;
      for (let side = 0; side < 2; side++) {
        if (hi0 !== undefined) {
          this.hip.makeRotationZ(side ? 0.5 : -0.5).setPosition(side ? 0.28 : -0.28, 0.62, 0);
        } else this.hip.makeRotationX(side ? swing : -swing).setPosition(side ? 0.11 : -0.11, 0.6, 0);
        this.legM.multiplyMatrices(this.m, this.hip);
        this.legs[side].setMatrixAt(i, this.legM);
      }
      this.c.copy(TEAM_COLOR.get(s.reg.colorKey ??= `${s.reg.team}-${k}`)!);
      if (!s.alive) this.c.lerp(CORPSE, 0.55);
      else if (s.reg.state === "routing") this.c.lerp(ROUT_GREY, 0.45);
      else if (selected.has(s.reg)) this.c.offsetHSL(0, 0.05, 0.12);
      this.bodies.setColorAt(i, this.c);
      const hi = this.headIndex.get(s);
      if (hi) hi[0].setMatrixAt(hi[1], this.m);
      const bi = this.bowIndex.get(s);
      if (bi !== undefined) this.bows.setMatrixAt(bi, !s.alive || s.fled ? ZERO : this.m);
      const si = this.spearIndex.get(s);
      if (si !== undefined) {
        if (!s.alive || s.fled || s.reg.state === "routing") this.m.makeScale(0, 0, 0);
        this.spears.setMatrixAt(si, this.m);
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    this.spears.instanceMatrix.needsUpdate = true;
    this.bows.instanceMatrix.needsUpdate = true;
    this.horses.instanceMatrix.needsUpdate = true;
    for (const l of this.legs) l.instanceMatrix.needsUpdate = true;
    for (const h of this.heads.values()) h.instanceMatrix.needsUpdate = true;

    // Estandartes: más grandes de lejos para que se lean siempre
    const camPos = (camera as THREE.PerspectiveCamera).position;
    for (const [r, bn] of this.banners) {
      bn.group.visible = r.state !== "gone";
      if (!bn.group.visible) continue;
      const by = this.terrain.heightAt(r.cx, r.cz);
      bn.group.position.set(r.cx, Math.max(0, by), r.cz);
      const dist = camPos.distanceTo(bn.group.position);
      const s = THREE.MathUtils.clamp(dist / 75, 1, 3);
      bn.group.scale.setScalar(s);
      bn.group.rotation.y = r.facing + Math.PI / 2 + Math.sin(t * 1.7 + r.id) * 0.08;
      bn.group.children[0].rotation.z = r.state === "routing" ? 0.6 : 0;
      bn.mat.color.set(r.state === "routing" ? "#7a7a7a" : selected.has(r) ? "#ffffff" : "#c8c8c8");
    }

    // Contornos de los seleccionados
    for (const [r, line] of this.outlines) {
      line.visible = selected.has(r) && r.active;
      if (line.visible) this.writeOutline(r, line);
    }

    // Flechas
    let ai = 0;
    for (const a of b.arrows) {
      if (ai >= 2000) break;
      const dir = a.landed >= 0 ? this.v.set(a.vx, a.vy, a.vz).normalize() : this.v.set(a.vx, a.vy, a.vz).normalize();
      this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      const pos = new THREE.Vector3(a.x, a.landed >= 0 ? a.y + 0.3 : a.y, a.z);
      this.m.compose(pos, this.q, this.sc.set(1, 1, 1));
      this.arrows.setMatrixAt(ai++, this.m);
    }
    this.arrows.count = ai;
    this.arrows.instanceMatrix.needsUpdate = true;

    // Marcas: previsualización de la formación y destinos de los seleccionados
    let mi = 0;
    const put = (p: P) => {
      if (mi >= 3000) return;
      this.m.makeTranslation(p.x, Math.max(0, this.terrain.heightAt(p.x, p.z)) + 0.12, p.z);
      this.markers.setMatrixAt(mi++, this.m);
    };
    previews.forEach(put);
    if (showDest) {
      for (const r of selected) {
        if (!r.active || !r.path.length || r.order.kind !== "move") continue;
        const end = r.path[r.path.length - 1];
        const facing = r.destFacing ?? r.facing;
        for (let i = 0; i < r.count; i++) put(r.slotPos(i, r.count, end.x, end.z, facing));
      }
    }
    this.markers.count = mi;
    this.markers.instanceMatrix.needsUpdate = true;
  }

  private writeOutline(r: Regiment, line: THREE.LineLoop) {
    const pos = line.geometry.attributes.position as THREE.BufferAttribute;
    const w = ((Math.min(r.files, r.count) - 1) * r.type.spacing) / 2 + 1.2;
    const depth = (r.ranks - 1) * r.type.spacing + 1.2;
    const f = r.fwd, rt = r.right;
    const corners: P[] = [
      { x: r.x - rt.x * w + f.x * 1.2, z: r.z - rt.z * w + f.z * 1.2 },
      { x: r.x + rt.x * w + f.x * 1.2, z: r.z + rt.z * w + f.z * 1.2 },
      { x: r.x + rt.x * w - f.x * depth, z: r.z + rt.z * w - f.z * depth },
      { x: r.x - rt.x * w - f.x * depth, z: r.z - rt.z * w - f.z * depth },
    ];
    let k = 0;
    for (let e = 0; e < 4; e++) {
      const a = corners[e], c = corners[(e + 1) % 4];
      for (let j = 0; j < 8; j++) {
        const t = j / 8;
        const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t;
        pos.setXYZ(k++, x, Math.max(0, this.terrain.heightAt(x, z)) + 0.35, z);
      }
    }
    pos.needsUpdate = true;
  }
}
