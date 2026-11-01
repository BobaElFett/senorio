import { Village, Building, LevyKind, LEVY } from "../settlement/village";
import { VillageControls } from "../settlement/villageControls";
import { BUILDINGS, BUILD_ORDER, Resource, RESOURCE_LABEL, WOOD_PER_WORKER, FARM_YIELD, TAX_PER_FAMILY, MILL_PER_WORKER, MILL_RESERVE, BAKE_PER_WORKER, BREAD_PER_FLOUR } from "../data/buildings";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmtRate = (r: number) => (Math.abs(r) < 0.05 ? "±0" : (r > 0 ? "+" : "−") + Math.abs(r).toFixed(1));
const costText = (c: Partial<Record<Resource, number>>) =>
  (Object.entries(c) as [Resource, number][]).map(([r, n]) => `${n} ${RESOURCE_LABEL[r].toLowerCase()}`).join(" · ");

/**
 * Interfaz de la aldea: barra de recursos y fecha (arriba), barra de construcción
 * (abajo), panel del edificio seleccionado (derecha) y avisos (abajo a la izquierda).
 */
export class VillageHud {
  private res = document.getElementById("v-res")!;
  private date = document.getElementById("v-date")!;
  private pop = document.getElementById("v-pop")!;
  private appr = document.getElementById("v-appr")!;
  private apprList = document.getElementById("v-appr-list")!;
  private buildBar = document.getElementById("v-build")!;
  private panel = document.getElementById("v-panel")!;
  private toasts = document.getElementById("v-toasts")!;
  private buttons = new Map<string, HTMLButtonElement>();
  private lastEvent = 0;
  private acc = 1;
  private panelFor: Building | null | undefined = undefined;
  private panelVersion = -1;

  constructor(private v: Village, private c: VillageControls, private levy: (kind: LevyKind) => void = () => {}) {
    for (const kind of BUILD_ORDER) {
      const t = BUILDINGS[kind];
      const b = el("button", "build-btn");
      b.type = "button";
      b.append(el("span", "build-name", t.label), el("span", "build-cost", costText(t.cost)));
      b.title = t.description;
      b.addEventListener("click", () => {
        if (this.c.buildKind === kind) this.c.cancelBuild(); else this.c.startBuild(kind);
        b.blur();
      });
      this.buildBar.append(b);
      this.buttons.set(kind, b);
    }
  }

  /** Fuerza el refresco del panel en el siguiente fotograma. */
  invalidate() { this.panelFor = undefined; this.acc = 1; }

  update(dt: number, paused: boolean, speed: number) {
    // Avisos nuevos
    for (const e of this.v.events) {
      if (e.id <= this.lastEvent) continue;
      this.lastEvent = e.id;
      const t = el("div", `toast ${e.kind}`, e.text);
      this.toasts.prepend(t);
      setTimeout(() => t.classList.add("fade"), 6000);
      setTimeout(() => t.remove(), 7000);
      while (this.toasts.children.length > 5) this.toasts.lastElementChild!.remove();
    }

    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    const v = this.v;
    const cap = v.capacity();

    this.res.replaceChildren();
    // Harina y pan solo aparecen cuando hay molino o panadería (o existencias)
    const chain = v.buildings.some((b) => b.type.kind === "mill" || b.type.kind === "bakery") || v.res.flour + v.res.bread > 0.5;
    const shown: Resource[] = chain ? ["wood", "food", "flour", "bread", "coins"] : ["wood", "food", "coins"];
    for (const r of shown) {
      const box = el("div", `res res-${r}`);
      const rate = v.rates[r];
      const eatRate = v.rates.food + v.rates.bread;
      const warn = (r === "food" && (v.hungry || (eatRate < 0 && v.foodTotal / -eatRate < 4))) || (r === "wood" && v.cold);
      if (warn) box.classList.add("warn");
      // La capacidad va en el recuadro «Almacén»; aquí solo se marca si está casi lleno
      if (v.res[r] >= cap * 0.95) box.classList.add("full");
      box.title = `${RESOURCE_LABEL[r]}: ${Math.floor(v.res[r])} de ${cap}`;
      box.append(el("span", "res-label", RESOURCE_LABEL[r]), el("span", "res-val", `${Math.floor(v.res[r])}`),
        el("span", `res-rate ${rate < -0.05 ? "neg" : rate > 0.05 ? "pos" : ""}`, `${fmtRate(rate)}`));
      this.res.append(box);
    }
    const store = el("div", "res res-cap-box");
    store.title = "Capacidad de cada recurso. Cada almacén suma 150.";
    store.append(el("span", "res-label", "Almacén"), el("span", "res-cap", `${cap}`));
    this.res.append(store);
    const homeless = v.homeless.length, idle = v.idle.length;
    this.pop.replaceChildren(
      el("span", "res-label", "Familias"), el("span", "res-val", `${v.families.length}`),
      el("span", "res-cap", ` · ${v.houses.reduce((s, h) => s + h.type.housing, 0)} casas`),
      el("span", `res-rate ${homeless ? "neg" : ""}`, homeless ? `${homeless} sin casa` : `${idle} libres`),
    );
    const a = Math.round(v.approval);
    this.appr.querySelector(".res-val")!.textContent = `${a}%`;
    this.appr.dataset.level = a >= 50 ? "good" : a >= 30 ? "mid" : "bad";
    const target = Math.round(v.approvalTarget);
    this.appr.querySelector(".res-rate")!.textContent = target > a ? "▲ subiendo" : target < a ? "▼ bajando" : "estable";
    this.apprList.replaceChildren(...v.factors.map((f) => {
      const row = el("div", "f-row");
      row.append(el("span", "", f.label), el("span", f.value >= 0 ? "pos" : "neg", (f.value > 0 && f.label !== "Base" ? "+" : "") + f.value));
      return row;
    }), el("div", "f-note", a >= 50 ? "Con 50% o más y casas libres llegan familias." : a < 30 ? "Por debajo de 30% las familias se marchan." : "Hace falta 50% para que lleguen familias."));

    const hh = Math.floor(v.hour * 24), mm = Math.floor((v.hour * 24 - hh) * 60);
    this.date.textContent = `${v.seasonName}, día ${v.dayOfSeason} · año ${v.year} · ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${paused ? " · en pausa" : ""} · ${speed}×`;

    for (const [kind, b] of this.buttons) {
      const t = BUILDINGS[kind as keyof typeof BUILDINGS];
      const afford = (Object.entries(t.cost) as [Resource, number][]).every(([r, n]) => v.res[r] >= n);
      b.classList.toggle("cant", !afford);
      b.classList.toggle("active", this.c.buildKind === kind);
    }

    this.renderPanel();
  }

  private renderPanel() {
    const b = this.c.selected;
    if (!b) { this.panel.hidden = true; this.panelFor = null; return; }
    this.panel.hidden = false;
    // Reconstruir solo si cambia el edificio; si no, actualizar textos
    const levyKey = b.type.kind === "barracks" ? (["spear", "archer"] as LevyKind[]).map((k) => { const p = this.v.levyPlan(k); return `${p.ok}${p.families.length}${p.reason}${p.reused}`; }).join("|") : "";
    const key = `${b.id}-${b.built}-${b.workers.length}-${b.residents.length}-${this.v.idle.length}-${Math.floor(b.progress * 100)}-${this.v.season}-${levyKey}`;
    if (this.panelFor === b && this.panel.dataset.key === key) return;
    this.panelFor = b;
    this.panel.dataset.key = key;
    void this.panelVersion;
    const v = this.v;
    const t = b.type;
    const items: HTMLElement[] = [el("h3", "", t.label), el("p", "p-desc", t.description)];

    if (!b.built) {
      const builders = v.families.filter((f) => f.site === b).length;
      items.push(el("div", "p-row", `En obras: ${Math.floor(b.progress * 100)}%`));
      const bar = el("div", "p-bar"); const fill = el("i"); fill.style.width = `${b.progress * 100}%`; bar.append(fill);
      items.push(bar);
      items.push(el("p", builders ? "p-note" : "p-note neg", builders
        ? `${builders} familia${builders > 1 ? "s" : ""} construyendo`
        : "Nadie construye: las familias sin trabajo son las que construyen."));
    } else {
      if (t.workers > 0) {
        const row = el("div", "p-workers");
        const minus = el("button", "w-btn", "−"); minus.type = "button";
        const plus = el("button", "w-btn", "+"); plus.type = "button";
        minus.disabled = !b.workers.length;
        plus.disabled = b.workers.length >= t.workers || !v.idle.length;
        minus.onclick = () => { v.unassign(b); this.invalidate(); };
        plus.onclick = () => { v.assign(b); this.invalidate(); };
        row.append(el("span", "", "Trabajadores"), minus, el("span", "w-count", `${b.workers.length}/${t.workers}`), plus);
        items.push(row);
        if (!v.idle.length && b.workers.length < t.workers) items.push(el("p", "p-note", "No hay familias libres."));
        if (b.workers.length) items.push(el("p", "p-note", "Familias: " + b.workers.map((f) => f.name).join(", ")));
      }
      const n = b.workers.length;
      if (t.kind === "woodcutter") {
        const trees = v.forest.within(b.door.x, b.door.z, 45).length;
        const rate = n * WOOD_PER_WORKER * Math.min(1, trees / 30);
        items.push(el("div", "p-row", `Produce ${rate.toFixed(1)} madera/día`), el("p", trees < 30 ? "p-note neg" : "p-note", `${trees} árboles al alcance${trees < 30 ? ": rinde menos" : ""}`));
      } else if (t.kind === "farm") {
        items.push(el("div", "p-row", `Produce ${(n * FARM_YIELD[v.season]).toFixed(1)} comida/día ahora`),
          el("p", "p-note", `Por trabajador: primavera ${FARM_YIELD[0]}, verano ${FARM_YIELD[1]}, otoño ${FARM_YIELD[2]}, invierno 0.`));
      } else if (t.kind === "market") {
        const housed = v.families.filter((f) => f.home).length;
        items.push(el("div", "p-row", n ? `Impuestos: ${(housed * TAX_PER_FAMILY).toFixed(1)} monedas/día · +10 aprobación` : "Cerrado: necesita un tendero"));
      } else if (t.kind === "mill") {
        const can = Math.max(0, v.res.food - MILL_RESERVE);
        items.push(el("div", "p-row", n ? `Muele ${(n * MILL_PER_WORKER).toFixed(0)} de grano al día en harina` : "Parado: necesita un molinero"),
          el("p", can < 1 && n ? "p-note neg" : "p-note", can < 1 && n ? `Sin grano que moler: deja ${MILL_RESERVE} siempre en reserva.` : `Harina en el almacén: ${Math.floor(v.res.flour)}`));
      } else if (t.kind === "bakery") {
        items.push(el("div", "p-row", n ? `Cuece ${(n * BAKE_PER_WORKER).toFixed(0)} de harina al día → ${(n * BAKE_PER_WORKER * BREAD_PER_FLOUR).toFixed(0)} de pan` : "Parada: necesita un panadero"),
          el("p", v.res.flour < 1 && n ? "p-note neg" : "p-note", v.res.flour < 1 && n ? "Sin harina: construye un molino y ponle molinero." : `Pan en el almacén: ${Math.floor(v.res.bread)} · ${Math.round(v.breadShare * 100)}% de lo que se come es pan${v.breadShare > 0.5 ? " (+8 aprobación)" : ""}`));
      } else if (t.kind === "storehouse") {
        items.push(el("div", "p-row", `+${t.storage} de capacidad para cada recurso`));
      } else if (t.kind === "house") {
        items.push(el("div", "p-row", b.residents.length ? `Vive la familia ${b.residents[0].name}` : "Vacía: llegará una familia si la aprobación es de 50% o más"));
      } else if (t.kind === "barracks") {
        items.push(el("div", "p-row", "Leva: cada familia aporta 4 hombres. Mientras sirven no trabajan, pero siguen comiendo. Al licenciar, el equipo vuelve al cuartel; si huyen, se pierde."));
        for (const kind of ["spear", "archer"] as LevyKind[]) {
          const plan = v.levyPlan(kind);
          const btn = el("button", "levy-btn");
          btn.type = "button";
          const men = plan.families.reduce((s, f) => s + Math.min(4, f.members), 0);
          btn.append(el("span", "levy-name", `Reclutar ${LEVY[kind].label.toLowerCase()}`),
            el("span", "levy-cost", plan.families.length ? `${plan.families.length} familias · ${men} hombres · ${plan.wood} madera · ${plan.coins} monedas${plan.reused ? ` (${plan.reused} equipos guardados)` : ""}` : "Nadie disponible"));
          btn.disabled = !plan.ok;
          if (!plan.ok) btn.append(el("span", "levy-why", plan.reason));
          btn.onclick = () => { this.levy(kind); this.invalidate(); };
          items.push(btn);
        }
        if (v.equipment.spear + v.equipment.archer) items.push(el("p", "p-note", `Equipo guardado: ${v.equipment.spear} de lanceros y ${v.equipment.archer} de arqueros (por familia). Lo usan las próximas levas sin coste.`));
        const levied = v.families.filter((f) => f.levied !== null).length;
        if (levied) items.push(el("p", "p-note", `${levied} familias sirven en la leva. Licencia los regimientos desde su tarjeta para que vuelvan a trabajar.`));
      }
    }
    const isLastStore = t.kind === "storehouse" && v.buildings.filter((x) => x.type.kind === "storehouse").length === 1;
    const del = el("button", "p-del", b.built ? "Demoler (devuelve la mitad)" : "Cancelar obra");
    del.type = "button";
    del.disabled = isLastStore;
    if (isLastStore) del.title = "La aldea necesita al menos un almacén";
    del.onclick = () => { v.demolish(b); this.c.selected = null; this.invalidate(); };
    items.push(del);
    this.panel.replaceChildren(...items);
  }
}
