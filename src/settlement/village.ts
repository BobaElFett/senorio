import { Terrain, MAP_SIZE } from "../world/terrain";
import { NavGrid, P } from "../world/navgrid";
import { Forest, Tree } from "../world/forest";
import {
  BUILDINGS, BuildingKind, BuildingType, Resource, RESOURCE_LABEL, RESOURCES,
  MILL_PER_WORKER, MILL_RESERVE, BAKE_PER_WORKER, BREAD_PER_FLOUR,
  DAY_SECONDS, DAYS_PER_SEASON, SEASONS, BASE_STORAGE, FOOD_PER_FAMILY, FIREWOOD_PER_HOUSE,
  WOOD_PER_WORKER, FARM_YIELD, TAX_PER_FAMILY,
} from "../data/buildings";

export interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }

export interface Building {
  id: number;
  type: BuildingType;
  x: number; z: number;
  rot: number;              // 0–3, giros de 90°
  built: boolean;
  progress: number;         // 0–1 mientras se construye
  workers: Family[];
  residents: Family[];
  cutAcc: number;           // madera acumulada hasta talar el siguiente árbol
  rect: Rect;               // huella del edificio
  fieldRect: Rect | null;   // parcela (granja)
  door: P;
}

export interface Villager {
  x: number; z: number; y: number;
  heading: number;
  path: P[];
  goalKey: string;
  visible: boolean;
  working: boolean;
  anim: number;
  tree: Tree | null;
  spot: P | null;
}

export interface Family {
  id: number;
  name: string;
  home: Building | null;
  work: Building | null;
  site: Building | null;    // obra donde ayuda (si no tiene trabajo)
  members: number;          // hombres en edad de luchar (4 al llegar)
  levied: number | null;    // id del regimiento en el que sirve
  prevWork: Building | null; // trabajo que dejó para ir a la leva
  v: Villager;
}

export interface Modifier { label: string; value: number; until: number }

export type LevyKind = "spear" | "archer";
export const LEVY: Record<LevyKind, { label: string; maxFamilies: number; wood: number; coins: number }> = {
  spear: { label: "Lanceros", maxFamilies: 8, wood: 2, coins: 1 },   // coste por familia
  archer: { label: "Arqueros", maxFamilies: 6, wood: 3, coins: 2 },
};
export const MIN_LEVY = 3;

export interface VillageEvent { id: number; text: string; kind: "good" | "bad" | "info" }

export interface ApprovalFactor { label: string; value: number }

const SURNAMES = ["Puig", "Ferrer", "Soler", "Vidal", "Roca", "Serra", "Font", "Mas", "Pons", "Riera", "Costa", "Martí",
  "Bosch", "Sala", "Prat", "Camps", "Vila", "Torres", "Valls", "Casas", "Rius", "Coll", "Grau", "Pujol", "Sants", "Vives"];

export const fwdOf = (rot: number): P => ({ x: Math.round(Math.sin(rot * Math.PI / 2)), z: Math.round(Math.cos(rot * Math.PI / 2)) });

/**
 * Simulación de la aldea: tiempo y estaciones, recursos, edificios, obras,
 * familias con casa y trabajo, aprobación, llegada y marcha de familias.
 */
export class Village {
  day = 0.27;                          // días desde el inicio (fracción = hora del día)
  res: Record<Resource, number> = { wood: 0, food: 0, coins: 0, flour: 0, bread: 0 };
  rates: Record<Resource, number> = { wood: 0, food: 0, coins: 0, flour: 0, bread: 0 };
  breadShare = 0;                      // parte de lo que se come que es pan (0–1)
  /** Comida total: grano y pan. */
  get foodTotal() { return this.res.food + this.res.bread; }
  buildings: Building[] = [];
  families: Family[] = [];
  approval = 60;
  approvalTarget = 60;
  factors: ApprovalFactor[] = [];
  events: VillageEvent[] = [];
  hungry = false;
  cold = false;
  underAttack = false;               // durante un saqueo no se trabaja
  /** Equipos guardados en el cuartel (por familia) de regimientos licenciados. */
  equipment: Record<LevyKind, number> = { spear: 0, archer: 0 };
  mods: Modifier[] = [];
  version = 0;
  private nextId = 1;
  private nextEvent = 1;
  private arriveTimer = 0;
  private leaveTimer = 0;
  private fullWarned = -99;
  private nameIdx = 0;

  constructor(public terrain: Terrain, public nav: NavGrid, public forest: Forest) {}

  // ------------------------------------------------------------ calendario
  get season() { return Math.floor(this.day / DAYS_PER_SEASON) % 4; }
  get seasonName() { return SEASONS[this.season]; }
  get dayOfSeason() { return Math.floor(this.day % DAYS_PER_SEASON) + 1; }
  get year() { return Math.floor(this.day / (DAYS_PER_SEASON * 4)) + 1; }
  get hour() { return this.day % 1; }
  /** Estación continua (0 = primavera … 4) para transiciones suaves. */
  get seasonFloat() { return (this.day / DAYS_PER_SEASON) % 4; }

  capacity(): number {
    return BASE_STORAGE + this.buildings.reduce((s, b) => s + (b.built ? b.type.storage : 0), 0);
  }
  get houses() { return this.buildings.filter((b) => b.built && b.type.housing > 0); }
  get homeless() { return this.families.filter((f) => !f.home); }
  get idle() { return this.families.filter((f) => !f.work && f.levied === null); }
  get atHome() { return this.families.filter((f) => f.levied === null); }
  has(kind: BuildingKind) { return this.buildings.some((b) => b.built && b.type.kind === kind); }

  addMod(label: string, value: number, days: number) {
    this.mods = this.mods.filter((m) => m.label !== label);
    this.mods.push({ label, value, until: this.day + days });
  }

  event(text: string, kind: VillageEvent["kind"] = "info") {
    this.events.push({ id: this.nextEvent++, text, kind });
    if (this.events.length > 30) this.events.shift();
  }

  // ------------------------------------------------------------ montaje
  setup() {
    this.version++;
    this.res = { wood: 30, food: 40, coins: 35, flour: 0, bread: 0 };
    const place = (kind: BuildingKind, x: number, z: number, rot: number) => {
      const b = this.addBuilding(kind, x, z, rot, true);
      return b;
    };
    place("storehouse", 0, -2, 0);
    for (const [x, z, r] of [[-15, 16, 0], [-5, 18, 0], [6, 18, 0], [-17, -16, 2]] as const) place("house", x, z, r);
    const farm = place("farm", 20, -6, 1);
    const wc = this.findWoodcutterSpot();
    const cutter = place("woodcutter", wc.x, wc.z, wc.rot);
    for (let i = 0; i < 5; i++) this.newFamily();
    this.assign(farm); this.assign(farm); this.assign(cutter);
    this.event("Primavera, año 1. Cinco familias fundan la aldea.", "info");
  }

  /** Lugar para el leñador inicial: en el borde de la explanada, mirando al bosque más denso. */
  private findWoodcutterSpot(): { x: number; z: number; rot: number } {
    let best = { x: -40, z: 0, rot: 3 }, bestTrees = -1;
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      for (const r of [58, 66, 74]) {
        const x = Math.round(Math.sin(ang) * r), z = Math.round(Math.cos(ang) * r);
        const rot = (Math.round(ang / (Math.PI / 2)) % 4 + 4) % 4;
        if (x < -35) continue;  // el oeste queda libre para la batalla de prueba
        if (!this.canPlace("woodcutter", x, z, rot, true).ok) continue;
        const n = this.forest.within(x, z, 45).length;
        if (n > bestTrees) { bestTrees = n; best = { x, z, rot }; }
      }
    }
    return best;
  }

  private newFamily(): Family {
    const name = SURNAMES[this.nameIdx++ % SURNAMES.length];
    const home = this.houses.find((h) => h.residents.length < h.type.housing) ?? null;
    const start = home ? home.door : this.campfire();
    const f: Family = {
      id: this.nextId++, name, home, work: null, site: null, members: 4, levied: null, prevWork: null,
      v: { x: start.x, z: start.z, y: 0, heading: 0, path: [], goalKey: "", visible: true, working: false, anim: Math.random() * 6, tree: null, spot: null },
    };
    if (home) home.residents.push(f);
    this.families.push(f);
    return f;
  }

  campfire(): P {
    const s = this.buildings.find((b) => b.type.kind === "storehouse");
    return s ? { x: s.door.x + 6, z: s.door.z + 4 } : { x: 6, z: 6 };
  }

  // ------------------------------------------------------------ construcción
  rects(kind: BuildingKind, x: number, z: number, rot: number): { rect: Rect; field: Rect | null; door: P } {
    const t = BUILDINGS[kind];
    const odd = rot % 2 === 1;
    const w = odd ? t.d : t.w, d = odd ? t.w : t.d;
    const rect = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
    const f = fwdOf(rot);
    const depth = t.d;
    let field: Rect | null = null;
    if (t.field) {
      const fw = odd ? t.field.d : t.field.w, fd = odd ? t.field.w : t.field.d;
      const off = depth / 2 + t.field.d / 2 + 1.5;
      const cx = x + f.x * off, cz = z + f.z * off;
      field = { minX: cx - fw / 2, maxX: cx + fw / 2, minZ: cz - fd / 2, maxZ: cz + fd / 2 };
    }
    const door = { x: x + f.x * (depth / 2 + 1.4), z: z + f.z * (depth / 2 + 1.4) };
    return { rect, field, door };
  }

  canPlace(kind: BuildingKind, x: number, z: number, rot: number, free = false): { ok: boolean; reason: string } {
    const t = BUILDINGS[kind];
    const { rect, field } = this.rects(kind, x, z, rot);
    const lim = MAP_SIZE / 2 - 12;
    for (const r of [rect, field]) {
      if (!r) continue;
      if (r.minX < -lim || r.maxX > lim || r.minZ < -lim || r.maxZ > lim) return { ok: false, reason: "Demasiado cerca del borde" };
    }
    let lo = Infinity, hi = -Infinity;
    for (let px = rect.minX; px <= rect.maxX + 0.01; px += Math.max(1, (rect.maxX - rect.minX) / 5)) {
      for (let pz = rect.minZ; pz <= rect.maxZ + 0.01; pz += Math.max(1, (rect.maxZ - rect.minZ) / 5)) {
        const h = this.terrain.heightAt(px, pz);
        if (h < 0.6) return { ok: false, reason: "No se puede construir en el agua" };
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    if (hi - lo > 3.2) return { ok: false, reason: "Terreno demasiado empinado" };
    if (field) {
      for (let px = field.minX; px <= field.maxX; px += 2) for (let pz = field.minZ; pz <= field.maxZ; pz += 2) {
        if (this.terrain.heightAt(px, pz) < 0.4) return { ok: false, reason: "El campo cae en el agua" };
      }
    }
    for (const b of this.buildings) {
      for (const a of [rect, field]) for (const o of [b.rect, b.fieldRect]) {
        if (a && o && a.minX < o.maxX + 1 && a.maxX > o.minX - 1 && a.minZ < o.maxZ + 1 && a.maxZ > o.minZ - 1) {
          return { ok: false, reason: "Se solapa con " + b.type.label.toLowerCase() };
        }
      }
    }
    if (!free) {
      for (const [r, n] of Object.entries(t.cost) as [Resource, number][]) {
        if (this.res[r] < n) return { ok: false, reason: `Falta ${RESOURCE_LABEL[r].toLowerCase()} (${n})` };
      }
    }
    return { ok: true, reason: "" };
  }

  private addBuilding(kind: BuildingKind, x: number, z: number, rot: number, built: boolean): Building {
    const { rect, field, door } = this.rects(kind, x, z, rot);
    const b: Building = {
      id: this.nextId++, type: BUILDINGS[kind], x, z, rot, built, progress: built ? 1 : 0,
      workers: [], residents: [], cutAcc: 0, rect, fieldRect: field, door,
    };
    this.buildings.push(b);
    this.forest.clearRect(rect.minX, rect.minZ, rect.maxX, rect.maxZ);
    if (field) this.forest.clearRect(field.minX, field.minZ, field.maxX, field.maxZ);
    this.nav.setOccupied(rect.minX, rect.minZ, rect.maxX, rect.maxZ, true);
    return b;
  }

  place(kind: BuildingKind, x: number, z: number, rot: number): Building | null {
    if (!this.canPlace(kind, x, z, rot).ok) return null;
    for (const [r, n] of Object.entries(BUILDINGS[kind].cost) as [Resource, number][]) this.res[r] -= n;
    const b = this.addBuilding(kind, x, z, rot, false);
    if (!this.idle.length) this.event(`Nadie libre para construir: quita a alguien de su trabajo`, "bad");
    return b;
  }

  demolish(b: Building) {
    const i = this.buildings.indexOf(b);
    if (i < 0) return;
    // Devuelve la mitad del coste (todo si la obra no había empezado)
    const back = b.built ? 0.5 : b.progress < 0.05 ? 1 : 0.5;
    for (const [r, n] of Object.entries(b.type.cost) as [Resource, number][]) this.res[r] += Math.floor(n * back);
    for (const f of b.workers) f.work = null;
    for (const f of b.residents) f.home = null;
    for (const f of this.families) if (f.site === b) f.site = null;
    this.buildings.splice(i, 1);
    this.nav.setOccupied(b.rect.minX, b.rect.minZ, b.rect.maxX, b.rect.maxZ, false);
    this.rehouse();
  }

  assign(b: Building): boolean {
    if (!b.built || b.workers.length >= b.type.workers) return false;
    const pool = this.idle;
    if (!pool.length) return false;
    const f = pool.find((p) => p.home) ?? pool[0];
    f.work = b; f.site = null;
    b.workers.push(f);
    return true;
  }

  unassign(b: Building): boolean {
    const f = b.workers.pop();
    if (!f) return false;
    f.work = null;
    return true;
  }

  private rehouse() {
    for (const f of this.homeless) {
      const h = this.houses.find((x) => x.residents.length < x.type.housing);
      if (!h) break;
      f.home = h; h.residents.push(f);
    }
  }

  // ------------------------------------------------------------ simulación
  /** Avanza `dt` segundos de juego. */
  update(dt: number) {
    const dd = dt / DAY_SECONDS;
    const prevDay = Math.floor(this.day);
    const prevSeason = this.season;
    this.day += dd;
    const season = this.season;
    if (season !== prevSeason) {
      const msg = ["Llega la primavera: toca sembrar.", "Verano: los campos crecen.", "Otoño: tiempo de cosecha.", "Invierno: los campos descansan y las casas queman leña."][season];
      this.event(msg, season === 3 ? "bad" : "info");
    }

    // Obras: las familias sin trabajo construyen, hasta 3 por obra, en orden
    for (const f of this.families) f.site = null;
    const builders = this.underAttack ? [] : this.idle;
    let bi = 0;
    for (const b of this.buildings) {
      if (b.built) continue;
      const n = Math.min(3, builders.length - bi);
      for (let k = 0; k < n; k++) builders[bi++].site = b;
      if (n > 0) b.progress += (n * dd) / b.type.buildDays;
      if (b.progress >= 1) {
        b.progress = 1; b.built = true;
        this.event(`Terminado: ${b.type.label.toLowerCase()}`, "good");
        if (b.type.housing) this.rehouse();
        this.version++;
      }
    }

    // Producción
    const before = { ...this.res };
    for (const b of this.buildings) {
      if (!b.built || !b.workers.length || this.underAttack) continue;
      const n = b.workers.length;
      if (b.type.kind === "woodcutter") {
        const trees = this.forest.within(b.door.x, b.door.z, 45);
        const amount = n * WOOD_PER_WORKER * Math.min(1, trees.length / 30) * dd;
        this.res.wood += amount;
        b.cutAcc += amount;
        while (b.cutAcc >= 4 && trees.length) {
          b.cutAcc -= 4;
          // Tala el más cercano: el bosque retrocede poco a poco
          let best = trees[0], bd = Infinity;
          for (const t of trees) { const d = Math.hypot(t.x - b.door.x, t.z - b.door.z); if (t.alive && d < bd) { bd = d; best = t; } }
          this.forest.fell(best);
        }
      } else if (b.type.kind === "farm") {
        this.res.food += n * FARM_YIELD[season] * dd;
      } else if (b.type.kind === "mill") {
        const amt = Math.max(0, Math.min(n * MILL_PER_WORKER * dd, this.res.food - MILL_RESERVE));
        this.res.food -= amt; this.res.flour += amt;
      } else if (b.type.kind === "bakery") {
        const amt = Math.min(n * BAKE_PER_WORKER * dd, this.res.flour);
        this.res.flour -= amt; this.res.bread += amt * BREAD_PER_FLOUR;
      } else if (b.type.kind === "market") {
        const housed = this.families.filter((f) => f.home).length;
        this.res.coins += housed * TAX_PER_FAMILY * dd;
      }
    }

    // Consumo
    // Se come primero el pan y luego el grano
    const need = this.families.length * FOOD_PER_FAMILY * dd;
    const fromBread = Math.min(this.res.bread, need);
    this.res.bread -= fromBread;
    this.res.food -= need - fromBread;
    if (need > 0) this.breadShare += (fromBread / need - this.breadShare) * Math.min(1, dd * 2);
    this.hungry = this.res.food <= 0 && this.res.bread <= 0;
    if (this.res.food < 0) this.res.food = 0;
    if (season === 3) {
      const occupied = this.houses.filter((h) => h.residents.length).length;
      this.res.wood -= occupied * FIREWOOD_PER_HOUSE * dd;
    }
    this.cold = season === 3 && this.res.wood <= 0;
    if (this.res.wood < 0) this.res.wood = 0;

    // Capacidad del almacén
    const cap = this.capacity();
    let full = false;
    for (const r of RESOURCES) {
      if (this.res[r] > cap) { this.res[r] = cap; full = true; }
    }
    if (full && this.day - this.fullWarned > 3) { this.fullWarned = this.day; this.event("Almacén lleno: lo que sobra se pierde", "bad"); }
    if (dd > 0) {
      for (const r of RESOURCES) {
        const net = (this.res[r] - before[r]) / dd;
        this.rates[r] += (net - this.rates[r]) * Math.min(1, dt * 0.5);
      }
    }

    this.updateApproval(dd);
    this.updatePopulation(dd);
    if (Math.floor(this.day) !== prevDay && this.hungry) this.event("¡Hambre! No queda comida", "bad");
  }

  private updateApproval(dd: number) {
    const f: ApprovalFactor[] = [{ label: "Base", value: 50 }];
    f.push(this.hungry ? { label: "Hambre", value: -35 } : { label: "Comida suficiente", value: 15 });
    const homeless = this.homeless.length;
    f.push(homeless ? { label: `${homeless} familia${homeless > 1 ? "s" : ""} sin casa`, value: -15 } : { label: "Todos con casa", value: 10 });
    if (this.cold) f.push({ label: "Frío: no hay leña", value: -20 });
    const market = this.buildings.some((b) => b.type.kind === "market" && b.built && b.workers.length);
    if (market) f.push({ label: "Mercado abierto", value: 10 });
    if (this.breadShare > 0.5) f.push({ label: "Comen pan", value: 8 });
    this.mods = this.mods.filter((m) => m.until > this.day);
    for (const m of this.mods) f.push({ label: m.label, value: m.value });
    this.factors = f;
    this.approvalTarget = Math.max(0, Math.min(100, f.reduce((s, x) => s + x.value, 0)));
    const diff = this.approvalTarget - this.approval;
    this.approval += Math.sign(diff) * Math.min(Math.abs(diff), 6 * dd);
  }

  private updatePopulation(dd: number) {
    const freeHouse = this.houses.some((h) => h.residents.length < h.type.housing);
    if (this.approval >= 50 && freeHouse) {
      this.arriveTimer += dd;
      if (this.arriveTimer >= 1.5) {
        this.arriveTimer = 0;
        const f = this.newFamily();
        this.event(`Llega la familia ${f.name}`, "good");
      }
    } else this.arriveTimer = 0;

    if (this.approval < 30 && this.families.length > 1) {
      this.leaveTimer += dd;
      if (this.leaveTimer >= 2) {
        this.leaveTimer = 0;
        const f = this.homeless.find((x) => x.levied === null) ?? this.idle[0] ?? this.atHome[this.atHome.length - 1];
        if (f) {
          this.removeFamily(f);
          this.event(`La familia ${f.name} abandona la aldea`, "bad");
        }
      }
    } else this.leaveTimer = 0;
  }

  private removeFamily(f: Family) {
    if (f.work) f.work.workers.splice(f.work.workers.indexOf(f), 1);
    if (f.home) f.home.residents.splice(f.home.residents.indexOf(f), 1);
    this.families.splice(this.families.indexOf(f), 1);
    f.work = null; f.home = null;
  }

  // ------------------------------------------------------------ leva
  /** Familias que irían a la leva (primero las que no trabajan) y su coste. */
  levyPlan(kind: LevyKind): { families: Family[]; wood: number; coins: number; ok: boolean; reason: string; reused: number } {
    const spec = LEVY[kind];
    const pool = this.atHome.filter((f) => f.members > 0)
      .sort((a, b) => (a.work ? 1 : 0) - (b.work ? 1 : 0));
    const families = pool.slice(0, spec.maxFamilies);
    // Solo se paga el equipo de las familias que no encuentran uno guardado en el cuartel
    const reused = Math.min(this.equipment[kind], families.length);
    const buy = families.length - reused;
    const wood = buy * spec.wood, coins = buy * spec.coins;
    let reason = "";
    if (!this.has("barracks")) reason = "Hace falta un cuartel terminado";
    else if (families.length < MIN_LEVY) reason = `Hacen falta al menos ${MIN_LEVY} familias en casa`;
    else if (this.res.wood < wood) reason = `Falta madera (${wood})`;
    else if (this.res.coins < coins) reason = `Faltan monedas (${coins})`;
    return { families, wood, coins, ok: !reason, reason, reused };
  }

  /** Aparta a las familias de su trabajo; quedan ligadas al regimiento `regId`. */
  applyLevy(kind: LevyKind, families: Family[], regId: number) {
    const plan = this.levyPlan(kind);
    this.res.wood -= plan.wood; this.res.coins -= plan.coins;
    this.equipment[kind] -= Math.min(this.equipment[kind], families.length);
    for (const f of families) {
      f.prevWork = f.work;
      if (f.work) { f.work.workers.splice(f.work.workers.indexOf(f), 1); f.work = null; }
      f.levied = regId;
      f.v.visible = false;
    }
    this.event(`Leva: ${families.length} familias forman un regimiento de ${LEVY[kind].label.toLowerCase()}`, "info");
  }

  /** Muere un hombre de la familia; si no queda ninguno, la familia se pierde. */
  casualty(familyId: number) {
    const f = this.families.find((x) => x.id === familyId);
    if (!f) return;
    f.members--;
    this.addMod("Luto por los caídos", -8, 4);
    if (f.members <= 0) {
      this.removeFamily(f);
      this.event(`La familia ${f.name} ha perdido a todos sus hombres`, "bad");
    }
  }

  /** Los supervivientes del regimiento vuelven a casa. */
  /** `kind`: si el regimiento se licencia en orden, su equipo vuelve al cuartel. */
  returnFromLevy(regId: number, at: P, kind?: LevyKind) {
    for (const f of this.families) {
      if (f.levied !== regId) continue;
      if (kind) this.equipment[kind]++;
      f.levied = null;
      f.v.x = at.x + (Math.random() - 0.5) * 4; f.v.z = at.z + (Math.random() - 0.5) * 4;
      f.v.goalKey = ""; f.v.visible = true; f.v.path = [];
      // Vuelve a su antiguo trabajo si sigue en pie y hay sitio
      const w = f.prevWork;
      f.prevWork = null;
      if (w && this.buildings.includes(w) && w.built && w.workers.length < w.type.workers) { f.work = w; w.workers.push(f); }
    }
    this.rehouse();
  }
}
