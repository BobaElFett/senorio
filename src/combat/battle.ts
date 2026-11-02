import { Terrain } from "../world/terrain";
import { NavGrid, P } from "../world/navgrid";
import { UNIT_TYPES, UnitKind, UnitType } from "../data/units";

export type Team = 0 | 1;              // 0 = jugador, 1 = enemigo
export type RegState = "ok" | "wavering" | "routing" | "gone";
export type Order = { kind: "idle" } | { kind: "move" } | { kind: "attack"; target: Regiment };

export interface Soldier {
  id: number;
  reg: Regiment;
  x: number; z: number; y: number;
  vx: number; vz: number;
  heading: number;
  hp: number;
  alive: boolean;
  fled: boolean;               // salió del campo huyendo
  slot: number;                // índice en la formación
  target: Soldier | null;
  seek: number;                // temporizador de búsqueda de enemigo
  cooldown: number;
  attackAnim: number;
  reload: number;
  bob: number;
  family: number;              // id de la familia de la aldea (0 = ninguna)
  route: P[];                  // rodeo propio cuando un obstáculo tapa su hueco
  routeT: number;
}

/** Lo que el combate necesita saber de un tramo de empalizada. */
export interface WallRef { id: number; ax: number; az: number; bx: number; bz: number; built: boolean }

export interface Arrow {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number; T: number;
  team: Team; dmg: number;
  landed: number;              // segundos clavada en el suelo; -1 en vuelo
}

const GRAVITY = 9.8;
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Un regimiento: soldados que comparten formación, órdenes y moral.
 * (x, z) es el centro de la primera fila; `facing` es el ángulo del frente
 * (vector frente = (sin, cos)).
 */
export class Regiment {
  soldiers: Soldier[] = [];
  alive: Soldier[] = [];        // vivos y en el campo, en orden de formación
  path: P[] = [];
  destFacing: number | null = null;
  order: Order = { kind: "idle" };
  morale: number;
  state: RegState = "ok";
  engaged = false;
  fighting = 0;                 // soldados en combate este fotograma
  running = false;
  charged = false;
  chargeUntil = -1;
  lastLoss = -99;
  routeTime = 0;
  repath = 0;
  slotErr = 0;
  firing: Regiment | null = null;
  slots: P[] = [];
  cx = 0; cz = 0;               // centro de masas de los vivos
  plundering = false;           // bandidos saqueando la aldea
  withdrawing = false;          // bandidos retirándose con el botín
  breach: WallRef | null = null; // tramo de empalizada que están derribando
  flank: P | null = null;        // punto de rodeo para atacar por el flanco (IA)
  size: number;                 // efectivos al formarse

  constructor(
    public id: number, public name: string, public team: Team, public type: UnitType,
    public x: number, public z: number, public facing: number, public files: number,
  ) {
    this.morale = type.morale;
    this.size = type.soldiers;
  }

  get fwd(): P { return { x: Math.sin(this.facing), z: Math.cos(this.facing) }; }
  get right(): P { return { x: Math.cos(this.facing), z: -Math.sin(this.facing) }; }
  get count() { return this.alive.length; }
  get ranks() { return Math.max(1, Math.ceil(this.alive.length / this.files)); }
  get active() { return this.state === "ok" || this.state === "wavering"; }

  /** Posición del hueco i de la formación para n soldados. */
  slotPos(i: number, n: number, ax = this.x, az = this.z, facing = this.facing, files = this.files): P {
    const f = Math.max(1, Math.min(files, n));
    const ranks = Math.ceil(n / f);
    const rank = Math.floor(i / f);
    const inRank = rank === ranks - 1 ? n - rank * f : f;
    const lat = ((i % f) - (inRank - 1) / 2) * this.type.spacing;
    const back = rank * this.type.spacing;
    const s = Math.sin(facing), c = Math.cos(facing);
    return { x: ax + c * lat - s * back, z: az - s * lat - c * back };
  }

  /** Media vuelta: la última fila pasa a ser la primera, sin que nadie cruce la formación. */
  aboutFace() {
    const depth = (this.ranks - 1) * this.type.spacing;
    this.x -= this.fwd.x * depth;
    this.z -= this.fwd.z * depth;
    this.facing += Math.PI;
    this.alive.reverse();
    this.alive.forEach((s, i) => (s.slot = i));
  }
}

export class Battle {
  regiments: Regiment[] = [];
  soldiers: Soldier[] = [];
  arrows: Arrow[] = [];
  time = 0;
  started = false;
  result: Team | null = null;
  version = 0;                   // cambia al reiniciar: la vista se reconstruye
  campaign = false;              // en la aldea: sin resultado de batalla, IA de saqueo
  raidTarget: P | null = null;   // adonde van los bandidos si nadie les sale al paso
  onCasualty: ((s: Soldier) => void) | null = null;
  /** Empalizada de la aldea (para que los bandidos la rodeen o la derriben). */
  walls: () => WallRef[] = () => [];
  onWallHit: ((id: number, dmg: number) => boolean) | null = null;
  /** Avisos para el sonido: golpe, disparo, impacto de flecha, carga, huida. */
  onEvent: ((kind: "strike" | "fire" | "hit" | "charge" | "rout", x: number, z: number) => void) | null = null;
  /** Mejoras por bando (herrería): se suman a los números del tipo de tropa. */
  bonus: { attack: number; defense: number; hp: number; arrow: number }[] = [
    { attack: 0, defense: 0, hp: 0, arrow: 0 }, { attack: 0, defense: 0, hp: 0, arrow: 0 },
  ];
  private nextReg = 0;
  private hash = new Map<number, Soldier[]>();
  private aiTimer = 0;
  private nextId = 0;

  constructor(public terrain: Terrain, public nav: NavGrid) {}

  // ---------------------------------------------------------------- montaje

  setup() {
    this.regiments = []; this.soldiers = []; this.arrows = [];
    this.time = 0; this.started = false; this.result = null; this.version++;
    const W = -Math.PI / 2, E = Math.PI / 2;  // frente al oeste / al este
    this.add(0, "Lanceros de la aldea", "spear", -62, -26, W);
    this.add(0, "Lanceros del molino", "spear", -62, 26, W);
    this.add(0, "Arqueros de la aldea", "archer", -48, 0, W);
    this.spawn(0, "Jinetes de la aldea", "cavalry", -56, 58, W, 14);
    this.add(1, "Lanceros bandidos", "spear", -150, 0, E);
    this.add(1, "Saqueadores", "militia", -150, 45, E);
    this.add(1, "Arqueros bandidos", "archer", -165, -30, E);
    this.spawn(1, "Jinetes bandidos", "cavalry", -168, -62, E, 10);
  }

  private add(team: Team, name: string, kind: UnitKind, x: number, z: number, facing: number) {
    this.spawn(team, name, kind, x, z, facing);
  }

  /** Forma un regimiento. `familyOf(i)` dice de qué familia es el soldado i. */
  spawn(team: Team, name: string, kind: UnitKind, x: number, z: number, facing: number,
    count?: number, familyOf?: (i: number) => number): Regiment {
    const type = UNIT_TYPES[kind];
    const n = count ?? type.soldiers;
    const r = new Regiment(this.nextReg++, name, team, type, x, z, facing, Math.min(type.defaultFiles, Math.max(4, Math.ceil(n / 3))));
    r.size = n;
    for (let i = 0; i < n; i++) {
      const slot = r.slotPos(i, n);
      const p = this.nav.nearestOpen(slot.x, slot.z, team === 1);
      const s: Soldier = {
        id: this.nextId++, reg: r, x: p.x, z: p.z, y: this.terrain.heightAt(p.x, p.z),
        vx: 0, vz: 0, heading: facing, hp: type.hp + this.bonus[team].hp, alive: true, fled: false, slot: i,
        target: null, seek: Math.random() * 0.3, cooldown: Math.random(), attackAnim: 0,
        reload: Math.random() * type.reload, bob: Math.random() * 10, family: familyOf ? familyOf(i) : 0,
        route: [], routeT: Math.random(),
      };
      r.soldiers.push(s); r.alive.push(s); this.soldiers.push(s);
    }
    this.regiments.push(r);
    this.version++;
    return r;
  }

  /** Quita un regimiento del campo (licenciado o retirado). */
  removeRegiment(r: Regiment) {
    this.regiments = this.regiments.filter((x) => x !== r);
    this.soldiers = this.soldiers.filter((s) => s.reg !== r);
    for (const o of this.regiments) if (o.order.kind === "attack" && o.order.target === r) this.orderHalt(o);
    for (const s of this.soldiers) if (s.target && s.target.reg === r) s.target = null;
    this.version++;
  }

  // ---------------------------------------------------------------- órdenes

  orderMove(r: Regiment, x: number, z: number, facing: number | null, files: number | null) {
    if (!r.active) return;
    if (files) r.files = clamp(Math.round(files), 2, Math.max(2, r.count));
    const en = r.team === 1;
    const dest = this.nav.nearestOpen(x, z, en);
    const dist = Math.hypot(dest.x - r.x, dest.z - r.z);
    // Si el destino queda a la espalda, media vuelta en vez de girar toda la línea
    const goingTo = dist > 12 ? Math.atan2(dest.x - r.x, dest.z - r.z) : (facing ?? r.facing);
    if (Math.abs(angleDiff(goingTo, r.facing)) > 1.9) r.aboutFace();
    r.order = { kind: "move" };
    r.running = false;
    r.path = this.nav.findPath(r.x, r.z, dest.x, dest.z, en) ?? [dest];
    r.destFacing = facing;
  }

  orderAttack(r: Regiment, target: Regiment) {
    if (!r.active || target.team === r.team || !target.active && target.state !== "routing") return;
    r.order = { kind: "attack", target };
    r.repath = 0;
    r.charged = false;
    r.destFacing = null;
    const ang = Math.atan2(target.cx - r.cx, target.cz - r.cz);
    if (Math.abs(angleDiff(ang, r.facing)) > 1.9) r.aboutFace();
  }

  orderHalt(r: Regiment) {
    if (!r.active) return;
    r.order = { kind: "idle" };
    r.path = [];
    r.destFacing = null;
    r.running = false;
  }

  start() { if (!this.started) { this.started = true; this.aiTimer = 0; } }

  // ---------------------------------------------------------------- simulación

  update(dt: number) {
    this.time += dt;
    for (const r of this.regiments) this.updateCentroid(r);
    this.buildHash();
    if (this.started && this.result === null) {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) { this.aiTimer = 1.2; this.runAI(); }
    }
    for (const r of this.regiments) if (r.state !== "gone") this.updateRegiment(r, dt);
    for (const r of this.regiments) {
      if (r.state === "gone") continue;
      r.fighting = 0;
      this.computeSlots(r);
      let err = 0;
      for (const s of r.alive) err += this.updateSoldier(s, dt);
      r.slotErr = r.alive.length ? err / r.alive.length : 0;
      r.engaged = r.fighting > Math.max(2, r.count * 0.1);
      this.updateArchery(r, dt);
      this.updateMorale(r, dt);
    }
    this.updateArrows(dt);
    this.checkResult();
  }

  private updateCentroid(r: Regiment) {
    if (!r.alive.length) return;
    let x = 0, z = 0;
    for (const s of r.alive) { x += s.x; z += s.z; }
    r.cx = x / r.alive.length; r.cz = z / r.alive.length;
  }

  private key(ix: number, iz: number) { return (ix + 512) * 1024 + (iz + 512); }

  private buildHash() {
    this.hash.clear();
    for (const s of this.soldiers) {
      if (!s.alive || s.fled) continue;
      const k = this.key(Math.floor(s.x / 4), Math.floor(s.z / 4));
      let b = this.hash.get(k);
      if (!b) this.hash.set(k, (b = []));
      b.push(s);
    }
  }

  /** Soldados vivos a menos de `radius` m de (x, z). */
  near(x: number, z: number, radius: number, fn: (s: Soldier, d: number) => void) {
    const r = Math.ceil(radius / 4), cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const b = this.hash.get(this.key(cx + dx, cz + dz));
      if (!b) continue;
      for (const s of b) {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d <= radius) fn(s, d);
      }
    }
  }

  private updateRegiment(r: Regiment, dt: number) {
    if (r.state === "routing") return;
    // Sin órdenes, la infantería responde a enemigos que se le echan encima
    if (r.order.kind === "idle" && r.type.range === 0 && !r.path.length && (this.started || r.team === 0)) {
      const e = this.nearestEnemyRegiment(r);
      if (e && e.state !== "routing" && Math.hypot(e.cx - r.cx, e.cz - r.cz) < 22) this.orderAttack(r, e);
    }
    const o = r.order;
    if (o.kind === "attack") {
      const t = o.target;
      if (t.state === "gone" || (t.state === "routing" && r.team === 1)) { this.orderHalt(r); return; }
      const d = Math.hypot(t.cx - r.cx, t.cz - r.cz);
      if (r.type.range > 0) {
        // Arqueros: acercarse hasta tener a tiro y quedarse quietos
        r.running = false;
        r.repath -= dt;
        if (d > r.type.range * 0.92) {
          if (r.repath <= 0 || !r.path.length) {
            r.repath = 1.5;
            const k = (d - r.type.range * 0.8) / d;
            const gx = r.cx + (t.cx - r.cx) * k, gz = r.cz + (t.cz - r.cz) * k;
            const off = { x: r.x - r.cx, z: r.z - r.cz };
            r.path = this.nav.findPath(r.x, r.z, gx + off.x, gz + off.z, r.team === 1) ?? [];
          }
        } else {
          r.path = [];
          r.destFacing = Math.atan2(t.cx - r.cx, t.cz - r.cz);
        }
      } else {
        // Los jinetes toman carrerilla desde más lejos y, si se apartan, pueden volver a cargar
        const runup = r.type.mounted ? 60 : 35;
        if (r.type.mounted && !r.engaged && d > 30) r.charged = false;
        // (los jinetes siguen al galope hasta el primer golpe: si no, la carga se queda en nada)
        r.running = d < runup && (!r.engaged || (!!r.type.mounted && !r.charged));
        r.repath -= dt;
        if (r.engaged) {
          r.path = [];
          r.destFacing = Math.atan2(t.cx - r.cx, t.cz - r.cz);
          // La formación se reajusta alrededor de donde está luchando la tropa
          const half = ((r.ranks - 1) * r.type.spacing) / 2;
          const k = Math.min(1, dt * 1.5);
          r.x += (r.cx + r.fwd.x * half - r.x) * k;
          r.z += (r.cz + r.fwd.z * half - r.z) * k;
        }
        else if (r.repath <= 0) {
          r.repath = 1;
          r.path = this.nav.findPath(r.x, r.z, t.cx, t.cz, r.team === 1) ?? [{ x: t.cx, z: t.cz }];
        }
      }
    }

    // El ancla de la formación avanza por el camino, frenando si la tropa se queda atrás
    if (r.path.length) {
      const wp = r.path[0];
      const dx = wp.x - r.x, dz = wp.z - r.z, d = Math.hypot(dx, dz);
      let remaining = d;
      for (let i = 1; i < r.path.length; i++) remaining += Math.hypot(r.path[i].x - r.path[i - 1].x, r.path[i].z - r.path[i - 1].z);
      const cohesion = clamp(1 - (r.slotErr - 1.5) / 5, 0.25, 1);
      const speed = (r.running ? r.type.runSpeed : r.type.speed) * cohesion;
      if (remaining > 12 && d > 0.5) this.turnTowards(r, Math.atan2(dx, dz), speed, dt);
      const step = Math.min(d, speed * dt);
      if (d > 1e-3) { r.x += (dx / d) * step; r.z += (dz / d) * step; }
      if (d - step < 0.05) r.path.shift();
      if (!r.path.length && r.order.kind === "move") r.order = { kind: "idle" };
    } else if (r.destFacing !== null) {
      if (this.turnTowards(r, r.destFacing, r.type.speed, dt)) r.destFacing = null;
    }
  }

  /** Gira el frente; la velocidad angular depende del ancho (las alas no pueden correr). */
  private turnTowards(r: Regiment, target: number, speed: number, dt: number): boolean {
    const diff = angleDiff(target, r.facing);
    const halfW = Math.max(2, ((r.files - 1) * r.type.spacing) / 2);
    const maxStep = (speed * 1.3 / halfW) * dt;
    if (Math.abs(diff) <= maxStep) { r.facing = target; return true; }
    // Girar sobre el centro del frente: el ancla no se mueve
    r.facing += Math.sign(diff) * maxStep;
    return false;
  }

  private computeSlots(r: Regiment) {
    const n = r.alive.length;
    r.slots.length = n;
    for (let i = 0; i < n; i++) r.slots[i] = r.slotPos(i, n);
  }

  private nearestEnemyRegiment(r: Regiment): Regiment | null {
    let best: Regiment | null = null, bd = Infinity;
    for (const o of this.regiments) {
      if (o.team === r.team || o.state === "gone" || !o.alive.length) continue;
      const d = Math.hypot(o.cx - r.cx, o.cz - r.cz);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  /** Mueve y hace luchar a un soldado. Devuelve su distancia al hueco de formación. */
  private updateSoldier(s: Soldier, dt: number): number {
    const r = s.reg;
    s.cooldown -= dt;
    s.attackAnim = Math.max(0, s.attackAnim - dt * 3);
    let gx: number, gz: number, maxSpeed: number, slotDist = 0;

    if (r.state === "routing") {
      // Huir lejos del enemigo más cercano
      s.target = null;
      const e = this.nearestEnemyRegiment(r);
      const ax = e ? s.x - e.cx : -r.fwd.x, az = e ? s.z - e.cz : -r.fwd.z;
      const l = Math.hypot(ax, az) || 1;
      gx = s.x + (ax / l) * 10; gz = s.z + (az / l) * 10;
      maxSpeed = r.type.runSpeed * 1.05;
    } else {
      // Buscar a quién pegar (escalonado para no buscar cada fotograma)
      s.seek -= dt;
      if (s.target && (!s.target.alive || s.target.fled)) s.target = null;
      if (s.seek <= 0) {
        s.seek = 0.25 + Math.random() * 0.15;
        const attackT = r.order.kind === "attack" && r.type.range === 0 ? r.order.target : null;
        const radius = attackT ? 14 : 3.2;
        const pick: { s: Soldier | null; d: number } = { s: null, d: Infinity };
        this.near(s.x, s.z, radius, (o, d) => {
          if (o.reg.team === r.team) return;
          // Con orden de ataque, preferir al regimiento objetivo
          if (d > 3.2 && attackT && o.reg !== attackT) return;
          const score = attackT && o.reg !== attackT ? d + 6 : d;
          if (score < pick.d) { pick.d = score; pick.s = o; }
        });
        if (pick.s || (s.target && Math.hypot(s.target.x - s.x, s.target.z - s.z) > radius)) s.target = pick.s;
      }
      const slot = r.slots[s.slot] ?? { x: s.x, z: s.z };
      slotDist = Math.hypot(slot.x - s.x, slot.z - s.z);
      if (s.target) {
        const t = s.target;
        const d = Math.hypot(t.x - s.x, t.z - s.z);
        r.fighting++;
        const reach = r.type.reach;
        if (d < reach) {
          gx = s.x; gz = s.z;
          if (s.cooldown <= 0) this.strike(s, t);
        } else {
          gx = t.x - ((t.x - s.x) / d) * reach * 0.7; gz = t.z - ((t.z - s.z) / d) * reach * 0.7;
        }
        maxSpeed = r.running ? r.type.runSpeed : r.type.speed * 1.2;
      } else if (r.breach && !r.path.length) {
        // Derribando la empalizada: cada uno a su trozo de muro, a hachazos
        const p = this.wallPoint(r.breach, s.x, s.z, 2.0);
        gx = p.x + (Math.random() - 0.5) * 0.2; gz = p.z;
        maxSpeed = r.type.speed;
        if (p.d < 3.2 && s.cooldown <= 0) {
          s.cooldown = 1.4 + Math.random() * 0.6;
          s.attackAnim = 1;
          this.onEvent?.("strike", s.x, s.z);
          if (this.onWallHit?.(r.breach.id, 0.3 + r.type.attack * 0.1)) r.breach = null;
        }
      } else {
        gx = slot.x; gz = slot.z;
        // Si un edificio o el agua tapan el camino al hueco, rodear con A*
        s.routeT -= dt;
        if (slotDist > 3 && s.routeT <= 0) {
          s.routeT = 1.2 + Math.random() * 0.6;
          const en = r.team === 1;
          s.route = this.nav.lineOfSight(s.x, s.z, slot.x, slot.z, en) ? [] : (this.nav.findPath(s.x, s.z, slot.x, slot.z, en) ?? []);
        } else if (slotDist <= 3) s.route = [];
        while (s.route.length && Math.hypot(s.route[0].x - s.x, s.route[0].z - s.z) < 1.2) s.route.shift();
        if (s.route.length) { gx = s.route[0].x; gz = s.route[0].z; }
        const moving = r.path.length > 0;
        maxSpeed = (r.running ? r.type.runSpeed : r.type.speed) * (moving ? 1.35 : 1.2);
      }
    }

    // Dirigirse al objetivo con llegada suave, separándose de los vecinos
    let dx = gx - s.x, dz = gz - s.z;
    const dist = Math.hypot(dx, dz);
    let wx = 0, wz = 0;
    if (dist > 0.05) {
      const sp = Math.min(maxSpeed, dist * 2.5);
      wx = (dx / dist) * sp; wz = (dz / dist) * sp;
    }
    const rad = r.type.radius;
    this.near(s.x, s.z, rad + 0.85, (o, d) => {
      if (o === s || d < 1e-4) return;
      const gap = rad + o.reg.type.radius;
      if (d >= gap) return;
      const push = (gap - d) * 4;
      wx += ((s.x - o.x) / d) * push; wz += ((s.z - o.z) / d) * push;
    });
    const a = Math.min(1, dt * 8);
    s.vx += (wx - s.vx) * a; s.vz += (wz - s.vz) * a;
    const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    const en = r.team === 1;
    if (!this.nav.blockedAt(nx, nz, en)) { s.x = nx; s.z = nz; }
    else if (!this.nav.blockedAt(nx, s.z, en)) { s.x = nx; s.vz = 0; }
    else if (!this.nav.blockedAt(s.x, nz, en)) { s.z = nz; s.vx = 0; }
    else { s.vx = 0; s.vz = 0; }
    s.y = Math.max(-0.4, this.terrain.heightAt(s.x, s.z));

    const speed = Math.hypot(s.vx, s.vz);
    s.bob += speed * dt * 1.6;
    let want = r.facing;
    if (s.target) want = Math.atan2(s.target.x - s.x, s.target.z - s.z);
    else if (speed > 0.6) want = Math.atan2(s.vx, s.vz);
    s.heading += angleDiff(want, s.heading) * Math.min(1, dt * 6);

    // Huidos: fuera del campo tras correr un rato lejos del enemigo
    if (r.state === "routing" && r.routeTime > 6) {
      let close = false;
      this.near(s.x, s.z, 30, (o) => { if (o.reg.team !== r.team && o.reg.state !== "routing") close = true; });
      if (!close || r.routeTime > 30) this.remove(s, true);
    }
    return slotDist;
  }

  private strike(a: Soldier, d: Soldier) {
    const ar = a.reg, dr = d.reg;
    a.cooldown = 1.6 + Math.random() * 0.8;
    a.attackAnim = 1;
    // Flanco o retaguardia según dónde está el atacante respecto al frente del defensor
    const rx = a.x - dr.cx, rz = a.z - dr.cz, rl = Math.hypot(rx, rz) || 1;
    const cos = (rx * dr.fwd.x + rz * dr.fwd.z) / rl;
    const rear = cos < -0.35 && dr.state !== "routing";
    const flank = !rear && Math.abs(cos) < 0.45 && dr.state !== "routing";
    if (rear) dr.morale -= 0.35; else if (flank) dr.morale -= 0.15;

    // Impacto de la carga: una vez por ataque
    if (ar.running && !ar.charged && ar.type.charge > 0) {
      ar.charged = true;
      if (!ar.type.mounted) ar.running = false;
      ar.chargeUntil = this.time + 4;
      const braced = dr.type.kind === "spear" && cos > 0.4 && dr.state === "ok" && !dr.path.length;
      if (braced) {
        // Cargar de frente contra un muro de lanzas: los caballos se clavan
        ar.morale -= ar.type.mounted ? 20 : 8;
        if (ar.type.mounted) for (const x of ar.alive.slice(0, Math.ceil(ar.alive.length / 3))) this.damage(x, 3 + Math.random() * 3);
      } else dr.morale -= 10 * ar.type.charge;
      this.onEvent?.("charge", d.x, d.z);
    }
    let hit = 0.5 + (ar.type.attack + this.bonus[ar.team].attack - dr.type.defense - this.bonus[dr.team].defense) * 0.06;
    if (flank) hit += 0.15;
    if (rear) hit += 0.25;
    if (ar.state === "wavering") hit -= 0.1;
    if (dr.state === "routing") hit += 0.3;
    const antiHorse = ar.type.kind === "spear" && dr.type.mounted;
    if (antiHorse) hit += 0.1;
    // Jinetes en plena carga: arrollan a quien pillan y golpean más deprisa
    const impact = ar.type.mounted && this.time < ar.chargeUntil;
    if (impact) { hit += 0.35; a.cooldown *= 0.5; }
    this.onEvent?.("strike", d.x, d.z);
    if (Math.random() < clamp(hit, 0.08, 0.95)) {
      let dmg = 2 + Math.random() * 1.5;
      if (this.time < ar.chargeUntil) dmg *= ar.type.mounted ? 2.2 : 1.5;
      if (antiHorse) dmg *= 1.15;
      else if (dr.type.mounted) dmg *= 0.75;   // a pie cuesta alcanzar al jinete
      this.damage(d, dmg);
    }
  }

  private damage(s: Soldier, dmg: number) {
    if (!s.alive) return;
    s.hp -= dmg;
    if (s.hp <= 0) this.remove(s, false);
  }

  /** Baja (muerto) o salida del campo (huido). Mantiene la formación compacta. */
  private remove(s: Soldier, fled: boolean) {
    const r = s.reg;
    if (fled) s.fled = true; else s.alive = false;
    const i = r.alive.indexOf(s);
    if (i < 0) return;
    const last = r.alive.pop()!;
    if (last !== s) { r.alive[i] = last; last.slot = i; }
    if (!fled) {
      r.morale -= 70 / r.size;
      r.lastLoss = this.time;
      this.onCasualty?.(s);
    }
    if (!r.alive.length) r.state = "gone";
  }

  private updateArchery(r: Regiment, dt: number) {
    r.firing = null;
    if (r.type.range === 0 || !r.active || r.engaged || r.path.length) return;
    let tgt: Regiment | null = null;
    if (r.order.kind === "attack" && r.order.target.state !== "gone") tgt = r.order.target;
    else if (this.started || r.team === 0) {
      // Fuego a discreción: el enemigo más cercano a tiro que no esté trabado con los nuestros
      const e = this.nearestEnemyRegiment(r);
      if (e && e.state !== "routing" && !e.engaged) tgt = e;
    }
    if (!tgt || !tgt.alive.length) return;
    const d = Math.hypot(tgt.cx - r.cx, tgt.cz - r.cz);
    if (d > r.type.range) return;
    r.firing = tgt;
    const ang = Math.atan2(tgt.cx - r.cx, tgt.cz - r.cz);
    if (r.destFacing === null && Math.abs(angleDiff(ang, r.facing)) > 0.4) r.destFacing = ang;
    for (const s of r.alive) {
      if (s.target) continue;
      s.reload -= dt;
      if (s.reload > 0) continue;
      s.reload = r.type.reload * (0.85 + Math.random() * 0.3);
      const v = tgt.alive[(Math.random() * tgt.alive.length) | 0];
      const dist = Math.hypot(v.x - s.x, v.z - s.z);
      const spread = 1 + 3 * (dist / r.type.range);
      const ang2 = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
      const tx = v.x + v.vx * 1.5 + Math.cos(ang2) * rad, tz = v.z + v.vz * 1.5 + Math.sin(ang2) * rad;
      const T = 1 + dist / 40;
      const sy = s.y + 1.5, ty = this.terrain.heightAt(tx, tz);
      this.arrows.push({
        x: s.x, y: sy, z: s.z,
        vx: (tx - s.x) / T, vz: (tz - s.z) / T, vy: (ty - sy + 0.5 * GRAVITY * T * T) / T,
        t: 0, T, team: r.team, dmg: r.type.arrowDamage + this.bonus[r.team].arrow, landed: -1,
      });
      s.attackAnim = 0.6;
      this.onEvent?.("fire", s.x, s.z);
    }
  }

  /** Flecha disparada desde fuera de un regimiento (torre de vigía) hacia el punto (tx, tz). */
  shoot(x: number, y: number, z: number, tx: number, tz: number, team: Team, dmg: number) {
    const dist = Math.hypot(tx - x, tz - z);
    const T = 1 + dist / 45;
    const ty = this.terrain.heightAt(tx, tz);
    this.arrows.push({
      x, y, z, vx: (tx - x) / T, vz: (tz - z) / T, vy: (ty - y + 0.5 * GRAVITY * T * T) / T,
      t: 0, T, team, dmg, landed: -1,
    });
    this.onEvent?.("fire", x, z);
  }

  private updateArrows(dt: number) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      if (a.landed >= 0) {
        a.landed += dt;
        if (a.landed > 5) this.arrows.splice(i, 1);
        continue;
      }
      a.t += dt;
      a.x += a.vx * dt; a.z += a.vz * dt;
      a.vy -= GRAVITY * dt; a.y += a.vy * dt;
      if (a.t >= a.T) {
        a.landed = 0;
        a.y = this.terrain.heightAt(a.x, a.z);
        const hit: { s: Soldier | null; d: number } = { s: null, d: 0.8 };
        // Las flechas no distinguen bandos: disparar a una melé es arriesgado
        this.near(a.x, a.z, 0.8, (s, d) => { if (d < hit.d) { hit.d = d; hit.s = s; } });
        if (hit.s) {
          const v = hit.s;
          this.onEvent?.("hit", v.x, v.z);
          v.reg.morale -= 0.25;
          if (Math.random() < 0.8 - (v.reg.type.defense + this.bonus[v.reg.team].defense) * 0.08) this.damage(v, a.dmg * (0.8 + Math.random() * 0.4));
          this.arrows.splice(i, 1);
        }
      }
    }
  }

  private updateMorale(r: Regiment, dt: number) {
    if (r.state === "gone") return;
    if (r.state === "routing") { r.routeTime += dt; return; }
    if (this.time - r.lastLoss > 4 && !r.engaged) r.morale = Math.min(r.type.morale, r.morale + 1.5 * dt);
    if (r.morale <= 0) {
      r.state = "routing";
      r.morale = 0;
      this.onEvent?.("rout", r.cx, r.cz);
      r.path = []; r.order = { kind: "idle" }; r.running = false;
      for (const s of r.alive) s.target = null;
      // El pánico se contagia; el enemigo se crece
      for (const o of this.regiments) {
        if (o === r || !o.active) continue;
        const d = Math.hypot(o.cx - r.cx, o.cz - r.cz);
        if (d < 45) o.morale += o.team === r.team ? -5 : 5;
      }
    } else {
      r.morale = Math.min(r.morale, r.type.morale);
      r.state = r.morale < 30 ? "wavering" : "ok";
    }
  }

  private runAI() {
    for (const r of this.regiments) {
      if (r.team !== 1 || !r.active || r.withdrawing) continue;
      let best: Regiment | null = null, bd = Infinity;
      for (const o of this.regiments) {
        if (o.team !== 0 || !o.active) continue;
        // Los cuerpo a cuerpo prefieren a los arqueros si están cerca
        let d = Math.hypot(o.cx - r.cx, o.cz - r.cz) - (r.type.range === 0 && o.type.range > 0 ? 15 : 0);
        // Los jinetes buscan arqueros y evitan las lanzas
        if (r.type.mounted) d += (o.type.range > 0 ? -30 : 0) + (o.type.kind === "spear" ? 25 : 0);
        if (d < bd) { bd = d; best = o; }
      }
      // Saqueo: si nadie les sale al paso, van a por la aldea
      if (this.campaign && this.raidTarget && (!best || bd > 70)) {
        const t = this.raidTarget;
        const d = Math.hypot(t.x - r.cx, t.z - r.cz);
        r.plundering = d < 22 && !r.engaged;
        // ¿Hay camino hasta la aldea? Si la empalizada lo cierra, a derribar el tramo más a mano
        if (r.breach && !this.walls().some((w) => w.id === r.breach!.id && w.built)) r.breach = null;
        if (!r.breach && d > 14) {
          const path = this.nav.findPath(r.cx, r.cz, t.x, t.z, true);
          const end = path && path[path.length - 1];
          const closed = !end || Math.hypot(end.x - t.x, end.z - t.z) > 10;
          if (closed) {
            let wbest: WallRef | null = null, wd = Infinity;
            for (const w of this.walls()) {
              if (!w.built) continue;
              const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
              const score = Math.hypot(mx - r.cx, mz - r.cz) + Math.hypot(mx - t.x, mz - t.z) * 0.6;
              if (score < wd) { wd = score; wbest = w; }
            }
            if (wbest) {
              r.breach = wbest;
              const p = this.wallSide(wbest, r.cx, r.cz, 3);
              this.orderMove(r, p.x, p.z, Math.atan2(-p.nx, -p.nz), null);
            }
          }
        }
        if (r.breach) continue;
        if (d > 14 && (r.order.kind !== "move" || !r.path.length)) {
          const k = Math.min(1, 10 / Math.max(1, d));
          this.orderMove(r, t.x + (r.cx - t.x) * k + (r.id % 3 - 1) * 8, t.z + (r.cz - t.z) * k, Math.atan2(t.x - r.cx, t.z - r.cz), null);
        }
        continue;
      }
      r.plundering = false;
      if (!best) { this.orderHalt(r); continue; }
      if (r.type.range > 0) {
        // Los arqueros enemigos no disparan a una melé: buscan blancos libres o esperan
        let free: Regiment | null = null, fd = Infinity;
        for (const o of this.regiments) {
          if (o.team !== 0 || !o.active || o.engaged) continue;
          const d = Math.hypot(o.cx - r.cx, o.cz - r.cz);
          if (d < fd) { fd = d; free = o; }
        }
        if (!free) { if (r.order.kind !== "idle") this.orderHalt(r); continue; }
        best = free;
      }
      // Flanqueo: si el objetivo ya está trabado con otros bandidos, rodearlo y entrar por el lado o la espalda
      if (r.type.range === 0 && r.state === "ok" && !r.engaged && best.engaged && best.state !== "routing") {
        const p = this.flankPoint(r, best);
        const far = Math.hypot(best.cx - r.cx, best.cz - r.cz) > 25;
        if (far && Math.hypot(p.x - r.cx, p.z - r.cz) > 10) {
          if (!r.flank || Math.hypot(r.flank.x - p.x, r.flank.z - p.z) > 10) {
            r.flank = p;
            this.orderMove(r, p.x, p.z, Math.atan2(best.cx - p.x, best.cz - p.z), null);
          }
          continue;
        }
      }
      r.flank = null;
      if (r.order.kind !== "attack" || r.order.target !== best) this.orderAttack(r, best);
    }
  }

  /** Punto a un costado y algo por detrás del regimiento `t`, del lado por el que llega `r`. */
  private flankPoint(r: Regiment, t: Regiment): P {
    const right = t.right, fwd = t.fwd;
    const side = (r.cx - t.cx) * right.x + (r.cz - t.cz) * right.z >= 0 ? 1 : -1;
    const half = ((Math.min(t.files, t.count) - 1) * t.type.spacing) / 2;
    const depth = (t.ranks - 1) * t.type.spacing;
    const lat = half + 10, back = depth / 2 + 6;
    const p = this.nav.nearestOpen(t.cx + right.x * side * lat - fwd.x * back, t.cz + right.z * side * lat - fwd.z * back, true);
    return { x: p.x, z: p.z };
  }

  /** Punto a `off` m del centro del tramo, del lado de (x, z), y la normal hacia el muro. */
  private wallSide(w: WallRef, x: number, z: number, off: number) {
    const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2;
    const len = Math.hypot(w.bx - w.ax, w.bz - w.az) || 1;
    let nx = -(w.bz - w.az) / len, nz = (w.bx - w.ax) / len;
    if ((x - mx) * nx + (z - mz) * nz < 0) { nx = -nx; nz = -nz; }
    return { x: mx + nx * off, z: mz + nz * off, nx, nz };
  }

  /** Punto del tramo más cercano a (x, z), separado `off` m hacia su lado. */
  private wallPoint(w: WallRef, x: number, z: number, off: number) {
    const dx = w.bx - w.ax, dz = w.bz - w.az, l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0.1, Math.min(0.9, ((x - w.ax) * dx + (z - w.az) * dz) / l2));
    const px = w.ax + dx * t, pz = w.az + dz * t;
    const side = this.wallSide(w, x, z, 0);
    return { x: px + side.nx * off, z: pz + side.nz * off, d: Math.hypot(x - px, z - pz) };
  }

  private checkResult() {
    if (this.campaign || !this.started || this.result !== null) return;
    const alive = (t: Team) => this.regiments.some((r) => r.team === t && r.active);
    if (!alive(1)) this.result = 0;
    else if (!alive(0)) this.result = 1;
  }
}
