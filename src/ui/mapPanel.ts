import { Regions, Region, TRIBUTE } from "../world/regions";
import { Terrain, MAP_SIZE, WATER_LEVEL } from "../world/terrain";
import { Forest } from "../world/forest";
import { Village } from "../settlement/village";
import { Battle } from "../combat/battle";

const PX = 400;                       // lado del lienzo en píxeles
const TINT: Record<string, [number, number, number]> = { player: [63, 111, 208], rival: [192, 57, 43] };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/**
 * Mapa del señorío (tecla N o botón «Mapa»): tierras con su dueño, aldea, tropas y encuadre de la cámara.
 * Clic en una tierra: sus rasgos, reclamarla si linda con las tuyas e ir allí con la cámara.
 */
export class MapPanel {
  isOpen = false;
  private root = document.getElementById("map")!;
  private canvas = document.getElementById("map-canvas") as HTMLCanvasElement;
  private info = document.getElementById("map-info")!;
  private ctx = this.canvas.getContext("2d")!;
  private base: ImageData;
  private ids: Int8Array;
  private water: Uint8Array;
  private tinted: ImageData | null = null;
  private tintVersion = -1;
  private selected: Region | null = null;
  private infoKey = "";

  constructor(private regions: Regions, terrain: Terrain, forest: Forest, private village: Village, private battle: Battle,
    private camera: () => { x: number; z: number }, private goTo: (x: number, z: number) => void) {
    this.canvas.width = this.canvas.height = PX;
    // Fondo: altura, agua y bosque, calculado una sola vez
    this.base = this.ctx.createImageData(PX, PX);
    this.ids = new Int8Array(PX * PX);
    this.water = new Uint8Array(PX * PX);
    const trees = new Uint16Array(PX * PX);
    for (const t of forest.trees) {
      const [i, j] = this.toPx(t.x, t.z);
      if (i >= 0 && j >= 0 && i < PX && j < PX) trees[j * PX + i]++;
    }
    for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
      const [x, z] = this.toWorld(i + 0.5, j + 0.5);
      const h = terrain.heightAt(x, z);
      this.ids[j * PX + i] = regions.idAt(x, z);
      this.water[j * PX + i] = h < WATER_LEVEL + 0.1 ? 1 : 0;
      let r: number, g: number, b: number;
      if (h < WATER_LEVEL + 0.1) { r = 52; g = 92; b = 104; }
      else {
        const k = Math.min(1, h / 40);
        r = 128 - k * 30; g = 160 - k * 40; b = 92 - k * 20;
        if (h < WATER_LEVEL + 0.9) { r = 196; g = 184; b = 136; }
        const near = trees[j * PX + i] + (trees[j * PX + i - 1] ?? 0) + (trees[j * PX + i + 1] ?? 0);
        if (near) { const f = Math.min(1, near / 3); r -= 40 * f; g -= 30 * f; b -= 30 * f; }
      }
      const o = (j * PX + i) * 4;
      this.base.data[o] = r; this.base.data[o + 1] = g; this.base.data[o + 2] = b; this.base.data[o + 3] = 255;
    }
    this.canvas.addEventListener("click", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const i = ((e.clientX - rect.left) / rect.width) * PX, j = ((e.clientY - rect.top) / rect.height) * PX;
      const [x, z] = this.toWorld(i, j);
      this.selected = this.regions.at(x, z);
      this.infoKey = "";
    });
    this.canvas.addEventListener("dblclick", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const [x, z] = this.toWorld(((e.clientX - rect.left) / rect.width) * PX, ((e.clientY - rect.top) / rect.height) * PX);
      this.goTo(x, z); this.close();
    });
    document.getElementById("map-close")!.onclick = () => this.close();
  }

  private toPx(x: number, z: number): [number, number] {
    return [Math.floor(((x + MAP_SIZE / 2) / MAP_SIZE) * PX), Math.floor(((z + MAP_SIZE / 2) / MAP_SIZE) * PX)];
  }
  private toWorld(i: number, j: number): [number, number] {
    return [(i / PX) * MAP_SIZE - MAP_SIZE / 2, (j / PX) * MAP_SIZE - MAP_SIZE / 2];
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }
  open() { this.isOpen = true; this.root.hidden = false; this.infoKey = ""; this.update(); }
  close() { this.isOpen = false; this.root.hidden = true; }

  /** Tierras teñidas por dueño y lindes, rehecho solo cuando cambia algún dueño. */
  private tint() {
    if (this.tinted && this.tintVersion === this.regions.version) return this.tinted;
    this.tintVersion = this.regions.version;
    const img = this.ctx.createImageData(PX, PX);
    img.data.set(this.base.data);
    for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
      const p = j * PX + i, id = this.ids[p], o = p * 4;
      const owner = this.regions.list[id].owner;
      const edge = (i + 1 < PX && this.ids[p + 1] !== id) || (j + 1 < PX && this.ids[p + PX] !== id);
      if (edge) { img.data[o] = 245; img.data[o + 1] = 238; img.data[o + 2] = 214; continue; }
      if (owner && !this.water[p]) {
        const [r, g, b] = TINT[owner];
        img.data[o] = img.data[o] * 0.62 + r * 0.38; img.data[o + 1] = img.data[o + 1] * 0.62 + g * 0.38; img.data[o + 2] = img.data[o + 2] * 0.62 + b * 0.38;
      }
    }
    this.tinted = img;
    return img;
  }

  update() {
    if (!this.isOpen) return;
    const c = this.ctx;
    c.putImageData(this.tint(), 0, 0);
    // Tierra seleccionada
    if (this.selected) {
      const [x, y] = this.toPx(this.selected.center.x, this.selected.center.z);
      c.strokeStyle = "#ffe39a"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.stroke();
    }
    // Edificios
    c.fillStyle = "#f4ead2";
    for (const b of this.village.buildings) {
      const [x, y] = this.toPx(b.x, b.z);
      c.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // Tropas
    for (const r of this.battle.regiments) {
      if (r.state === "gone" || !r.alive.length) continue;
      const [x, y] = this.toPx(r.cx, r.cz);
      c.fillStyle = r.team === 0 ? "#7fb0ff" : "#ff6b5a";
      c.strokeStyle = "#1a1f1c"; c.lineWidth = 1;
      c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    // Nombres
    c.font = "600 11px Inter, system-ui, sans-serif"; c.textAlign = "center";
    for (const r of this.regions.list) {
      const [x, y] = this.toPx(r.center.x, r.center.z);
      c.fillStyle = "rgba(20,24,22,.55)";
      const w = c.measureText(r.name).width + 8;
      c.fillRect(x - w / 2, y + 6, w, 15);
      c.fillStyle = r.owner === "player" ? "#cfe0ff" : r.owner === "rival" ? "#ffc9c0" : "#f4ead2";
      c.fillText(r.name, x, y + 17);
      c.fillStyle = r.owner === "player" ? "#3f6fd0" : r.owner === "rival" ? "#c0392b" : "#e8e2c8";
      if (r.capital) { c.fillRect(x - 4, y - 7, 8, 8); c.fillRect(x - 6, y - 9, 3, 3); c.fillRect(x + 3, y - 9, 3, 3); }
      else { c.fillRect(x - 1, y - 8, 2, 9); c.fillRect(x + 1, y - 8, 6, 4); }
    }
    // Encuadre de la cámara
    const cam = this.camera();
    const [cx, cy] = this.toPx(cam.x, cam.z);
    c.strokeStyle = "#ffffff"; c.lineWidth = 1.5; c.strokeRect(cx - 12, cy - 9, 24, 18);
    this.renderInfo();
  }

  private renderInfo() {
    const r = this.selected;
    const plan = r ? this.village.claimPlan(r) : null;
    const key = r ? `${r.id}${r.owner}${plan!.reason}${plan!.cost}` : "-";
    if (key === this.infoKey) return;
    this.infoKey = key;
    const items: HTMLElement[] = [];
    if (!r) {
      items.push(el("h3", "", "Tus tierras"),
        el("p", "p-note", `Tienes ${this.regions.count("player")} de ${this.regions.list.length}. Cada tierra además de La Explanada paga ${TRIBUTE} monedas al día de tributo. Solo puedes construir en las tuyas.`),
        el("p", "p-note", "Clic en una tierra para ver qué ofrece. Doble clic: llevar allí la cámara."));
    } else {
      items.push(el("h3", "", r.name),
        el("div", "p-row", r.owner === "player" ? "Tuya" : r.owner === "rival" ? "Del señor de Montfort" : "Sin dueño"),
        el("p", "p-desc", r.note),
        el("p", "p-note", `Granjas ×${r.fertility.toFixed(2)} · leñadores ×${r.woods.toFixed(2)}`));
      if (r.owner !== "player") {
        const btn = el("button", "levy-btn");
        btn.type = "button";
        btn.append(el("span", "levy-name", r.owner === "rival" ? "Tomar por la fuerza" : "Reclamar"),
          el("span", "levy-cost", r.owner === "rival" ? "Lleva tropas a su estandarte y quédate sin enemigos cerca" : `${plan!.cost} monedas`));
        btn.disabled = !plan!.ok;
        if (!plan!.ok && r.owner !== "rival") btn.append(el("span", "levy-why", plan!.reason));
        btn.onclick = () => { this.village.claim(r); this.infoKey = ""; };
        items.push(btn);
      }
      const go = el("button", "p-go", "Ir allí");
      go.type = "button";
      go.onclick = () => { this.goTo(r.center.x, r.center.z); this.close(); };
      items.push(go);
    }
    this.info.replaceChildren(...items);
  }
}
