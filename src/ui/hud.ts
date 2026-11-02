import { Battle, Regiment, RegState } from "../combat/battle";
import { Controls } from "../combat/controls";

const STATE_LABEL: Record<RegState, string> = { ok: "Firme", wavering: "Vacilante", routing: "Huyendo", gone: "Fuera" };

interface Card { el: HTMLElement; count: HTMLElement; bar: HTMLElement; state: HTMLElement; order: HTMLElement }

/**
 * Interfaz de batalla: tarjetas de los regimientos propios (abajo), resumen del
 * enemigo (derecha) y aviso de fase / resultado (arriba).
 */
export class Hud {
  private cards = new Map<Regiment, Card>();
  private enemies = new Map<Regiment, Card>();
  private version = -1;
  private bar: HTMLElement;
  private enemyList: HTMLElement;
  private banner: HTMLElement;
  private bannerText: HTMLElement;
  private bannerBtn: HTMLButtonElement | null;
  private status: HTMLElement | null;
  private acc = 0;

  /**
   * `prefix` elige el juego de elementos de la página ("" = batalla de prueba, "v-" = aldea).
   * En la aldea, `campaign` aporta el aviso de incursión y el botón de licenciar.
   */
  constructor(private battle: Battle, private controls: Controls, private actions: { start(): void; restart(): void },
    prefix = "", private campaign?: { banner(): { text: string; kind: string; action?: { label: string; run(): void } } | null; disband(r: Regiment): void }) {
    const $ = (id: string) => document.getElementById(prefix + id);
    this.bar = $("cards")!;
    this.enemyList = $("enemies")!;
    this.banner = $("banner")!;
    this.bannerText = $("banner-text")!;
    this.bannerBtn = $("banner-btn") as HTMLButtonElement | null;
    this.status = $("status");
    if (!campaign) this.bannerBtn?.addEventListener("click", () => {
      if (this.battle.result !== null) this.actions.restart(); else this.actions.start();
      this.bannerBtn!.blur();
    });
  }

  private rebuild() {
    this.version = this.battle.version;
    this.bar.replaceChildren();
    this.enemyList.replaceChildren();
    this.cards.clear();
    this.enemies.clear();
    let n = 0;
    for (const r of this.battle.regiments) {
      const card = this.makeCard(r, r.team === 0 ? ++n : 0);
      if (r.team === 0) {
        card.el.addEventListener("click", (e) => {
          if ((e.target as HTMLElement).closest(".disband")) return;
          if (e.shiftKey) this.controls.toggle(r); else this.controls.select([r]);
          (card.el as HTMLElement).blur();
        });
        this.bar.appendChild(card.el);
        this.cards.set(r, card);
      } else {
        this.enemyList.appendChild(card.el);
        this.enemies.set(r, card);
      }
    }
  }

  private makeCard(r: Regiment, hotkey: number): Card {
    const el = document.createElement("div");
    el.className = `card team${r.team} kind-${r.type.kind}`;
    if (r.team === 0) { el.setAttribute("role", "button"); el.tabIndex = 0; }
    const head = document.createElement("div");
    head.className = "card-head";
    const name = document.createElement("span");
    name.className = "card-name";
    name.textContent = r.name;
    head.append(name);
    if (hotkey) {
      const k = document.createElement("kbd");
      k.textContent = String(hotkey);
      head.append(k);
    }
    const meta = document.createElement("div");
    meta.className = "card-meta";
    const kind = document.createElement("span");
    kind.textContent = r.type.label;
    const count = document.createElement("span");
    count.className = "num";
    meta.append(kind, count);
    const bar = document.createElement("div");
    bar.className = "morale";
    const fill = document.createElement("i");
    bar.append(fill);
    const foot = document.createElement("div");
    foot.className = "card-foot";
    const state = document.createElement("span");
    state.className = "state";
    const order = document.createElement("span");
    order.className = "order";
    foot.append(state, order);
    el.append(head, meta, bar, foot);
    if (this.campaign && r.team === 0) {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "disband";
      d.textContent = "Licenciar";
      d.title = "Los supervivientes vuelven a casa y a trabajar";
      d.addEventListener("click", () => { this.campaign!.disband(r); d.blur(); });
      el.append(d);
    }
    return { el, count, bar: fill, state, order };
  }

  update(dt: number, paused: boolean, speed: number) {
    if (this.battle.version !== this.version) this.rebuild();
    this.acc += dt;
    if (this.acc < 0.15) return;
    this.acc = 0;
    const fill = (r: Regiment, c: Card) => {
      c.count.textContent = `${r.count}/${r.size}`;
      const pct = Math.max(0, r.morale / 100) * 100;
      c.bar.style.width = `${pct}%`;
      c.el.dataset.state = r.state;
      c.state.textContent = STATE_LABEL[r.state];
      let order = "";
      if (r.state === "routing" || r.state === "gone") order = "";
      else if (r.engaged) order = "Combatiendo";
      else if (r.firing) order = "Disparando";
      else if (r.order.kind === "attack") order = r.running ? "Cargando" : "Atacando";
      else if (r.path.length) order = "En marcha";
      c.order.textContent = order;
    };
    for (const [r, c] of this.cards) {
      fill(r, c);
      c.el.classList.toggle("selected", this.controls.selected.has(r));
      c.el.classList.toggle("disabled", !r.active);
      const d = c.el.querySelector<HTMLButtonElement>(".disband");
      if (d) { d.disabled = r.engaged || !r.active; d.title = r.engaged ? "No se puede licenciar en pleno combate" : "Los supervivientes vuelven a casa y a trabajar"; }
    }
    // La guarnición de Montfort solo aparece cuando está en acción
    let shown = 0;
    for (const [r, c] of this.enemies) {
      fill(r, c);
      const hide = !!r.guard && r.order.kind !== "attack" && !r.engaged;
      c.el.hidden = hide;
      if (!hide) shown++;
    }

    const b = this.battle;
    this.bar.hidden = this.cards.size === 0;
    this.enemyList.hidden = shown === 0;
    if (this.campaign) {
      const info = this.campaign.banner();
      this.banner.hidden = !info;
      if (info) { this.banner.dataset.kind = info.kind; this.bannerText.textContent = info.text; }
      if (this.bannerBtn) {
        const act = info?.action;
        this.bannerBtn.hidden = !act;
        if (act) { this.bannerBtn.textContent = act.label; this.bannerBtn.onclick = () => { act.run(); this.bannerBtn!.blur(); }; }
      }
      return;
    }
    if (b.result !== null) {
      this.banner.dataset.kind = b.result === 0 ? "win" : "lose";
      this.bannerText.textContent = b.result === 0 ? "¡Victoria! Los bandidos huyen." : "Derrota. La aldea ha caído.";
      this.bannerBtn!.textContent = "Repetir batalla (R)";
      this.banner.hidden = false;
    } else if (!b.started) {
      this.banner.dataset.kind = "deploy";
      this.bannerText.textContent = "Despliegue: coloca tus tropas. Los bandidos esperan al oeste.";
      this.bannerBtn!.textContent = "Comenzar batalla (Intro)";
      this.banner.hidden = false;
    } else {
      this.banner.hidden = true;
    }
    const m = Math.floor(b.time / 60), s = Math.floor(b.time % 60);
    if (this.status) this.status.textContent = `${paused ? "En pausa · " : ""}${speed}× · ${m}:${String(s).padStart(2, "0")}`;
  }
}
