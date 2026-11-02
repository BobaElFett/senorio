import { Village, LevyKind, LEVY, isLevyKind } from "../settlement/village";
import { Battle, Regiment } from "../combat/battle";
import { UnitKind } from "../data/units";
import { P } from "../world/navgrid";
import { DAY_SECONDS, TOWER_RANGE, TOWER_RELOAD, TOWER_DAMAGE } from "../data/buildings";

/**
 * La partida: une aldea y combate en el mismo mapa.
 *  - Leva: el cuartel convierte familias en regimientos (4 hombres por familia)
 *  - Incursiones: tres ataques de bandidos cada vez más fuertes, con aviso previo
 *  - Si nadie los frena, saquean la aldea un día y se van con el botín
 *  - Sobrevivir a las tres termina la partida
 */

/** Cada grupo puede llegar por su lado (`from`); si no, por el de la incursión. */
type RaidUnit = [UnitKind, number, string, P?];
interface RaidSpec { day: number; name: string; from: P; units: RaidUnit[] }

// Entradas al mapa (−x es el oeste, −z el norte)
const ENTRY = {
  oeste: { x: -175, z: 10 }, noroeste: { x: -120, z: -125 }, norte: { x: -40, z: -170 },
  suroeste: { x: -115, z: 130 }, sur: { x: -10, z: 170 }, este: { x: 168, z: 20 },
};

/** «al oeste», «al norte»... según de dónde llegan. */
export function sideName(p: P): string {
  const a = Math.atan2(p.x, -p.z) * 180 / Math.PI;   // 0 = norte, 90 = este
  const names = ["al norte", "al noreste", "al este", "al sureste", "al sur", "al suroeste", "al oeste", "al noroeste"];
  return names[((Math.round(a / 45) % 8) + 8) % 8];
}

const RAIDS: RaidSpec[] = [
  { day: 20, name: "Una banda de ladrones", from: { x: -175, z: 10 },
    units: [["militia", 22, "Ladrones"]] },
  { day: 38, name: "Los saqueadores del bosque", from: { x: -175, z: -40 },
    units: [["militia", 24, "Saqueadores"], ["archer", 14, "Arqueros bandidos"], ["militia", 12, "Merodeadores", ENTRY.norte]] },
  { day: 58, name: "La hueste del barón bandido", from: { x: -175, z: 30 },
    units: [["spear", 30, "Lanceros del barón"], ["archer", 18, "Ballesteros"], ["militia", 26, "Mesnada", ENTRY.suroeste], ["cavalry", 10, "Jinetes del barón", ENTRY.suroeste]] },
];
export type Difficulty = "facil" | "normal" | "dificil";
export const DIFFICULTY: Record<Difficulty, { label: string; size: number; delay: number; note: string }> = {
  facil: { label: "Fácil", size: 0.75, delay: 6, note: "Bandidos menos numerosos y más tarde." },
  normal: { label: "Normal", size: 1, delay: 0, note: "La partida tal como está pensada." },
  dificil: { label: "Difícil", size: 1.3, delay: -4, note: "Más bandidos y antes." },
};

const WARNING_DAYS = 2;
const PLUNDER_DAYS = 1;

export type Phase = "calm" | "warning" | "raid" | "plunder" | "withdraw" | "won" | "lost";

export class Campaign {
  raidIndex = 0;
  phase: Phase = "calm";
  raiders: Regiment[] = [];
  plunderTime = 0;
  withdrawTime = 0;
  loot = { wood: 0, food: 0, coins: 0 };
  results: ("victoria" | "saqueo")[] = [];
  private levyCount: Record<LevyKind, number> = { spear: 0, archer: 0, cavalry: 0 };
  difficulty: Difficulty = "normal";
  endless = false;              // tras las tres incursiones, seguir con ataques cada vez mayores
  private lastFamilies = 0;

  constructor(public village: Village, public battle: Battle) {
    battle.campaign = true;
    battle.started = true;
    battle.onCasualty = (s) => { if (s.family) village.casualty(s.family); };
  }

  /** Incursión i ajustada a la dificultad; en modo libre se generan sin fin. */
  raidAt(i: number): RaidSpec | null {
    const d = DIFFICULTY[this.difficulty];
    let base: RaidSpec | undefined = RAIDS[i];
    if (!base) {
      if (!this.endless) return null;
      const k = i - RAIDS.length + 1;
      // Dos frentes que van cambiando: el grueso por un lado y la caballería con la mesnada por otro
      const sides = [ENTRY.oeste, ENTRY.noroeste, ENTRY.suroeste, ENTRY.norte, ENTRY.sur, ENTRY.este];
      const main = sides[k % sides.length], other = sides[(k * 3 + 1) % sides.length];
      base = {
        day: RAIDS[RAIDS.length - 1].day + 20 * k, name: `La ${i + 1}.ª incursión`, from: main,
        units: [["spear", 30 + 6 * k, "Lanceros"], ["archer", 18 + 4 * k, "Ballesteros"], ["militia", 26 + 5 * k, "Mesnada", other], ["cavalry", 10 + 2 * k, "Jinetes", other]],
      };
    }
    return {
      ...base,
      day: base.day + d.delay,
      units: base.units.map(([kind, n, name, from]) => [kind, Math.max(8, Math.round(n * d.size)), name, from] as RaidUnit),
    };
  }
  get raid(): RaidSpec | null {
    const r = this.raidAt(this.raidIndex);
    return r && this.raidIndex >= RAIDS.length ? { ...r, day: r.day + this.endlessShift } : r;
  }
  get totalRaids() { return RAIDS.length; }

  /** Seguir jugando tras ganar: incursiones sin fin. */
  continueEndless() {
    if (this.phase !== "won") return;
    this.endless = true;
    this.phase = "calm";
    // La siguiente incursión, al menos 10 días después de hoy
    const next = this.raidAt(this.raidIndex);
    if (next && next.day < this.village.day + 10) this.endlessShift = this.village.day + 10 - next.day;
    this.village.event("Modo libre: las incursiones seguirán, cada vez mayores", "info");
  }
  endlessShift = 0;
  private towerReload = new Map<number, number>();

  /** Torres con vigía: avisan antes y disparan a los bandidos que se acercan. */
  private get watchTowers() { return this.village.buildings.filter((b) => b.built && b.type.kind === "tower" && b.workers.length > 0); }

  private updateTowers(dt: number) {
    for (const t of this.watchTowers) {
      const left = (this.towerReload.get(t.id) ?? 0) - dt;
      this.towerReload.set(t.id, left);
      if (left > 0) continue;
      // El bandido vivo más cercano a tiro
      let best: { x: number; z: number } | null = null, bd = TOWER_RANGE;
      for (const r of this.battle.regiments) {
        if (r.team !== 1 || !r.alive.length || r.state === "gone") continue;
        if (Math.hypot(r.cx - t.x, r.cz - t.z) > TOWER_RANGE + 20) continue;
        for (const s of r.alive) {
          const d = Math.hypot(s.x - t.x, s.z - t.z);
          if (d < bd) { bd = d; best = s; }
        }
      }
      if (!best) continue;
      this.towerReload.set(t.id, TOWER_RELOAD * (0.85 + Math.random() * 0.3));
      const spread = 0.8 + bd / 40;
      const top = this.village.terrain.heightAt(t.x, t.z) + 8;
      this.battle.shoot(t.x, top, t.z, best.x + (Math.random() - 0.5) * spread, best.z + (Math.random() - 0.5) * spread, 0, TOWER_DAMAGE);
    }
  }

  /** Texto del aviso de la parte superior (o null si no hay nada que avisar). */
  banner(): { text: string; kind: "warn" | "raid" | "good" | "bad"; action?: { label: string; run: () => void } } | null {
    const v = this.village, r = this.raid;
    if (this.phase === "won") {
      const wins = this.results.filter((x) => x === "victoria").length;
      const more = { label: "Seguir jugando (modo libre)", run: () => this.continueEndless() };
      if (wins === RAIDS.length) return { text: `¡Has defendido el señorío! Rechazaste las ${RAIDS.length} incursiones.`, kind: "good", action: more };
      if (wins === 0) return { text: `La aldea sobrevive, pero los bandidos la saquearon las ${RAIDS.length} veces.`, kind: "bad", action: more };
      return { text: `La aldea resiste: rechazaste ${wins} de ${RAIDS.length} incursiones.`, kind: "warn", action: more };
    }
    if (this.phase === "lost") return { text: "La aldea ha quedado desierta. Fin de la partida.", kind: "bad" };
    if (!r) return null;
    if (this.phase === "warning") {
      const left = Math.max(0, r.day - v.day);
      return { text: `Bandidos ${this.sides(r)} (${r.name.toLowerCase()}): llegan en ${left < 1 ? Math.ceil(left * 24) + " horas" : Math.ceil(left) + " días"}. Recluta en el cuartel.`, kind: "warn" };
    }
    if (this.phase === "raid") return { text: `Incursión ${this.raidIndex + 1}${this.endless ? "" : "/" + RAIDS.length}: ${r.name}. Sal a su encuentro antes de que lleguen a la aldea.`, kind: "raid" };
    if (this.phase === "plunder") return { text: `¡Saqueo! Los bandidos se llevan las provisiones y nadie trabaja.`, kind: "bad" };
    if (this.phase === "withdraw") return { text: `Los bandidos se retiran con el botín.`, kind: "bad" };
    return null;
  }

  // ------------------------------------------------------------ leva
  levy(kind: LevyKind): Regiment | null {
    const v = this.village;
    const plan = v.levyPlan(kind);
    if (!plan.ok) return null;
    const spec = LEVY[kind];
    const barracks = v.buildings.find((b) => b.built && b.type.kind === spec.at)!;
    const fams = plan.families;
    const per = spec.men;
    const men = fams.reduce((s, f) => s + Math.min(per, f.members), 0);
    const n = ++this.levyCount[kind];
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][(n - 1) % 10];
    const facing = Math.atan2(barracks.door.x - barracks.x, barracks.door.z - barracks.z);
    // Soldado i → familia: se reparten en el orden de las familias
    const owners: number[] = [];
    for (const f of fams) for (let k = 0; k < Math.min(per, f.members); k++) owners.push(f.id);
    const ahead = { x: barracks.door.x + Math.sin(facing) * 6, z: barracks.door.z + Math.cos(facing) * 6 };
    const reg = this.battle.spawn(0, `${LEVY[kind].label} ${roman}`, kind, ahead.x, ahead.z, facing, men, (i) => owners[i] ?? 0);
    v.applyLevy(kind, fams, reg.id);
    return reg;
  }

  /** Licenciar: los supervivientes vuelven a casa y a trabajar. */
  disband(r: Regiment) {
    if (r.team !== 0 || r.engaged) return;
    this.village.returnFromLevy(r.id, { x: r.cx, z: r.cz }, isLevyKind(r.type.kind) ? r.type.kind : "spear");
    this.battle.removeRegiment(r);
    this.village.event(`${r.name} se licencia: ${r.count} hombres vuelven a casa`, "info");
  }

  // ------------------------------------------------------------ incursiones
  update(dt: number) {
    const v = this.village, b = this.battle;
    if (this.phase === "won" || this.phase === "lost") return;
    const dd = dt / DAY_SECONDS;
    const store = v.buildings.find((x) => x.type.kind === "storehouse");
    b.raidTarget = store ? store.door : { x: 0, z: 0 };

    // Regimientos dispersados del todo: los nuestros que huyeron vuelven a casa; los bandidos desaparecen
    for (const r of [...b.regiments]) {
      if (r.state !== "gone") continue;
      if (r.team === 0) v.returnFromLevy(r.id, { x: r.cx, z: r.cz });
      b.removeRegiment(r);
    }
    const up = v.upgrades;
    b.bonus[0] = { attack: up.arms, arrow: up.arms * 0.75, defense: up.armor, hp: up.armor * 1.5 };
    v.horses = b.regiments.reduce((n, x) => n + (x.team === 0 && x.type.mounted ? x.count : 0), 0);

    const r = this.raid;
    const lead = WARNING_DAYS + (this.watchTowers.length ? 1 : 0);
    if (this.phase === "calm" && r && v.day >= r.day - lead) {
      this.phase = "warning";
      v.event(`¡Bandidos ${this.sides(r)}! Llegan en ${lead} días: ${r.name.toLowerCase()}${lead > WARNING_DAYS ? " (los ha avistado la torre)" : ""}`, "bad");
    }
    this.updateTowers(dt);
    if (this.phase === "warning" && r && v.day >= r.day) this.startRaid(r);

    if (this.phase === "raid" || this.phase === "plunder") {
      const alive = this.raiders.filter((x) => x.active);
      if (!alive.length) { this.endRaid(true); return; }
      const plundering = alive.some((x) => x.plundering);
      if (plundering) {
        if (this.phase !== "plunder") { this.phase = "plunder"; v.event("Los bandidos han entrado en la aldea y saquean", "bad"); }
        v.underAttack = true;
        this.plunderTime += dd;
        // Se llevan un 30% de lo almacenado por día de saqueo
        for (const k of ["wood", "food", "coins", "flour", "bread", "planks"] as const) {
          const take = v.res[k] * 0.3 * dd / PLUNDER_DAYS;
          v.res[k] -= take;
          this.loot[k === "bread" || k === "flour" ? "food" : k === "planks" ? "wood" : k] += take;
        }
        if (this.plunderTime >= PLUNDER_DAYS) this.endRaid(false);
      } else {
        v.underAttack = false;
        if (this.phase === "plunder") this.phase = "raid";
      }
    }

    if (this.phase === "withdraw") {
      v.underAttack = false;
      this.withdrawTime += dd;
      // Se van por donde vinieron; desaparecen al llegar al borde o si huyen
      for (const x of this.raiders) {
        if (x.state === "gone") continue;
        const from = r ? this.homeOf(r, x) : { x: -175, z: 0 };
        if (x.active && (!x.path.length || x.order.kind !== "move")) b.orderMove(x, from.x, from.z, null, null);
        const arrived = Math.hypot(x.cx - from.x, x.cz - from.z) < 25 || (x.order.kind === "idle" && !x.path.length && this.withdrawTime > 0.2);
        if (arrived || x.state === "routing" || this.withdrawTime > 1.5) {
          b.removeRegiment(x);
          x.state = "gone";
        }
      }
      if (this.raiders.every((x) => x.state === "gone" || !b.regiments.includes(x))) this.nextRaid();
    }

    // Derrota: la aldea se ha quedado sin familias
    if (!v.families.length) { this.phase = "lost"; v.event("La aldea ha quedado desierta", "bad"); }
    this.lastFamilies = v.families.length;
  }

  private startRaid(r: RaidSpec) {
    this.phase = "raid";
    this.plunderTime = 0;
    this.loot = { wood: 0, food: 0, coins: 0 };
    // Cada grupo forma en línea en su entrada
    this.raiders = [];
    for (const from of this.entries(r)) {
      const group = r.units.filter((u) => (u[3] ?? r.from) === from);
      const facing = Math.atan2(-from.x, -from.z);
      group.forEach(([kind, n, name], i) => {
        const off = (i - (group.length - 1) / 2) * 26;
        const x = from.x + Math.cos(facing) * off, z = from.z - Math.sin(facing) * off;
        this.raiders.push(this.battle.spawn(1, name, kind, x, z, facing, n));
      });
    }
    this.village.event(`Han llegado ${this.raiders.reduce((s, x) => s + x.count, 0)} bandidos ${this.sides(r)}: ${r.name.toLowerCase()}`, "bad");
  }

  /** Entradas distintas por las que llega una incursión. */
  entries(r: RaidSpec): P[] {
    const out: P[] = [];
    for (const u of r.units) { const f = u[3] ?? r.from; if (!out.includes(f)) out.push(f); }
    return out;
  }
  /** «al oeste y al norte». */
  sides(r: RaidSpec): string {
    const names = [...new Set(this.entries(r).map(sideName))];
    return names.length > 1 ? names.slice(0, -1).join(", ") + " y " + names[names.length - 1] : names[0];
  }
  /** Entrada de la incursión más cercana a un regimiento (por donde se retira). */
  private homeOf(r: RaidSpec, x: Regiment): P {
    let best = r.from, bd = Infinity;
    for (const f of this.entries(r)) { const d = Math.hypot(f.x - x.cx, f.z - x.cz); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  private endRaid(victory: boolean) {
    const v = this.village;
    v.underAttack = false;
    if (victory) {
      this.results.push("victoria");
      const bounty = 15 * (this.raidIndex + 1);
      v.res.coins += bounty;
      v.addMod("Victoria sobre los bandidos", 15, 6);
      v.event(`¡Victoria! Los bandidos huyen. Botín: ${bounty} monedas`, "good");
      for (const x of this.raiders) if (this.battle.regiments.includes(x)) this.battle.removeRegiment(x);
      this.nextRaid();
    } else {
      this.results.push("saqueo");
      v.addMod("La aldea fue saqueada", -20, 8);
      v.event(`Saqueo: se llevan ${Math.round(this.loot.food)} comida, ${Math.round(this.loot.wood)} madera y ${Math.round(this.loot.coins)} monedas`, "bad");
      this.phase = "withdraw";
      this.withdrawTime = 0;
      for (const x of this.raiders) { x.withdrawing = true; x.plundering = false; }
    }
  }

  private nextRaid() {
    this.raiders = [];
    this.raidIndex++;
    this.phase = this.raidIndex >= RAIDS.length && !this.endless ? "won" : "calm";
    if (this.phase === "won") this.village.event("Has sobrevivido a las tres incursiones", "good");
    else if (this.endless) this.village.event(`Incursión ${this.raidIndex} superada. La próxima será mayor.`, "info");
  }
}
