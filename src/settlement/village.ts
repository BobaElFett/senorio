import { Terrain, MAP_SIZE } from "../world/terrain";
import { NavGrid, P } from "../world/navgrid";
import { Forest, Tree } from "../world/forest";
import { Regions, Region, TRIBUTE } from "../world/regions";
import {
  BUILDINGS, BuildingKind, BuildingType, Resource, RESOURCE_LABEL, RESOURCES,
  MILL_PER_WORKER, MILL_RESERVE, BAKE_PER_WORKER, BREAD_PER_FLOUR, SAW_PER_WORKER, PLANKS_PER_WOOD, SAW_RESERVE, lackText, HOUSE_EXTRAS, HouseExtra, EXTRA_MIN_APPROVAL, TradeGood, TRADE_GOODS, TRADE_BASE, TRADE_SEASON, TRADE_LOT, TRADE_SELL, TRADE_BUY,
  DAY_SECONDS, DAYS_PER_SEASON, SEASONS, BASE_STORAGE, FOOD_PER_FAMILY, FIREWOOD_PER_HOUSE, HORSE_FOOD, UPGRADES, Upgrade,
  WOOD_PER_WORKER, FARM_YIELD, TAX_PER_FAMILY,
} from "../data/buildings";

export interface Rect { minX: number; minZ: number; maxX: number; maxZ: number }

/** Tramo de empalizada o puerta. Las puertas dejan pasar a los tuyos y frenan a los bandidos. */
export interface Wall {
  id: number;
  ax: number; az: number; bx: number; bz: number;
  gate: boolean;
  built: boolean;
  progress: number;
  hp: number;
  cells: number[];
  rect: Rect;
}
export const WALL_SEGMENT = 4;          // metros por tramo
export const WALL = { wood: 1, days: 0.35, hp: 320 };
export const GATE = { wood: 3, days: 0.8, hp: 450, length: 5 };

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
  extra: HouseExtra | null; // mejora de casa (huerto o taller)
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
  site: Building | Wall | null;    // obra donde ayuda (si no tiene trabajo)
  members: number;          // hombres en edad de luchar (4 al llegar)
  levied: number | null;    // id del regimiento en el que sirve
  prevWork: Building | null; // trabajo que dejó para ir a la leva
  v: Villager;
}

export interface Modifier { label: string; value: number; until: number }

export type LevyKind = "spear" | "archer" | "cavalry";
/** Coste por familia; `men` hombres de cada familia van a la leva; `at` es el edificio que recluta. */
export const LEVY: Record<LevyKind, { label: string; maxFamilies: number; wood: number; coins: number; men: number; at: BuildingKind }> = {
  spear: { label: "Lanceros", maxFamilies: 8, wood: 2, coins: 1, men: 4, at: "barracks" },
  archer: { label: "Arqueros", maxFamilies: 6, wood: 3, coins: 2, men: 4, at: "barracks" },
  cavalry: { label: "Jinetes", maxFamilies: 7, wood: 1, coins: 7, men: 2, at: "stable" },
};
export const isLevyKind = (k: string): k is LevyKind => k in LEVY;
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
  day = 0.33;                          // días desde el inicio (fracción = hora del día)
  res: Record<Resource, number> = { wood: 0, food: 0, coins: 0, flour: 0, bread: 0, planks: 0 };
  rates: Record<Resource, number> = { wood: 0, food: 0, coins: 0, flour: 0, bread: 0, planks: 0 };
  breadShare = 0;                      // parte de lo que se come que es pan (0–1)
  /** Comida total: grano y pan. */
  get foodTotal() { return this.res.food + this.res.bread; }
  buildings: Building[] = [];
  walls: Wall[] = [];
  families: Family[] = [];
  approval = 60;
  approvalTarget = 60;
  factors: ApprovalFactor[] = [];
  events: VillageEvent[] = [];
  hungry = false;
  cold = false;
  underAttack = false;               // durante un saqueo no se trabaja
  /** Equipos guardados en el cuartel (por familia) de regimientos licenciados. */
  equipment: Record<LevyKind, number> = { spear: 0, archer: 0, cavalry: 0 };
  mods: Modifier[] = [];
  /** Presión de precios del mercado (1 = normal; sube al comprar, baja al vender, vuelve sola). */
  pressure: Record<TradeGood, number> = { wood: 1, food: 1, planks: 1, bread: 1 };
  /** Mejoras de la herrería ya terminadas y la que se está forjando. */
  upgrades: Record<Upgrade, number> = { arms: 0, armor: 0 };
  forging: { kind: Upgrade; progress: number } | null = null;
  /** Tierras del mapa (si las hay, solo se construye en las propias). */
  regions: Regions | null = null;
  /** Caballos en servicio (los cuenta la campaña): comen grano. */
  horses = 0;
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

  /** Último día en que salió cada aviso: los repetidos (hambre, frío...) esperan unos días. */
  private lastSaid = new Map<string, number>();
  event(text: string, kind: VillageEvent["kind"] = "info") {
    const last = this.lastSaid.get(text);
    if (kind === "bad" && last !== undefined && this.day - last < 3) return;
    this.lastSaid.set(text, this.day);
    this.events.push({ id: this.nextEvent++, text, kind });
    if (this.events.length > 30) this.events.shift();
  }

  // ------------------------------------------------------------ montaje
  setup() {
    this.version++;
    this.res = { wood: 30, food: 40, coins: 35, flour: 0, bread: 0, planks: 0 };
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
      // Solo se construye en tierras propias
      if (this.regions) for (const [px, pz] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ], [x, z]]) {
        if (!this.regions.ownedBy(px, pz, "player")) return { ok: false, reason: `Fuera de tus tierras (${this.regions.at(px, pz).name}): reclámala en el mapa` };
      }
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
        if (this.res[r] < n) return { ok: false, reason: lackText(r, n) };
      }
    }
    return { ok: true, reason: "" };
  }

  private addBuilding(kind: BuildingKind, x: number, z: number, rot: number, built: boolean): Building {
    const { rect, field, door } = this.rects(kind, x, z, rot);
    const b: Building = {
      id: this.nextId++, type: BUILDINGS[kind], x, z, rot, built, progress: built ? 1 : 0,
      workers: [], residents: [], cutAcc: 0, rect, fieldRect: field, door, extra: null,
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
      // Los chicos crecen: cada estación, un hombre más en las familias que perdieron alguno
      let back = 0;
      for (const f of this.families) if (f.members < 4) { if (f.members === 0) back++; f.members++; }
      if (back) this.event(`Los chicos crecen: ${back} familia${back > 1 ? "s vuelven" : " vuelve"} a tener hombres para la leva`, "info");
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
    // Empalizada: tramo a tramo, dos constructores por tramo
    let wallsDone = 0;
    for (const w of this.walls) {
      if (w.built) continue;
      const n = Math.min(2, builders.length - bi);
      if (n <= 0) break;
      for (let k = 0; k < n; k++) builders[bi++].site = w;
      w.progress += (n * dd) / (w.gate ? GATE.days : WALL.days);
      if (w.progress >= 1) {
        w.progress = 1; w.built = true; wallsDone++;
        this.nav.setWall(w.cells, true, w.gate);
      }
    }
    if (wallsDone && !this.walls.some((w) => !w.built)) this.event("Empalizada terminada", "good");

    // Producción
    const before = { ...this.res };
    for (const b of this.buildings) {
      if (!b.built || !b.workers.length || this.underAttack) continue;
      const n = b.workers.length;
      if (b.type.kind === "woodcutter") {
        const trees = this.forest.within(b.door.x, b.door.z, 45);
        const amount = n * WOOD_PER_WORKER * Math.min(1, trees.length / 30) * (this.regions ? this.regions.at(b.x, b.z).woods : 1) * dd;
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
        this.res.food += n * FARM_YIELD[season] * this.fertility(b) * dd;
      } else if (b.type.kind === "mill") {
        const amt = Math.max(0, Math.min(n * MILL_PER_WORKER * dd, this.res.food - MILL_RESERVE));
        this.res.food -= amt; this.res.flour += amt;
      } else if (b.type.kind === "bakery") {
        const amt = Math.min(n * BAKE_PER_WORKER * dd, this.res.flour);
        this.res.flour -= amt; this.res.bread += amt * BREAD_PER_FLOUR;
      } else if (b.type.kind === "sawmill") {
        const amt = Math.max(0, Math.min(n * SAW_PER_WORKER * dd, this.res.wood - SAW_RESERVE));
        this.res.wood -= amt; this.res.planks += amt * PLANKS_PER_WOOD;
      } else if (b.type.kind === "smithy" && this.forging) {
        const f = this.forging, spec = UPGRADES[f.kind].levels[this.upgrades[f.kind]];
        f.progress += (n * dd) / spec.days;
        if (f.progress >= 1) {
          this.upgrades[f.kind]++;
          this.forging = null;
          this.event(`Herrería: ${UPGRADES[f.kind].label.toLowerCase()} de nivel ${this.upgrades[f.kind]} listas para la tropa`, "good");
        }
      } else if (b.type.kind === "market") {
        const housed = this.families.filter((f) => f.home).length;
        this.res.coins += housed * TAX_PER_FAMILY * dd;
      }
    }

    // Tributo de las tierras reclamadas
    if (this.regions) this.res.coins += Math.max(0, this.regions.count("player") - 1) * TRIBUTE * dd;

    // Los precios vuelven poco a poco a lo normal
    for (const g of TRADE_GOODS) this.pressure[g] += (1 - this.pressure[g]) * Math.min(1, 0.15 * dd);

    // Mejoras de casa: las trabaja la familia que vive allí, si no está en la leva
    if (!this.underAttack) for (const h of this.houses) {
      const f = h.residents[0];
      if (!h.built || !h.extra || !f || f.levied !== null) continue;
      const x = HOUSE_EXTRAS[h.extra];
      if (season !== 3) this.res.food += x.food * dd;
      this.res.coins += x.coins * dd;
    }

    // Consumo
    // Se come primero el pan y luego el grano
    const need = (this.families.length * FOOD_PER_FAMILY + this.horses * HORSE_FOOD) * dd;
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
    const better = this.houses.filter((h) => h.extra && h.residents.length).length;
    if (better) f.push({ label: `${better} casa${better > 1 ? "s" : ""} con huerto o taller`, value: Math.min(6, better) });
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

  // ------------------------------------------------------------ tierras
  fertility(b: Building) { return this.regions ? this.regions.at(b.x, b.z).fertility : 1; }

  claimPlan(r: Region): { cost: number; ok: boolean; reason: string } {
    const R = this.regions!;
    const cost = R.claimCost();
    let reason = "";
    if (r.owner === "player") reason = "Ya es tuya";
    else if (r.owner === "rival") reason = "Es del señor de Montfort: tómala ocupando su estandarte con tus tropas";
    else if (!r.neighbors.some((id) => R.list[id].owner === "player")) reason = "Tiene que lindar con tus tierras";
    else if (this.res.coins < cost) reason = `Faltan monedas (${cost})`;
    return { cost, ok: !reason, reason };
  }

  claim(r: Region): boolean {
    const plan = this.claimPlan(r);
    if (!plan.ok) return false;
    this.res.coins -= plan.cost;
    r.owner = "player";
    this.regions!.version++;
    this.addMod("Nuevas tierras", 5, 5);
    this.event(`Reclamas ${r.name}: ya puedes construir allí y paga tributo`, "good");
    return true;
  }

  // ------------------------------------------------------------ comercio
  get marketOpen() { return this.buildings.some((b) => b.type.kind === "market" && b.built && b.workers.length > 0); }
  unitPrice(g: TradeGood) {
    const seasonal = g === "food" || g === "bread" ? TRADE_SEASON[this.season] : 1;
    return TRADE_BASE[g] * seasonal * this.pressure[g];
  }
  /** Monedas que dan por un lote (vender) o que cuesta (comprar). */
  lotPrice(g: TradeGood, side: "sell" | "buy") {
    const p = this.unitPrice(g) * TRADE_LOT;
    return side === "sell" ? Math.max(1, Math.floor(p * TRADE_SELL)) : Math.ceil(p * TRADE_BUY);
  }
  tradePlan(g: TradeGood, side: "sell" | "buy"): { coins: number; ok: boolean; reason: string } {
    const coins = this.lotPrice(g, side);
    let reason = "";
    if (!this.marketOpen) reason = "El mercado necesita un tendero";
    else if (this.underAttack) reason = "No hay tratos durante el saqueo";
    else if (side === "sell" && this.res[g] < TRADE_LOT) reason = `No hay ${TRADE_LOT}`;
    else if (side === "buy" && this.res.coins < coins) reason = `Faltan monedas (${coins})`;
    else if (side === "buy" && this.res[g] + TRADE_LOT > this.capacity()) reason = "No cabe en el almacén";
    return { coins, ok: !reason, reason };
  }
  trade(g: TradeGood, side: "sell" | "buy"): boolean {
    const plan = this.tradePlan(g, side);
    if (!plan.ok) return false;
    if (side === "sell") { this.res[g] -= TRADE_LOT; this.res.coins += plan.coins; this.pressure[g] = Math.max(0.5, this.pressure[g] * 0.93); }
    else { this.res[g] += TRADE_LOT; this.res.coins -= plan.coins; this.pressure[g] = Math.min(2, this.pressure[g] * 1.07); }
    this.version++;
    return true;
  }

  // ------------------------------------------------------------ mejoras de casa
  extraPlan(h: Building, kind: HouseExtra): { ok: boolean; reason: string } {
    let reason = "";
    if (h.type.kind !== "house" || !h.built) reason = "Solo en casas terminadas";
    else if (h.extra) reason = "Esta casa ya tiene mejora";
    else if (!h.residents.length) reason = "No vive nadie";
    else if (this.approval < EXTRA_MIN_APPROVAL) reason = `Hace falta ${EXTRA_MIN_APPROVAL}% de aprobación`;
    else reason = this.lack(HOUSE_EXTRAS[kind].cost);
    return { ok: !reason, reason };
  }

  upgradeHouse(h: Building, kind: HouseExtra): boolean {
    if (!this.extraPlan(h, kind).ok) return false;
    this.pay(HOUSE_EXTRAS[kind].cost);
    h.extra = kind;
    this.version++;
    this.event(`La familia ${h.residents[0].name} pone un ${HOUSE_EXTRAS[kind].label.toLowerCase()} en su casa`, "good");
    return true;
  }

  // ------------------------------------------------------------ herrería
  /** Coste de la siguiente mejora de esa línea y si se puede empezar. */
  forgePlan(kind: Upgrade): { level: number; cost: Partial<Record<Resource, number>>; days: number; ok: boolean; reason: string } {
    const level = this.upgrades[kind];
    const spec = UPGRADES[kind].levels[level];
    if (!spec) return { level, cost: {}, days: 0, ok: false, reason: "Nivel máximo" };
    let reason = "";
    if (!this.has("smithy")) reason = "Hace falta una herrería terminada";
    else if (this.forging) reason = this.forging.kind === kind ? "Ya se está forjando" : "El herrero está con otro encargo";
    else reason = this.lack(spec.cost);
    return { level, cost: spec.cost, days: spec.days, ok: !reason, reason };
  }

  /** Motivo por el que no alcanza para pagar `cost` ("" si alcanza). */
  lack(cost: Partial<Record<Resource, number>>): string {
    for (const [r, n] of Object.entries(cost) as [Resource, number][]) if (this.res[r] < n) return lackText(r, n);
    return "";
  }
  pay(cost: Partial<Record<Resource, number>>) {
    for (const [r, n] of Object.entries(cost) as [Resource, number][]) this.res[r] -= n;
  }

  startForge(kind: Upgrade): boolean {
    const plan = this.forgePlan(kind);
    if (!plan.ok) return false;
    this.pay(plan.cost);
    this.forging = { kind, progress: 0 };
    this.version++;
    return true;
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
    if (!this.has(spec.at)) reason = spec.at === "stable" ? "Hace falta un establo terminado" : "Hace falta un cuartel terminado";
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
    if (f.members <= 0) return;
    f.members--;
    this.addMod("Luto por los caídos", -8, 4);
    // La familia no desaparece: sigue trabajando, pero no puede ir a la leva hasta que crezcan los chicos
    if (f.members === 0) this.event(`La familia ${f.name} ha perdido a todos sus hombres: no irá a la leva hasta la próxima estación`, "bad");
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

  // ------------------------------------------------------------ empalizada
  /** Tramos en que se divide la línea a-b (una puerta es un único tramo de 5 m). */
  wallPlan(ax: number, az: number, bx: number, bz: number, gate: boolean) {
    let len = Math.hypot(bx - ax, bz - az);
    if (gate && len > 0.01) { const k = GATE.length / len; bx = ax + (bx - ax) * k; bz = az + (bz - az) * k; len = GATE.length; }
    const n = gate ? 1 : Math.max(1, Math.ceil(len / WALL_SEGMENT));
    const segs: { ax: number; az: number; bx: number; bz: number }[] = [];
    for (let i = 0; i < n; i++) {
      segs.push({ ax: ax + (bx - ax) * i / n, az: az + (bz - az) * i / n, bx: ax + (bx - ax) * (i + 1) / n, bz: az + (bz - az) * (i + 1) / n });
    }
    const wood = gate ? GATE.wood : segs.length * WALL.wood;
    let reason = "";
    if (len < 2) reason = "Arrastra más para trazar el tramo";
    for (let t = 0; t <= 1 && !reason; t += 0.5 / Math.max(1, len)) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (this.terrain.heightAt(x, z) < 0.6) reason = "No se puede levantar en el agua";
      const lim = 185;
      if (Math.abs(x) > lim || Math.abs(z) > lim) reason = "Demasiado cerca del borde";
      else if (this.regions && !this.regions.ownedBy(x, z, "player")) reason = "Fuera de tus tierras";
      for (const b of this.buildings) {
        const r = b.rect;
        if (x > r.minX - 0.8 && x < r.maxX + 0.8 && z > r.minZ - 0.8 && z < r.maxZ + 0.8) { reason = `Atraviesa ${b.type.label.toLowerCase()}`; break; }
      }
    }
    if (!reason && this.res.wood < wood) reason = `Falta madera (${wood})`;
    return { segs, wood, ok: !reason, reason };
  }

  placeWall(ax: number, az: number, bx: number, bz: number, gate: boolean): Wall[] {
    const plan = this.wallPlan(ax, az, bx, bz, gate);
    if (!plan.ok) return [];
    this.res.wood -= plan.wood;
    const out = plan.segs.map((g) => this.addWall(g.ax, g.az, g.bx, g.bz, gate, false));
    if (!this.idle.length) this.event("Nadie libre para construir la empalizada", "bad");
    return out;
  }

  addWall(ax: number, az: number, bx: number, bz: number, gate: boolean, built: boolean): Wall {
    const w: Wall = {
      id: this.nextId++, ax, az, bx, bz, gate, built, progress: built ? 1 : 0,
      hp: gate ? GATE.hp : WALL.hp, cells: this.nav.wallCells(ax, az, bx, bz),
      rect: { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) },
    };
    this.forest.clearRect(w.rect.minX - 1, w.rect.minZ - 1, w.rect.maxX + 1, w.rect.maxZ + 1);
    if (built) this.nav.setWall(w.cells, true, gate);
    this.walls.push(w);
    return w;
  }

  /** Golpe de los bandidos; devuelve true si el tramo cae. */
  damageWall(id: number, dmg: number): boolean {
    const w = this.walls.find((x) => x.id === id);
    if (!w || !w.built) return false;
    w.hp -= dmg;
    if (w.hp > 0) return false;
    this.removeWall(w);
    this.event(w.gate ? "¡Los bandidos han echado abajo una puerta!" : "¡Los bandidos han abierto una brecha en la empalizada!", "bad");
    return true;
  }

  removeWall(w: Wall, refund = false) {
    const i = this.walls.indexOf(w);
    if (i < 0) return;
    if (w.built) this.nav.setWall(w.cells, false, w.gate);
    if (refund) this.res.wood += Math.floor((w.gate ? GATE.wood : WALL.wood) * (w.built ? 0.5 : 1));
    for (const f of this.families) if (f.site === w) f.site = null;
    this.walls.splice(i, 1);
  }
}
