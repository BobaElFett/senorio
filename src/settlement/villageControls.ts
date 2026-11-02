import * as THREE from "three";
import { Village, Building, Wall } from "./village";
import { VillageView } from "./villageView";
import { BuildingKind } from "../data/buildings";
import { RtsCamera } from "../camera/rtsCamera";
import { P } from "../world/navgrid";

export type BuildTool = BuildingKind | "palisade" | "gate";
export const isWall = (x: Building | Wall | null): x is Wall => !!x && "gate" in x;

/**
 * Controles de la aldea:
 *  - Elegir un edificio en la barra → el fantasma sigue al ratón; R gira; clic izq. coloca
 *  - Empalizada y puerta: clic para el inicio, clic para el final (la empalizada sigue encadenando)
 *  - Clic der. o Esc: salir del modo construcción
 *  - Clic izq. en un edificio o tramo: seleccionarlo (panel con trabajadores y demoler)
 */
export class VillageControls {
  enabled = false;
  buildKind: BuildTool | null = null;
  rot = 0;
  selected: Building | Wall | null = null;
  reason = "";
  private pos: P = { x: 0, z: 0 };
  private ok = false;
  private wallStart: P | null = null;
  private tip: HTMLDivElement;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private dom: HTMLElement, private rts: RtsCamera, private village: Village, private view: VillageView,
    private groundAt: (x: number, y: number) => P | null, private onChange: () => void,
    private troopsTookClick: () => boolean = () => false,
  ) {
    this.tip = document.createElement("div");
    this.tip.className = "place-tip";
    this.tip.hidden = true;
    document.body.appendChild(this.tip);
    this.bind();
  }

  private get wallTool() { return this.buildKind === "palisade" || this.buildKind === "gate"; }

  startBuild(kind: BuildTool) {
    this.cancelBuild();
    this.buildKind = kind;
    this.selected = null;
    this.onChange();
  }

  cancelBuild() {
    this.buildKind = null;
    this.wallStart = null;
    this.view.setGhost(this.village, null, 0, 0, 0, false);
    this.view.setWallGhost(null, false);
    this.tip.hidden = true;
    this.onChange();
  }

  private showTip(cx: number, cy: number, text: string, bad: boolean) {
    this.tip.hidden = !text;
    this.tip.textContent = text;
    this.tip.classList.toggle("info", !bad);
    this.tip.style.left = cx + 16 + "px";
    this.tip.style.top = cy + 12 + "px";
  }

  private refreshGhost(cx: number, cy: number) {
    if (!this.buildKind) return;
    const g = this.groundAt(cx, cy);
    if (!g) return;
    if (this.wallTool) {
      this.pos = { x: Math.round(g.x * 2) / 2, z: Math.round(g.z * 2) / 2 };
      const gate = this.buildKind === "gate";
      if (!this.wallStart) {
        this.ok = false;
        this.view.setWallGhost([{ ax: this.pos.x, az: this.pos.z, bx: this.pos.x, bz: this.pos.z }], true);
        this.showTip(cx, cy, gate ? "Clic: un extremo de la puerta" : "Clic: inicio de la empalizada", false);
        return;
      }
      const s = this.wallStart;
      const plan = this.village.wallPlan(s.x, s.z, this.pos.x, this.pos.z, gate);
      this.ok = plan.ok;
      this.view.setWallGhost(plan.segs, plan.ok);
      this.showTip(cx, cy, plan.ok ? `${plan.segs.length} tramo${plan.segs.length > 1 ? "s" : ""} · ${plan.wood} madera` : plan.reason, !plan.ok);
      return;
    }
    this.pos = { x: Math.round(g.x), z: Math.round(g.z) };
    const kind = this.buildKind as BuildingKind;
    const r = this.village.canPlace(kind, this.pos.x, this.pos.z, this.rot);
    this.ok = r.ok;
    this.reason = r.reason;
    this.view.setGhost(this.village, kind, this.pos.x, this.pos.z, this.rot, r.ok);
    this.showTip(cx, cy, r.reason, true);
  }

  private lastMouse = { x: 0, y: 0 };

  private bind() {
    const d = this.dom;
    d.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.refreshGhost(e.clientX, e.clientY);
    });
    d.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY };
      if (e.button === 2 && this.buildKind) this.cancelBuild();
    });
    d.addEventListener("pointerup", (e) => {
      if (!this.enabled || e.button !== 0 || !this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 6;
      this.downAt = null;
      if (moved) return;
      if (this.buildKind && this.wallTool) {
        this.refreshGhost(e.clientX, e.clientY);
        if (!this.wallStart) { this.wallStart = { ...this.pos }; this.refreshGhost(e.clientX, e.clientY); return; }
        if (this.ok) {
          const gate = this.buildKind === "gate";
          const placed = this.village.placeWall(this.wallStart.x, this.wallStart.z, this.pos.x, this.pos.z, gate);
          // La empalizada encadena tramos desde el último punto; la puerta termina aquí
          if (gate) this.cancelBuild();
          else {
            const last = placed[placed.length - 1];
            this.wallStart = last ? { x: last.bx, z: last.bz } : null;
            this.refreshGhost(e.clientX, e.clientY);
          }
          this.onChange();
        }
      } else if (this.buildKind) {
        this.refreshGhost(e.clientX, e.clientY);
        if (this.ok) {
          const kind = this.buildKind as BuildingKind;
          this.village.place(kind, this.pos.x, this.pos.z, this.rot);
          // Las casas se colocan en serie; el resto sale del modo construcción
          if (kind !== "house" && !e.shiftKey) this.cancelBuild();
          else this.refreshGhost(e.clientX, e.clientY);
          this.onChange();
        }
      } else {
        // Si el clic seleccionó tropas, no se elige edificio
        this.selected = this.troopsTookClick() ? null : this.pickBuilding(e.clientX, e.clientY);
        this.onChange();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (e.code === "KeyR" && this.buildKind && !this.wallTool) {
        this.rot = (this.rot + (e.shiftKey ? 3 : 1)) % 4;
        this.refreshGhost(this.lastMouse.x, this.lastMouse.y);
      } else if (e.code === "Escape") {
        if (this.buildKind) this.cancelBuild(); else { this.selected = null; this.onChange(); }
      }
    });
  }

  private pickBuilding(cx: number, cy: number): Building | Wall | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.rts.camera);
    return this.view.pick(ray);
  }

  /** Quita la selección si el edificio o tramo ya no existe. */
  prune() {
    const s = this.selected;
    if (!s) return;
    if (isWall(s) ? !this.village.walls.includes(s) : !this.village.buildings.includes(s)) this.selected = null;
  }
}
