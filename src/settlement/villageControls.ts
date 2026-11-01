import * as THREE from "three";
import { Village, Building } from "./village";
import { VillageView } from "./villageView";
import { BuildingKind } from "../data/buildings";
import { RtsCamera } from "../camera/rtsCamera";
import { P } from "../world/navgrid";

/**
 * Controles de la aldea:
 *  - Elegir un edificio en la barra → el fantasma sigue al ratón; R gira; clic izq. coloca
 *  - Clic der. o Esc: salir del modo construcción
 *  - Clic izq. en un edificio: seleccionarlo (panel con trabajadores y demoler)
 */
export class VillageControls {
  enabled = false;
  buildKind: BuildingKind | null = null;
  rot = 0;
  selected: Building | null = null;
  reason = "";
  private pos: P = { x: 0, z: 0 };
  private ok = false;
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

  startBuild(kind: BuildingKind) {
    this.buildKind = kind;
    this.selected = null;
    this.onChange();
  }

  cancelBuild() {
    this.buildKind = null;
    this.view.setGhost(this.village, null, 0, 0, 0, false);
    this.tip.hidden = true;
    this.onChange();
  }

  private refreshGhost(cx: number, cy: number) {
    if (!this.buildKind) return;
    const g = this.groundAt(cx, cy);
    if (!g) return;
    this.pos = { x: Math.round(g.x), z: Math.round(g.z) };
    const r = this.village.canPlace(this.buildKind, this.pos.x, this.pos.z, this.rot);
    this.ok = r.ok;
    this.reason = r.reason;
    this.view.setGhost(this.village, this.buildKind, this.pos.x, this.pos.z, this.rot, r.ok);
    this.tip.hidden = r.ok;
    this.tip.textContent = r.reason;
    this.tip.style.left = cx + 16 + "px";
    this.tip.style.top = cy + 12 + "px";
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
      if (this.buildKind) {
        this.refreshGhost(e.clientX, e.clientY);
        if (this.ok) {
          const kind = this.buildKind;
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
      if (e.code === "KeyR" && this.buildKind) {
        this.rot = (this.rot + (e.shiftKey ? 3 : 1)) % 4;
        this.refreshGhost(this.lastMouse.x, this.lastMouse.y);
      } else if (e.code === "Escape") {
        if (this.buildKind) this.cancelBuild(); else { this.selected = null; this.onChange(); }
      }
    });
  }

  private pickBuilding(cx: number, cy: number): Building | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.rts.camera);
    return this.view.pick(ray);
  }

  /** Quita la selección si el edificio ya no existe. */
  prune() { if (this.selected && !this.village.buildings.includes(this.selected)) this.selected = null; }
}
