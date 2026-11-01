import { Village, Family, Building, Rect } from "./village";
import { P } from "../world/navgrid";

const WALK = 2.3; // m/s

const randIn = (r: Rect, m = 1): P => ({
  x: r.minX + m + Math.random() * Math.max(0.1, r.maxX - r.minX - 2 * m),
  z: r.minZ + m + Math.random() * Math.max(0.1, r.maxZ - r.minZ - 2 * m),
});

function around(b: Building): P {
  // Un punto junto al perímetro de la obra
  const r = b.rect, side = Math.floor(Math.random() * 4), t = Math.random();
  const x = side < 2 ? r.minX + (r.maxX - r.minX) * t : side === 2 ? r.minX - 1.2 : r.maxX + 1.2;
  const z = side >= 2 ? r.minZ + (r.maxZ - r.minZ) * t : side === 0 ? r.minZ - 1.2 : r.maxZ + 1.2;
  return { x, z };
}

/**
 * Rutina diaria de cada familia (representada por un aldeano): de día va al
 * trabajo o a la obra; de noche vuelve a casa y desaparece dentro.
 */
export function updateVillagers(v: Village, dt: number) {
  const hour = v.hour;
  const dayTime = hour > 0.27 && hour < 0.75;
  for (const f of v.families) step(v, f, dayTime, dt);
}

function goal(v: Village, f: Family, dayTime: boolean): { key: string; at: () => P; work: boolean } {
  const home = f.home;
  if (!dayTime) {
    if (home) return { key: `home${home.id}`, at: () => home.door, work: false };
    const c = v.campfire();
    return { key: "camp", at: () => ({ x: c.x + (Math.random() - 0.5) * 4, z: c.z + (Math.random() - 0.5) * 4 }), work: false };
  }
  const w = f.work;
  if (w) {
    if (w.type.kind === "woodcutter") return { key: `wood${w.id}`, at: () => w.door, work: true };
    if (w.type.kind === "farm" && w.fieldRect && v.season !== 3) {
      const fr = w.fieldRect;
      return { key: `field${w.id}`, at: () => randIn(fr, 1.5), work: true };
    }
    if (w.type.kind === "market") return { key: `mkt${w.id}`, at: () => ({ x: w.x + (Math.random() - 0.5) * 6, z: w.z + (Math.random() - 0.5) * 6 }), work: true };
    return { key: `work${w.id}`, at: () => w.door, work: true };
  }
  const s = f.site;
  if (s) return { key: `site${s.id}`, at: () => around(s), work: true };
  const c = v.campfire();
  return { key: "idle", at: () => ({ x: c.x + (Math.random() - 0.5) * 10, z: c.z + (Math.random() - 0.5) * 10 }), work: false };
}

function step(v: Village, f: Family, dayTime: boolean, dt: number) {
  const a = f.v;
  // En la leva: está con su regimiento. Durante un saqueo: escondidos en casa.
  if (f.levied !== null) { a.visible = false; return; }
  if (v.underAttack) { a.visible = false; a.goalKey = ""; a.path = []; return; }
  const g = goal(v, f, dayTime);
  if (g.key !== a.goalKey) {
    a.goalKey = g.key;
    a.working = false;
    a.tree = null;
    a.visible = true;
    const p = g.at();
    a.spot = p;
    a.path = v.nav.findPath(a.x, a.z, p.x, p.z) ?? [p];
  }

  // Leñadores: buscan un árbol cercano al llegar y vuelven a buscar cuando cae
  if (a.goalKey.startsWith("wood") && f.work && !a.path.length && (!a.tree || !a.tree.alive)) {
    const trees = v.forest.within(f.work.door.x, f.work.door.z, 45);
    if (trees.length) {
      let best = trees[0], bd = Infinity;
      for (const t of trees) { const d = Math.hypot(t.x - a.x, t.z - a.z) + Math.random() * 8; if (d < bd) { bd = d; best = t; } }
      a.tree = best;
      const ang = Math.atan2(a.x - best.x, a.z - best.z);
      const p = { x: best.x + Math.sin(ang) * 1.3, z: best.z + Math.cos(ang) * 1.3 };
      a.path = v.nav.findPath(a.x, a.z, p.x, p.z) ?? [p];
    }
  }

  if (a.path.length) {
    a.working = false;
    const wp = a.path[0];
    const dx = wp.x - a.x, dz = wp.z - a.z, d = Math.hypot(dx, dz);
    const s = Math.min(d, WALK * dt);
    if (d > 1e-3) { a.x += (dx / d) * s; a.z += (dz / d) * s; a.heading = Math.atan2(dx, dz); }
    if (d - s < 0.05) a.path.shift();
    a.anim += dt * 9;
  } else {
    a.working = g.work;
    if (a.working) {
      a.anim += dt * 5;
      if (a.tree) a.heading = Math.atan2(a.tree.x - a.x, a.tree.z - a.z);
      // Campo y obra: cambiar de sitio de vez en cuando
      if ((a.goalKey.startsWith("field") || a.goalKey.startsWith("site") || a.goalKey.startsWith("mkt")) && Math.random() < dt * 0.08) {
        const p = g.at();
        a.path = v.nav.findPath(a.x, a.z, p.x, p.z) ?? [p];
      }
    } else if (a.goalKey.startsWith("home")) {
      a.visible = false;              // dentro de casa
    } else if ((a.goalKey === "idle" || a.goalKey === "camp") && Math.random() < dt * 0.05) {
      const p = g.at();
      a.path = v.nav.findPath(a.x, a.z, p.x, p.z) ?? [p];
    }
  }
  a.y = Math.max(0, v.terrain.heightAt(a.x, a.z));
}
