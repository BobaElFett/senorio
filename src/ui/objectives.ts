import { Village } from "../settlement/village";
import { Campaign } from "../campaign/campaign";
import { Battle } from "../combat/battle";

// Objetivos de la primera partida: guían al jugador paso a paso y se marcan solos.

interface Objective { id: string; title: string; hint: string; done: (v: Village, c: Campaign, b: Battle) => boolean }

const LIST: Objective[] = [
  { id: "house", title: "Da casa a la familia que no tiene",
    hint: "Elige «Casa» en la barra de abajo y haz clic en un hueco libre. Las familias sin trabajo la construirán.",
    done: (v) => v.homeless.length === 0 && v.houses.length >= 5 },
  { id: "worker", title: "Pon a trabajar a una familia libre",
    hint: "Haz clic en la granja o el leñador y pulsa «+» en Trabajadores. Deja alguna familia libre para construir.",
    done: (v) => v.buildings.reduce((s, b) => s + b.workers.length, 0) >= 4 },
  { id: "farm", title: "Construye una segunda granja",
    hint: "En invierno los campos no dan nada: cada familia come 0,8 al día y hay que guardar comida.",
    done: (v) => v.buildings.filter((b) => b.built && b.type.kind === "farm").length >= 2 },
  { id: "market", title: "Abre un mercado con un tendero",
    hint: "El mercado cobra impuestos (monedas para el cuartel) y sube la aprobación. Asígnale un trabajador.",
    done: (v) => v.buildings.some((b) => b.built && b.type.kind === "market" && b.workers.length > 0) },
  { id: "barracks", title: "Construye el cuartel",
    hint: "Cuesta 10 de madera y 30 monedas. Los bandidos llegarán por el oeste hacia el día 20.",
    done: (v) => v.buildings.some((b) => b.built && b.type.kind === "barracks") },
  { id: "levy", title: "Recluta un regimiento",
    hint: "En el panel del cuartel: lanceros para aguantar, arqueros para desgastar. Cada familia aporta 4 hombres.",
    done: (v, c, b) => b.regiments.some((r) => r.team === 0) || c.results.includes("victoria") },
  { id: "raid", title: "Rechaza la primera incursión",
    hint: "Sal a su encuentro antes de que lleguen a la aldea: clic derecho sobre los bandidos para atacar. Ataca por el flanco si puedes.",
    done: (_v, c) => c.results.length > 0 && c.results[0] === "victoria" || c.raidIndex >= 1 },
  { id: "winter", title: "Llega al invierno con 60 de comida",
    hint: "Las granjas rinden más en otoño. Licencia los regimientos tras la batalla para que vuelvan a trabajar.",
    done: (v) => v.season === 3 && v.res.food >= 60 || v.year >= 2 },
];

export class Objectives {
  done = new Set<string>();
  collapsed = false;
  private root = document.getElementById("objectives")!;
  private list = document.getElementById("obj-list")!;
  private hint = document.getElementById("obj-hint")!;
  private toggle = document.getElementById("obj-toggle") as HTMLButtonElement;
  private key = "";
  private acc = 1;

  constructor(private v: Village, private c: Campaign, private b: Battle, private onComplete: (title: string) => void) {
    this.toggle.onclick = () => { this.collapsed = !this.collapsed; this.key = ""; this.render(); this.toggle.blur(); };
  }

  get finished() { return LIST.every((o) => this.done.has(o.id)); }

  update(dt: number, visible: boolean) {
    this.root.hidden = !visible || this.finished;
    if (!visible) return;
    this.acc += dt;
    if (this.acc < 0.5) return;
    this.acc = 0;
    // Se cumplen en orden: así el consejo siempre apunta al siguiente paso
    for (const o of LIST) {
      if (this.done.has(o.id)) continue;
      if (o.done(this.v, this.c, this.b)) { this.done.add(o.id); this.onComplete(o.title); }
      break;
    }
    this.render();
  }

  private render() {
    const current = LIST.find((o) => !this.done.has(o.id));
    const key = `${[...this.done].join()}|${this.collapsed}`;
    if (key === this.key) return;
    this.key = key;
    this.toggle.textContent = this.collapsed ? "Mostrar" : "Ocultar";
    this.list.replaceChildren(...LIST.filter((o) => !this.collapsed || o === current).map((o) => {
      const li = document.createElement("li");
      li.className = this.done.has(o.id) ? "done" : o === current ? "current" : "";
      li.textContent = o.title;
      return li;
    }));
    this.hint.textContent = current && !this.collapsed ? current.hint : "";
    this.hint.hidden = !current || this.collapsed;
  }
}
