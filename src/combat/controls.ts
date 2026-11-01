import * as THREE from "three";
import { Battle, Regiment } from "./battle";
import { BattleView } from "./view";
import { RtsCamera } from "../camera/rtsCamera";
import { Terrain } from "../world/terrain";
import { P } from "../world/navgrid";

/**
 * Selección y órdenes del jugador, al estilo Total War:
 *  - Clic izquierdo: seleccionar (Mayús añade) · arrastrar: selección por recuadro
 *  - Clic derecho en el suelo: mover · en un enemigo: atacar
 *  - Arrastrar con clic derecho: dibujar la línea del frente (ancho y orientación)
 */
export class Controls {
  readonly selected = new Set<Regiment>();
  enabled = true;
  /** Mientras devuelva true (p. ej. construyendo), no se seleccionan tropas ni se dan órdenes. */
  suspended: () => boolean = () => false;
  /** El último clic izquierdo seleccionó tropas (la aldea no debe seleccionar un edificio). */
  consumed = false;
  previews: P[] = [];
  private box: HTMLDivElement;
  private leftDown: { x: number; y: number } | null = null;
  private rightDown: { x: number; y: number; ground: P | null } | null = null;
  private dragging = false;
  private layout: { r: Regiment; x: number; z: number; facing: number; files: number }[] = [];
  private v = new THREE.Vector3();

  constructor(
    private dom: HTMLElement, private rts: RtsCamera, private terrain: Terrain,
    private battle: Battle, private view: BattleView,
  ) {
    this.box = document.createElement("div");
    this.box.className = "select-box";
    this.box.hidden = true;
    document.body.appendChild(this.box);
    this.bind();
  }

  private get own() { return this.battle.regiments.filter((r) => r.team === 0 && r.active); }

  select(regs: Regiment[], add = false) {
    if (!add) this.selected.clear();
    for (const r of regs) if (r.team === 0 && r.active) this.selected.add(r);
  }

  toggle(r: Regiment) {
    if (this.selected.has(r)) this.selected.delete(r); else this.select([r], true);
  }

  /** Limpia la selección de regimientos que ya no pueden recibir órdenes. */
  prune() { for (const r of this.selected) if (!r.active) this.selected.delete(r); }

  private bind() {
    const d = this.dom;
    d.addEventListener("contextmenu", (e) => e.preventDefault());
    d.addEventListener("pointerdown", (e) => {
      this.consumed = false;
      if (!this.enabled || this.suspended()) return;
      if (e.button === 0) {
        this.leftDown = { x: e.clientX, y: e.clientY };
        d.setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        this.rightDown = { x: e.clientX, y: e.clientY, ground: this.groundAt(e.clientX, e.clientY) };
        this.dragging = false;
        d.setPointerCapture(e.pointerId);
      }
    });
    d.addEventListener("pointermove", (e) => {
      if (!this.enabled || this.suspended()) return;
      if (this.leftDown) {
        const x0 = Math.min(this.leftDown.x, e.clientX), y0 = Math.min(this.leftDown.y, e.clientY);
        const w = Math.abs(e.clientX - this.leftDown.x), h = Math.abs(e.clientY - this.leftDown.y);
        if (w + h > 6) {
          Object.assign(this.box.style, { left: x0 + "px", top: y0 + "px", width: w + "px", height: h + "px" });
          this.box.hidden = false;
        }
      }
      if (this.rightDown && this.rightDown.ground && this.selected.size) {
        const dist = Math.hypot(e.clientX - this.rightDown.x, e.clientY - this.rightDown.y);
        if (dist > 12) {
          const end = this.groundAt(e.clientX, e.clientY);
          if (end) {
            this.dragging = true;
            this.layout = this.lineLayout(this.rightDown.ground, end);
            this.previews = [];
            for (const l of this.layout) {
              for (let i = 0; i < l.r.count; i++) this.previews.push(l.r.slotPos(i, l.r.count, l.x, l.z, l.facing, l.files));
            }
          }
        }
      }
    });
    d.addEventListener("pointerup", (e) => {
      if (!this.enabled || this.suspended()) { this.leftDown = null; this.rightDown = null; this.box.hidden = true; return; }
      if (e.button === 0 && this.leftDown) {
        if (!this.box.hidden) { this.boxSelect(e.shiftKey); this.consumed = this.selected.size > 0; }
        else {
          const r = this.pick(e.clientX, e.clientY);
          if (r && r.team === 0) { e.shiftKey ? this.toggle(r) : this.select([r]); this.consumed = true; }
          else if (!e.shiftKey) this.selected.clear();
        }
        this.box.hidden = true;
        this.leftDown = null;
      } else if (e.button === 2 && this.rightDown) {
        if (this.dragging) {
          for (const l of this.layout) this.battle.orderMove(l.r, l.x, l.z, l.facing, l.files);
        } else {
          const target = this.pick(e.clientX, e.clientY);
          if (target && target.team === 1) {
            for (const r of this.selected) this.battle.orderAttack(r, target);
          } else if (this.rightDown.ground) {
            this.groupMove(this.rightDown.ground);
          }
        }
        this.rightDown = null;
        this.dragging = false;
        this.previews = [];
      }
    });

    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (e.code.startsWith("Digit")) {
        const r = this.own[Number(e.code.slice(5)) - 1];
        if (r) e.shiftKey ? this.toggle(r) : this.select([r]);
      } else if (e.code === "KeyA" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.select(this.own);
      } else if (e.code === "Escape") {
        this.selected.clear();
      } else if (e.code === "Backspace" || e.code === "KeyX") {
        for (const r of this.selected) this.battle.orderHalt(r);
      }
    });
  }

  /** Punto del terreno bajo el cursor (marcha a lo largo del rayo contra el relieve). */
  groundAt(cx: number, cy: number): P | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.rts.camera);
    const o = ray.ray.origin, dir = ray.ray.direction;
    const above = (t: number) => o.y + dir.y * t - Math.max(0, this.terrain.heightAt(o.x + dir.x * t, o.z + dir.z * t));
    let prev = 0;
    for (let t = 2; t < 1500; t += 2) {
      if (above(t) < 0) {
        let a = prev, b = t;
        for (let k = 0; k < 12; k++) { const m = (a + b) / 2; if (above(m) < 0) b = m; else a = m; }
        return { x: o.x + dir.x * b, z: o.z + dir.z * b };
      }
      prev = t;
    }
    return null;
  }

  private toScreen(p: THREE.Vector3): { x: number; y: number; ok: boolean } {
    const rect = this.dom.getBoundingClientRect();
    this.v.copy(p).project(this.rts.camera);
    return { x: rect.left + (this.v.x + 1) / 2 * rect.width, y: rect.top + (1 - this.v.y) / 2 * rect.height, ok: this.v.z < 1 };
  }

  /** Regimiento bajo el cursor: primero por estandarte, luego por soldados cerca del punto del suelo. */
  pick(cx: number, cy: number): Regiment | null {
    let best: Regiment | null = null, bd = 26;
    const p = new THREE.Vector3();
    for (const r of this.battle.regiments) {
      if (r.state === "gone") continue;
      const s = this.toScreen(this.view.bannerPoint(r, p));
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (s.ok && d < bd) { bd = d; best = r; }
    }
    if (best) return best;
    const g = this.groundAt(cx, cy);
    if (!g) return null;
    let gd = 2.5;
    for (const s of this.battle.soldiers) {
      if (!s.alive || s.fled || s.reg.state === "gone") continue;
      const d = Math.hypot(s.x - g.x, s.z - g.z);
      if (d < gd) { gd = d; best = s.reg; }
    }
    return best;
  }

  private boxSelect(add: boolean) {
    const b = this.box.getBoundingClientRect();
    const hits: Regiment[] = [];
    const p = new THREE.Vector3();
    for (const r of this.own) {
      const inside = r.alive.some((s) => {
        const sc = this.toScreen(p.set(s.x, s.y + 0.8, s.z));
        return sc.ok && sc.x >= b.left && sc.x <= b.right && sc.y >= b.top && sc.y <= b.bottom;
      });
      if (inside) hits.push(r);
    }
    this.select(hits, add);
  }

  /** Clic derecho simple: el grupo mantiene su disposición y mira hacia donde va. */
  private groupMove(dest: P) {
    const regs = [...this.selected];
    if (!regs.length) return;
    const gx = regs.reduce((a, r) => a + r.x, 0) / regs.length;
    const gz = regs.reduce((a, r) => a + r.z, 0) / regs.length;
    const far = Math.hypot(dest.x - gx, dest.z - gz) > 6;
    const facing = far ? Math.atan2(dest.x - gx, dest.z - gz) : null;
    for (const r of regs) {
      // Las posiciones relativas giran con el grupo
      let ox = r.x - gx, oz = r.z - gz;
      if (facing !== null && regs.length > 1) {
        const groupFacing = regs.reduce((a, q) => a + Math.atan2(Math.sin(q.facing), Math.cos(q.facing)), 0) / regs.length;
        const d = facing - groupFacing, c = Math.cos(d), s = Math.sin(d);
        [ox, oz] = [ox * c + oz * s, -ox * s + oz * c];
      }
      this.battle.orderMove(r, dest.x + ox, dest.z + oz, facing ?? r.facing, null);
    }
  }

  /** Reparte los seleccionados a lo largo de la línea a-b, mirando lejos de la cámara. */
  private lineLayout(a: P, b: P) {
    const regs = [...this.selected].filter((r) => r.active);
    const lx = b.x - a.x, lz = b.z - a.z, len = Math.hypot(lx, lz) || 1;
    const dir = { x: lx / len, z: lz / len };
    let n = { x: dir.z, z: -dir.x };
    const cam = this.rts.forwardXZ();
    if (n.x * cam.x + n.z * cam.z < 0) n = { x: -n.x, z: -n.z };
    const facing = Math.atan2(n.x, n.z);
    // Orden a lo largo de la línea según la posición actual, para que no se crucen
    regs.sort((p, q) => (p.cx * dir.x + p.cz * dir.z) - (q.cx * dir.x + q.cz * dir.z));
    const gap = 3;
    const total = regs.reduce((s, r) => s + r.count, 0) || 1;
    const usable = Math.max(len - gap * (regs.length - 1), regs.length * 4);
    let cursor = 0;
    return regs.map((r) => {
      const w = usable * (r.count / total);
      const files = Math.max(3, Math.min(r.count, Math.round(w / r.type.spacing) + 1));
      const mid = cursor + w / 2;
      cursor += w + gap;
      return { r, x: a.x + dir.x * mid, z: a.z + dir.z * mid, facing, files };
    });
  }
}
