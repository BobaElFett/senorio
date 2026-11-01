import { Village, Building, Family } from "../settlement/village";
import { Forest } from "../world/forest";
import { Campaign, Phase } from "../campaign/campaign";
import { Battle, Team, RegState } from "../combat/battle";
import { BuildingKind } from "../data/buildings";
import { UnitKind } from "../data/units";

// Guardado de la partida en el navegador (localStorage). Una ranura más un autoguardado diario.

const KEY = "senorio.save.v1";
const VERSION = 1;

interface SavedRegiment {
  id: number; team: Team; name: string; kind: UnitKind; x: number; z: number; facing: number; files: number;
  size: number; morale: number; state: RegState; plundering: boolean; withdrawing: boolean;
  soldiers: { x: number; z: number; hp: number; heading: number; family: number }[];
}

export interface SaveData {
  v: number;
  savedAt: number;
  summary: string;
  village: {
    day: number; res: Village["res"]; approval: number; mods: Village["mods"];
    nextId: number; nameIdx: number;
    buildings: { id: number; kind: BuildingKind; x: number; z: number; rot: number; built: boolean; progress: number; cutAcc: number }[];
    families: { id: number; name: string; home: number | null; work: number | null; prev: number | null; members: number; levied: number | null; x: number; z: number }[];
  };
  felled: number[];
  campaign: { raidIndex: number; phase: Phase; results: Campaign["results"]; plunderTime: number; withdrawTime: number; levyCount: Record<string, number>; difficulty?: Campaign["difficulty"]; endless?: boolean; endlessShift?: number };
  regiments: SavedRegiment[];
  objectives?: string[];
  objectivesCollapsed?: boolean;
}

export function summarize(v: Village): string {
  return `${v.seasonName}, día ${v.dayOfSeason} del año ${v.year} · ${v.families.length} familias · ${v.buildings.length} edificios`;
}

export function serialize(v: Village, forest: Forest, c: Campaign, b: Battle): SaveData {
  const vv = v as any, cc = c as any;
  return {
    v: VERSION,
    savedAt: Date.now(),
    summary: `${summarize(v)} · ${c.difficulty === "facil" ? "fácil" : c.difficulty === "dificil" ? "difícil" : "normal"}`,
    village: {
      day: v.day, res: { ...v.res }, approval: v.approval, mods: v.mods.map((m) => ({ ...m })),
      nextId: vv.nextId, nameIdx: vv.nameIdx,
      buildings: v.buildings.map((x) => ({ id: x.id, kind: x.type.kind, x: x.x, z: x.z, rot: x.rot, built: x.built, progress: x.progress, cutAcc: x.cutAcc })),
      families: v.families.map((f) => ({
        id: f.id, name: f.name, home: f.home?.id ?? null, work: f.work?.id ?? null, prev: f.prevWork?.id ?? null,
        members: f.members, levied: f.levied, x: f.v.x, z: f.v.z,
      })),
    },
    felled: forest.trees.flatMap((t, i) => (t.alive ? [] : [i])),
    campaign: { raidIndex: c.raidIndex, phase: c.phase, results: [...c.results], plunderTime: c.plunderTime, withdrawTime: c.withdrawTime, levyCount: { ...cc.levyCount }, difficulty: c.difficulty, endless: c.endless, endlessShift: c.endlessShift },
    regiments: b.regiments.filter((r) => r.state !== "gone" && r.alive.length).map((r) => ({
      id: r.id, team: r.team, name: r.name, kind: r.type.kind, x: r.x, z: r.z, facing: r.facing, files: r.files,
      size: r.size, morale: r.morale, state: r.state, plundering: r.plundering, withdrawing: r.withdrawing,
      soldiers: r.alive.map((s) => ({ x: s.x, z: s.z, hp: s.hp, heading: s.heading, family: s.family })),
    })),
  };
}

/** Reconstruye la partida en un mundo recién creado (sin `village.setup()`). */
export function restore(d: SaveData, v: Village, forest: Forest, c: Campaign, b: Battle) {
  const vv = v as any, cc = c as any;
  for (const i of d.felled) { const t = forest.trees[i]; if (t) forest.fell(t); }

  v.day = d.village.day;
  v.res = { ...d.village.res };
  v.approval = v.approvalTarget = d.village.approval;
  v.mods = d.village.mods.map((m) => ({ ...m }));
  const byId = new Map<number, Building>();
  for (const s of d.village.buildings) {
    const bld: Building = vv.addBuilding(s.kind, s.x, s.z, s.rot, s.built);
    bld.id = s.id; bld.progress = s.progress; bld.cutAcc = s.cutAcc;
    byId.set(s.id, bld);
  }
  for (const s of d.village.families) {
    const home = s.home !== null ? byId.get(s.home) ?? null : null;
    const work = s.work !== null ? byId.get(s.work) ?? null : null;
    const f: Family = {
      id: s.id, name: s.name, home, work, site: null, members: s.members, levied: s.levied,
      prevWork: s.prev !== null ? byId.get(s.prev) ?? null : null,
      v: { x: s.x, z: s.z, y: 0, heading: 0, path: [], goalKey: "", visible: s.levied === null, working: false, anim: Math.random() * 6, tree: null, spot: null },
    };
    if (home) home.residents.push(f);
    if (work) work.workers.push(f);
    v.families.push(f);
  }
  vv.nextId = d.village.nextId;
  vv.nameIdx = d.village.nameIdx;
  v.version++;

  // Regimientos: los ids nuevos sustituyen a los guardados en las familias de la leva
  const remap = new Map<number, number>();
  for (const s of d.regiments) {
    const r = b.spawn(s.team, s.name, s.kind, s.x, s.z, s.facing, s.soldiers.length, (i) => s.soldiers[i].family);
    remap.set(s.id, r.id);
    r.files = s.files; r.size = s.size; r.morale = s.morale; r.state = s.state;
    r.plundering = s.plundering; r.withdrawing = s.withdrawing;
    r.alive.forEach((sol, i) => {
      const o = s.soldiers[i];
      sol.x = o.x; sol.z = o.z; sol.hp = o.hp; sol.heading = o.heading;
      sol.y = v.terrain.heightAt(o.x, o.z);
    });
  }
  for (const f of v.families) if (f.levied !== null) f.levied = remap.get(f.levied) ?? null;

  c.raidIndex = d.campaign.raidIndex;
  c.phase = d.campaign.phase;
  c.results = [...d.campaign.results];
  c.plunderTime = d.campaign.plunderTime;
  c.withdrawTime = d.campaign.withdrawTime;
  cc.levyCount = { spear: 0, archer: 0, ...d.campaign.levyCount };
  c.difficulty = d.campaign.difficulty ?? "normal";
  c.endless = !!d.campaign.endless;
  c.endlessShift = d.campaign.endlessShift ?? 0;
  c.raiders = b.regiments.filter((r) => r.team === 1);
  v.event("Partida cargada", "info");
}

// ------------------------------------------------------------ almacenamiento
export function writeSave(d: SaveData): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch { return false; }
}

export function readSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d.v === VERSION ? d : null;
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}
