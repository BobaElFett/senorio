import { Village, LevyKind, LEVY } from "../settlement/village";
import { Battle, Regiment } from "../combat/battle";
import { UnitKind } from "../data/units";
import { P } from "../world/navgrid";
import { DAY_SECONDS } from "../data/buildings";

/**
 * La partida: une aldea y combate en el mismo mapa.
 *  - Leva: el cuartel convierte familias en regimientos (4 hombres por familia)
 *  - Incursiones: tres ataques de bandidos cada vez más fuertes, con aviso previo
 *  - Si nadie los frena, saquean la aldea un día y se van con el botín
 *  - Sobrevivir a las tres termina la partida
 */

interface RaidSpec { day: number; name: string; from: P; units: [UnitKind, number, string][] }

const RAIDS: RaidSpec[] = [
  { day: 20, name: "Una banda de ladrones", from: { x: -175, z: 10 },
    units: [["militia", 22, "Ladrones"]] },
  { day: 38, name: "Los saqueadores del bosque", from: { x: -175, z: -40 },
    units: [["militia", 26, "Saqueadores"], ["archer", 14, "Arqueros bandidos"]] },
  { day: 58, name: "La hueste del barón bandido", from: { x: -175, z: 30 },
    units: [["spear", 30, "Lanceros del barón"], ["militia", 26, "Mesnada"], ["archer", 18, "Ballesteros"]] },
];
const WARNING_DAYS = 2;
const PLUNDER_DAYS = 1;
const MEN_PER_FAMILY = 4;

export type Phase = "calm" | "warning" | "raid" | "plunder" | "withdraw" | "won" | "lost";

export class Campaign {
  raidIndex = 0;
  phase: Phase = "calm";
  raiders: Regiment[] = [];
  plunderTime = 0;
  withdrawTime = 0;
  loot = { wood: 0, food: 0, coins: 0 };
  results: ("victoria" | "saqueo")[] = [];
  private levyCount: Record<LevyKind, number> = { spear: 0, archer: 0 };
  private lastFamilies = 0;

  constructor(public village: Village, public battle: Battle) {
    battle.campaign = true;
    battle.started = true;
    battle.onCasualty = (s) => { if (s.family) village.casualty(s.family); };
  }

  get raid(): RaidSpec | null { return RAIDS[this.raidIndex] ?? null; }
  get totalRaids() { return RAIDS.length; }

  /** Texto del aviso de la parte superior (o null si no hay nada que avisar). */
  banner(): { text: string; kind: "warn" | "raid" | "good" | "bad" } | null {
    const v = this.village, r = this.raid;
    if (this.phase === "won") {
      const wins = this.results.filter((x) => x === "victoria").length;
      if (wins === RAIDS.length) return { text: `¡Has defendido el señorío! Rechazaste las ${RAIDS.length} incursiones. Fin de la partida.`, kind: "good" };
      if (wins === 0) return { text: `La aldea sobrevive, pero los bandidos la saquearon las ${RAIDS.length} veces. Fin de la partida.`, kind: "bad" };
      return { text: `La aldea resiste: rechazaste ${wins} de ${RAIDS.length} incursiones. Fin de la partida.`, kind: "warn" };
    }
    if (this.phase === "lost") return { text: "La aldea ha quedado desierta. Fin de la partida.", kind: "bad" };
    if (!r) return null;
    if (this.phase === "warning") {
      const left = Math.max(0, r.day - v.day);
      return { text: `Bandidos al oeste (${r.name.toLowerCase()}): llegan en ${left < 1 ? Math.ceil(left * 24) + " horas" : Math.ceil(left) + " días"}. Recluta en el cuartel.`, kind: "warn" };
    }
    if (this.phase === "raid") return { text: `Incursión ${this.raidIndex + 1}/${RAIDS.length}: ${r.name}. Sal a su encuentro antes de que lleguen a la aldea.`, kind: "raid" };
    if (this.phase === "plunder") return { text: `¡Saqueo! Los bandidos se llevan las provisiones y nadie trabaja.`, kind: "bad" };
    if (this.phase === "withdraw") return { text: `Los bandidos se retiran con el botín.`, kind: "bad" };
    return null;
  }

  // ------------------------------------------------------------ leva
  levy(kind: LevyKind): Regiment | null {
    const v = this.village;
    const plan = v.levyPlan(kind);
    if (!plan.ok) return null;
    const barracks = v.buildings.find((b) => b.built && b.type.kind === "barracks")!;
    const fams = plan.families;
    const men = fams.reduce((s, f) => s + Math.min(MEN_PER_FAMILY, f.members), 0);
    const n = ++this.levyCount[kind];
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][(n - 1) % 10];
    const facing = Math.atan2(barracks.door.x - barracks.x, barracks.door.z - barracks.z);
    // Soldado i → familia: se reparten en el orden de las familias
    const owners: number[] = [];
    for (const f of fams) for (let k = 0; k < Math.min(MEN_PER_FAMILY, f.members); k++) owners.push(f.id);
    const ahead = { x: barracks.door.x + Math.sin(facing) * 6, z: barracks.door.z + Math.cos(facing) * 6 };
    const reg = this.battle.spawn(0, `${LEVY[kind].label} ${roman}`, kind, ahead.x, ahead.z, facing, men, (i) => owners[i] ?? 0);
    v.applyLevy(kind, fams, reg.id);
    return reg;
  }

  /** Licenciar: los supervivientes vuelven a casa y a trabajar. */
  disband(r: Regiment) {
    if (r.team !== 0 || r.engaged) return;
    this.village.returnFromLevy(r.id, { x: r.cx, z: r.cz });
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

    const r = this.raid;
    if (this.phase === "calm" && r && v.day >= r.day - WARNING_DAYS) {
      this.phase = "warning";
      v.event(`¡Bandidos! Llegan en ${WARNING_DAYS} días: ${r.name.toLowerCase()}`, "bad");
    }
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
        for (const k of ["wood", "food", "coins"] as const) {
          const take = v.res[k] * 0.3 * dd / PLUNDER_DAYS;
          v.res[k] -= take; this.loot[k] += take;
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
        const from = r ? r.from : { x: -175, z: 0 };
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
    const facing = Math.atan2(-r.from.x, -r.from.z);
    this.raiders = r.units.map(([kind, n, name], i) => {
      const off = (i - (r.units.length - 1) / 2) * 26;
      const x = r.from.x + Math.cos(facing) * off, z = r.from.z - Math.sin(facing) * off;
      return this.battle.spawn(1, name, kind, x, z, facing, n);
    });
    this.village.event(`Han llegado ${this.raiders.reduce((s, x) => s + x.count, 0)} bandidos: ${r.name.toLowerCase()}`, "bad");
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
    this.phase = this.raidIndex >= RAIDS.length ? "won" : "calm";
    if (this.phase === "won") this.village.event("Has sobrevivido a las tres incursiones", "good");
  }
}
