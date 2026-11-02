import * as THREE from "three";
import { Village } from "../settlement/village";
import { Battle, Regiment } from "../combat/battle";
import { Regions, Region } from "../world/regions";
import { Terrain, RIVAL_SEAT } from "../world/terrain";
import { NavGrid } from "../world/navgrid";
import { buildingModel, keepModel } from "../settlement/models";
import { UnitKind } from "../data/units";

export const RIVAL_NAME = "el señor de Montfort";
const CLAIM_EVERY = 16;          // días entre tierras que reclama
const FIRST_CLAIM = 20;
const REINFORCE_EVERY = 12;      // días entre refuerzos de la guarnición
const HOLD_SECONDS = 15;         // ocupar el estandarte de una tierra suya
const HOLD_CAPITAL = 30;         // y el de su castro
const HOLD_RADIUS = 20;          // tus tropas, a menos de esto del estandarte
const CONTEST_RADIUS = 45;       // ningún enemigo activo a menos de esto

/** La guarnición del castro: tipo, tamaño, nombre y puesto (respecto al castro). */
const GARRISON: { kind: UnitKind; n: number; name: string; dx: number; dz: number }[] = [
  { kind: "spear", n: 32, name: "Guardia de Montfort", dx: -26, dz: 0 },
  { kind: "archer", n: 18, name: "Arqueros de Montfort", dx: -12, dz: 12 },
  { kind: "militia", n: 24, name: "Mesnada de Montfort", dx: -24, dz: -18 },
];

/**
 * El señor rival: su castro al este del río con guarnición, tierras que va reclamando
 * y huestes que manda contra la aldea (la campaña las programa como incursiones).
 * Se le quitan las tierras ocupando sus estandartes; si cae el castro, se rinde.
 */
export class Rival {
  alive = true;
  readonly group = new THREE.Group();
  garrison: Regiment[] = [];
  nextClaim = FIRST_CLAIM;
  nextReinforce = REINFORCE_EVERY;
  hold = new Map<number, number>();       // tierra → segundos ocupada
  onDefeat: (() => void) | null = null;
  taken = 0;                              // tierras que le has quitado

  constructor(private village: Village, private battle: Battle, private regions: Regions, terrain: Terrain, nav: NavGrid) {
    // El castro: torre del homenaje, casas, cuartel y campos (decorado; ocupa el suelo para la navegación)
    const S = RIVAL_SEAT;
    const place = (g: THREE.Group, x: number, z: number, rot: number, w: number, d: number) => {
      g.position.set(S.x + x, terrain.heightAt(S.x + x, S.z + z), S.z + z);
      g.rotation.y = rot * Math.PI / 2;
      this.group.add(g);
      const hw = (rot % 2 ? d : w) / 2, hd = (rot % 2 ? w : d) / 2;
      nav.setOccupied(S.x + x - hw, S.z + z - hd, S.x + x + hw, S.z + z + hd, true);
    };
    place(keepModel(), 6, 0, 3, 10, 10);
    const houses: [number, number, number][] = [[-6, -16, 0], [6, -18, 0], [16, -10, 3], [-6, 16, 2], [6, 18, 2], [17, 10, 3], [24, 0, 3]];
    for (const [x, z, r] of houses) place(buildingModel("house"), x, z, r, 7, 7);
    place(buildingModel("barracks"), -8, -32, 0, 12, 10);
    place(buildingModel("storehouse"), -8, 30, 2, 11, 8);
    // Campos labrados alrededor
    const fieldMat = new THREE.MeshStandardMaterial({ color: "#b49a52", flatShading: true });
    for (const [x, z] of [[40, -24], [42, 20]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(18, 0.3, 14), fieldMat);
      f.position.set(S.x + x, terrain.heightAt(S.x + x, S.z + z) + 0.1, S.z + z);
      f.receiveShadow = true;
      this.group.add(f);
    }
  }

  get seat(): Region { return this.regions.capital; }

  /** Forma la guarnición al empezar la partida. */
  setup() {
    this.garrison = GARRISON.map((g) => this.spawnGuard(g));
  }

  private spawnGuard(g: typeof GARRISON[number]): Regiment {
    const S = RIVAL_SEAT, facing = -Math.PI / 2;   // mirando al oeste, hacia la aldea
    const r = this.battle.spawn(1, g.name, g.kind, S.x + g.dx, S.z + g.dz, facing, g.n);
    r.guard = { x: S.x + g.dx, z: S.z + g.dz, r: 85, facing };
    return r;
  }

  /** Fuerza de Montfort: crece con sus tierras. */
  get strength() { return this.regions.count("rival"); }

  update(dt: number) {
    if (!this.alive) return;
    const v = this.village, day = v.day;
    this.garrison = this.garrison.filter((r) => this.battle.regiments.includes(r) && r.state !== "gone");

    // Reclama tierras libres que lindan con las suyas
    if (day >= this.nextClaim) {
      this.nextClaim = day + CLAIM_EVERY;
      const free = this.regions.list.filter((r) => !r.owner && r.neighbors.some((id) => this.regions.list[id].owner === "rival"));
      if (free.length) {
        const S = this.seat.center;
        free.sort((a, b) => Math.hypot(a.center.x - S.x, a.center.z - S.z) - Math.hypot(b.center.x - S.x, b.center.z - S.z));
        free[0].owner = "rival";
        this.regions.version++;
        v.event(`El señor de Montfort reclama ${free[0].name}`, "bad");
      }
    }
    // Rehace la guarnición perdida
    if (day >= this.nextReinforce) {
      this.nextReinforce = day + REINFORCE_EVERY;
      for (const g of GARRISON) if (!this.garrison.some((r) => r.name === g.name)) {
        this.garrison.push(this.spawnGuard(g));
        v.event(`Montfort rehace su guarnición: ${g.name.toLowerCase()}`, "info");
        break;
      }
    }

    // Ocupar estandartes de Montfort
    for (const reg of this.regions.list) {
      if (reg.owner !== "rival") { this.hold.delete(reg.id); continue; }
      const f = reg.center;
      const mine = this.battle.regiments.some((r) => r.team === 0 && r.active && Math.hypot(r.cx - f.x, r.cz - f.z) < HOLD_RADIUS);
      const foes = this.battle.regiments.some((r) => r.team === 1 && r.active && Math.hypot(r.cx - f.x, r.cz - f.z) < CONTEST_RADIUS);
      const t = this.hold.get(reg.id) ?? 0;
      if (mine && !foes) {
        const need = reg.capital ? HOLD_CAPITAL : HOLD_SECONDS;
        if (t === 0) v.event(`Tus tropas ocupan el estandarte de ${reg.name}: aguanta ${need} s sin enemigos cerca`, "info");
        if (t + dt >= need) this.take(reg);
        else this.hold.set(reg.id, t + dt);
      } else if (t > 0) this.hold.set(reg.id, Math.max(0, t - dt * 0.5));
    }
  }

  /** Progreso de ocupación (0–1) de la tierra que más avanza, para el aviso. */
  get capturing(): { region: Region; p: number } | null {
    let best: { region: Region; p: number } | null = null;
    for (const [id, t] of this.hold) {
      const reg = this.regions.list[id];
      if (t <= 0) continue;
      const p = t / (reg.capital ? HOLD_CAPITAL : HOLD_SECONDS);
      if (!best || p > best.p) best = { region: reg, p };
    }
    return best;
  }

  private take(reg: Region) {
    this.hold.delete(reg.id);
    const v = this.village;
    if (reg.capital) {
      // Se rinde: todas sus tierras pasan a ser tuyas y su gente depone las armas
      for (const r of this.regions.list) if (r.owner === "rival") r.owner = "player";
      this.regions.version++;
      this.alive = false;
      for (const r of this.battle.regiments) if (r.team === 1 && r.guard) { r.guard = null; r.morale = 0; }
      v.addMod("Victoria sobre Montfort", 25, 15);
      v.event("¡El castro de Montfort ha caído! El señor de Montfort se rinde y sus tierras son tuyas", "good");
      this.onDefeat?.();
      return;
    }
    reg.owner = "player";
    this.taken++;
    this.regions.version++;
    v.addMod("Tierras ganadas a Montfort", 8, 6);
    v.event(`${reg.name} es tuya: Montfort pierde una tierra`, "good");
  }

  serialize() {
    return { alive: this.alive, nextClaim: this.nextClaim, nextReinforce: this.nextReinforce, taken: this.taken };
  }
  restore(d: { alive: boolean; nextClaim: number; nextReinforce: number; taken?: number }) {
    this.alive = d.alive; this.nextClaim = d.nextClaim; this.nextReinforce = d.nextReinforce; this.taken = d.taken ?? 0;
  }
}

