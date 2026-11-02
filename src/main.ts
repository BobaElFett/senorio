import * as THREE from "three";
import { Terrain } from "./world/terrain";
import { Forest } from "./world/forest";
import { NavGrid } from "./world/navgrid";
import { applyAtmosphere, Lights } from "./world/atmosphere";
import { RtsCamera } from "./camera/rtsCamera";
import { Battle } from "./combat/battle";
import { BattleView } from "./combat/view";
import { Controls } from "./combat/controls";
import { Hud } from "./ui/hud";
import { Village } from "./settlement/village";
import { VillageView } from "./settlement/villageView";
import { VillageControls } from "./settlement/villageControls";
import { updateVillagers } from "./settlement/villagers";
import { VillageHud } from "./ui/villageHud";
import { Campaign, Phase, Difficulty, DIFFICULTY } from "./campaign/campaign";
import { serialize, restore, readSave, writeSave } from "./core/save";
import { loadSettings, Settings } from "./core/settings";
import { Menu } from "./ui/menu";
import { GameAudio } from "./audio/audio";
import { Particles } from "./world/particles";
import { Objectives } from "./ui/objectives";
import { Regions } from "./world/regions";
import { RegionsView } from "./world/regionsView";
import { MapPanel } from "./ui/mapPanel";
import { Rival } from "./campaign/rival";

type Mode = "village" | "battle";

// --- Renderer y escena ---------------------------------------------------
const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#b9d3df");
scene.fog = new THREE.Fog(new THREE.Color("#b9d3df"), 260, 620);

// --- Mundo ----------------------------------------------------------------
const terrain = new Terrain();
const forest = new Forest(terrain);
scene.add(terrain.mesh, terrain.water, forest.group);
const nav = new NavGrid(terrain, forest.trees);

// --- Luz ------------------------------------------------------------------
const hemi = new THREE.HemisphereLight("#dfeaf2", "#5a6b3c", 1.1);
const sun = new THREE.DirectionalLight("#fff1d6", 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -120; sc.right = sc.top = 120; sc.near = 1; sc.far = 500;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(hemi, sun, sun.target);
const lights: Lights = { scene, sun, hemi, sunOffset: new THREE.Vector3(-120, 160, 80) };

// --- Sistemas ------------------------------------------------------------
const rts = new RtsCamera(renderer.domElement, terrain);
const village = new Village(terrain, nav, forest);
const regions = new Regions();
village.regions = regions;
const regionsView = new RegionsView(regions, terrain);
scene.add(regionsView.group);
const villageView = new VillageView(scene, terrain);

// Partida: aldea y combate en el mismo mapa
const battle = new Battle(terrain, nav);
const campaign = new Campaign(village, battle);
const rival = new Rival(village, battle, regions, terrain, nav);
scene.add(rival.group);
campaign.rival = rival;
rival.onDefeat = () => campaign.rivalDefeated();
const battleView = new BattleView(scene, terrain);
const controls = new Controls(renderer.domElement, rts, terrain, battle, battleView);
const vControls = new VillageControls(renderer.domElement, rts, village, villageView,
  (x, y) => controls.groundAt(x, y), () => vHud.invalidate(), () => controls.consumed);
controls.suspended = () => vControls.buildKind !== null;
const vHud = new VillageHud(village, vControls, (kind) => {
  const r = campaign.levy(kind);
  if (r) controls.select([r]);   // el panel del cuartel sigue abierto para reclutar más
});
const hud = new Hud(battle, controls, { start() {}, restart() {} }, "v-", {
  banner: () => campaign.banner(),
  disband: (r) => { campaign.disband(r); controls.selected.delete(r); },
});

// Mapa del señorío
let mapT = 0;
const mapPanel = new MapPanel(regions, terrain, forest, village, battle, () => rts.target,
  (x, z) => { const v = rts.getView(); rts.setView(x, z, v.yaw, Math.max(90, v.d)); });
document.getElementById("map-btn")!.addEventListener("click", (e) => { if (inGame) mapPanel.toggle(); (e.target as HTMLElement).blur(); });

// Sonido, partículas y ajustes
const audio = new GameAudio();
const particles = new Particles();
scene.add(particles.group);
const settings = loadSettings();
battle.onEvent = (kind, x, z) => soundFor(kind, x, z);
battle.walls = () => village.walls;
battle.onWallHit = (id, dmg) => village.damageWall(id, dmg);

function soundFor(kind: "strike" | "fire" | "hit" | "charge" | "rout", x: number, z: number) {
  if (kind === "strike") audio.play("clash", x, z);
  else if (kind === "fire") audio.play("loose", x, z, 0.8);
  else if (kind === "hit") audio.play("thud", x, z);
  else if (kind === "charge") audio.play("charge", x, z);
  else audio.play("rout", x, z);
}

// Batalla de prueba: un combate aparte, 3 contra 3
const testBattle = new Battle(terrain, nav);
const testView = new BattleView(scene, terrain);
const testControls = new Controls(renderer.domElement, rts, terrain, testBattle, testView);
const testHud = new Hud(testBattle, testControls, { start: () => testBattle.start(), restart: resetBattle });
testBattle.onEvent = (kind, x, z) => soundFor(kind, x, z);

// Objetivos de la primera partida
const objectives = new Objectives(village, campaign, battle, (title) => {
  village.event(`Objetivo cumplido: ${title.toLowerCase()}`, "good");
});

// --- Partida: empezar, cargar y guardar ----------------------------------
let inGame = false;
let menuPaused = false;
function beginNew(difficulty: Difficulty = "normal") {
  if (mode !== "village") { mode = "battle"; inGame = true; setMode("village"); inGame = false; }
  campaign.difficulty = difficulty;
  village.setup();
  rival.setup();
  if (difficulty !== "normal") village.event(`Dificultad: ${DIFFICULTY[difficulty].label.toLowerCase()}`, "info");
  inGame = true;
  rts.setView(4, 30, 0.5, 105);
}
function beginFromSave(): boolean {
  const d = readSave();
  if (!d) return false;
  if (mode !== "village") { inGame = true; setMode("village"); inGame = false; }
  restore(d, village, forest, campaign, battle);
  for (const id of d.objectives ?? []) objectives.done.add(id);
  objectives.collapsed = !!d.objectivesCollapsed;
  inGame = true;
  const store = village.buildings.find((b) => b.type.kind === "storehouse");
  rts.setView(store ? store.x + 4 : 4, store ? store.z + 30 : 30, 0.5, 105);
  return true;
}
function saveNow(): boolean {
  if (!inGame) return false;
  const data = serialize(village, forest, campaign, battle);
  data.objectives = [...objectives.done];
  data.objectivesCollapsed = objectives.collapsed;
  return writeSave(data);
}
// Partida nueva o carga a mitad de partida: se recarga la página para partir de un mundo limpio
function restartWith(flag: "new" | "continue", difficulty?: string) {
  try {
    sessionStorage.setItem("senorio.start", flag);
    if (difficulty) sessionStorage.setItem("senorio.difficulty", difficulty);
  } catch { /* */ }
  location.reload();
}

const menu = new Menu({
  continueGame: () => {
    if (inGame) { restartWith("continue"); return; }
    if (beginFromSave()) closeMenu();
  },
  newGame: (diff) => {
    const d = (diff in DIFFICULTY ? diff : "normal") as Difficulty;
    if (inGame) { restartWith("new", d); return; }
    beginNew(d); closeMenu();
  },
  saveGame: () => { const ok = saveNow(); if (ok) village.event("Partida guardada", "info"); return ok; },
  testBattle: () => { setMode("battle"); closeMenu(); },
  resume: () => closeMenu(),
  settingsChanged: (s) => applySettings(s),
}, settings, () => inGame);

function openMenu() { menu.open(); menuPaused = true; audio.play("click"); }
function closeMenu() {
  menu.close(); menuPaused = false;
  if (!inGame && mode === "village") { menu.open(); menuPaused = true; }   // sin partida, la aldea no tiene nada que mostrar
}
function applySettings(s: Settings) {
  audio.setVolumes(s.master, s.music, s.sfx);
  rts.edgePan = s.edgePan;
  document.querySelectorAll(".edge").forEach((x) => (x.textContent = s.edgePan ? "activado" : "desactivado"));
  document.getElementById("help")!.hidden = !s.help;
  // Gráficos sencillos: sin sombras y sin escalar a pantallas de alta densidad
  sun.castShadow = !s.lowGraphics;
  renderer.setPixelRatio(s.lowGraphics ? 1 : Math.min(window.devicePixelRatio, 2));
}
applySettings(settings);

let mode: Mode = "village";
let paused = false;
let speed = 1;
const views: Record<Mode, { x: number; z: number; yaw: number; d: number } | null> = { village: null, battle: null };

function resetBattle() {
  testBattle.setup();
  testControls.selected.clear();
  rts.setView(-85, 0, Math.PI / 2, 120);
  paused = false;
}

function setMode(m: Mode) {
  if (m === mode && document.body.dataset.mode === m) return;
  if (m === "village" && !inGame && document.body.dataset.mode) { openMenu(); return; }
  // Cada modo recuerda su encuadre de cámara
  views[mode] = rts.getView();
  mode = m;
  document.body.dataset.mode = m;
  controls.enabled = m === "village";
  vControls.enabled = m === "village";
  testControls.enabled = m === "battle";
  if (m === "battle") {
    vControls.cancelBuild();
    vControls.selected = null;
    if (!testBattle.regiments.length) resetBattle();
  }
  battleView.setVisible(m === "village");
  regionsView.group.visible = m === "village";
  rival.group.visible = m === "village";
  if (m !== "village") mapPanel.close();
  testView.setVisible(m === "battle");
  const v = views[m];
  if (v) rts.setView(v.x, v.z, v.yaw, v.d);
  else if (m === "battle") rts.setView(-85, 0, Math.PI / 2, 120);
  document.querySelectorAll<HTMLButtonElement>("#modebar button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
}
document.querySelectorAll<HTMLButtonElement>("#modebar button[data-mode]").forEach((b) =>
  b.addEventListener("click", () => { setMode(b.dataset.mode as Mode); b.blur(); }));
document.getElementById("menu-btn")!.addEventListener("click", (e) => { openMenu(); (e.target as HTMLElement).blur(); });

document.body.dataset.mode = "";
setMode("village");
// ¿Venimos de «Partida nueva» o «Cargar» a mitad de partida? Si no, menú principal.
let startFlag: string | null = null;
let startDiff: Difficulty = "normal";
try {
  startFlag = sessionStorage.getItem("senorio.start"); sessionStorage.removeItem("senorio.start");
  const d = sessionStorage.getItem("senorio.difficulty"); sessionStorage.removeItem("senorio.difficulty");
  if (d && d in DIFFICULTY) startDiff = d as Difficulty;
} catch { /* */ }
if (startFlag === "new") beginNew(startDiff);
else if (startFlag === "continue" && beginFromSave()) { /* cargada */ }
else { rts.setView(4, 30, 0.5, 140); openMenu(); }
window.addEventListener("beforeunload", () => { if (inGame) saveNow(); });

function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h);
  rts.resize(w, h);
}
window.addEventListener("resize", resize);
resize();

// Teclas generales
const help = document.getElementById("help")!;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyM" || (e.code === "Escape" && menu.isOpen)) {
    if (menu.isOpen) { if (inGame || mode === "battle") closeMenu(); } else openMenu();
    return;
  }
  if (menu.isOpen) return;
  if (mapPanel.isOpen && e.code === "Escape") { mapPanel.close(); return; }
  if (e.code === "KeyN" && mode === "village" && inGame) { mapPanel.toggle(); return; }
  if (e.code === "KeyH") help.hidden = !help.hidden;
  else if (e.code === "KeyB") {
    settings.edgePan = !settings.edgePan;
    applySettings(settings);
  } else if (e.code === "Space") { e.preventDefault(); paused = !paused; }
  else if (e.code === "KeyT") speed = speed === 1 ? 2 : speed === 2 ? 3 : speed === 3 ? 5 : 1;
  else if (e.code === "Tab") { e.preventDefault(); setMode(mode === "village" ? "battle" : "village"); }
  else if (mode === "battle") {
    if (e.code === "Enter" || e.code === "NumpadEnter") testBattle.start();
    else if (e.code === "KeyR" && !e.ctrlKey) resetBattle();
  }
});

/** Humo de chimeneas, incendios del saqueo, martillazos de las obras, avisos sonoros y autoguardado. */
function villageEffects(dt: number) {
  const gdt = paused ? 0 : dt * speed;
  // Autoguardado al empezar cada día
  const day = Math.floor(village.day);
  if (lastDay >= 0 && day !== lastDay) saveNow();
  lastDay = day;
  // Avisos con sonido
  for (const ev of village.events) {
    if (ev.id <= lastEvent) continue;
    lastEvent = ev.id;
    if (ev.kind === "bad") audio.play("bell", undefined, undefined, 0.6);
    else if (ev.kind === "good") audio.play("chime", undefined, undefined, 0.7);
  }
  if (campaign.phase !== lastPhase) {
    if (campaign.phase === "raid" && lastPhase === "warning") audio.play("horn");
    if (campaign.phase === "calm" && (lastPhase === "raid" || lastPhase === "plunder")) audio.play("fanfare");
    if (campaign.phase === "won") audio.play("fanfare");
    lastPhase = campaign.phase;
  }
  if (village.buildings.length > lastBuildings && lastBuildings > 0) audio.play("place");
  lastBuildings = village.buildings.length;
  if (!gdt) return;
  // Martillazos en las obras con constructores
  hammerT -= gdt;
  if (hammerT <= 0) {
    hammerT = 0.35 + Math.random() * 0.4;
    const sites = village.buildings.filter((b) => !b.built && village.families.some((f) => f.site === b));
    const s = sites[Math.floor(Math.random() * sites.length)];
    if (s) audio.play("hammer", s.x, s.z, 0.7);
  }
  // Humo de las casas habitadas (más en invierno y al anochecer)
  smokeT -= gdt;
  if (smokeT <= 0) {
    const cold = village.season === 3 || village.hour < 0.3 || village.hour > 0.75;
    smokeT = cold ? 0.25 : 0.6;
    for (const h of village.houses) {
      if (!h.residents.length || Math.random() > 0.35) continue;
      const th = h.rot * Math.PI / 2, lx = -1.8, lz = -1;
      const x = h.x + lx * Math.cos(th) + lz * Math.sin(th), z = h.z - lx * Math.sin(th) + lz * Math.cos(th);
      const top = Math.max(terrain.heightAt(h.rect.minX, h.rect.minZ), terrain.heightAt(h.rect.maxX, h.rect.maxZ), terrain.heightAt(h.rect.minX, h.rect.maxZ), terrain.heightAt(h.rect.maxX, h.rect.minZ));
      particles.chimney(x, top + 5.3, z);
    }
    // La herrería echa humo mientras forja
    for (const h of village.buildings) {
      if (h.type.kind !== "smithy" || !h.built || !h.workers.length || !village.forging) continue;
      const th = h.rot * Math.PI / 2, lx = -2.5, lz = -2;
      const x = h.x + lx * Math.cos(th) + lz * Math.sin(th), z = h.z - lx * Math.sin(th) + lz * Math.cos(th);
      particles.chimney(x, terrain.heightAt(h.x, h.z) + 6, z);
      if (Math.random() < 0.5) audio.play("hammer", h.x, h.z, 0.5);
    }
  }
  // Saqueo: arden los edificios cercanos a los bandidos
  if (campaign.phase === "plunder" && battle.raidTarget) {
    const t = battle.raidTarget;
    const near = village.buildings.filter((b) => b.built && Math.hypot(b.x - t.x, b.z - t.z) < 40).slice(0, 4);
    for (const b of near) {
      const n = Math.floor(gdt * 30 + Math.random());
      for (let k = 0; k < n; k++) particles.blaze(b.x, terrain.heightAt(b.x, b.z) + 4.2, b.z, Math.min(b.type.w, b.type.d) * 0.55);
    }
  }
}

// --- Bucle ----------------------------------------------------------------
const fpsEl = document.getElementById("fps")!;
const clock = new THREE.Clock();
let frames = 0, acc = 0;
let lastDay = -1, lastPhase: Phase = "calm", lastBuildings = 0, hammerT = 0, smokeT = 0, lastEvent = 0;
let orbit = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  // Pantalla de título: sin la interfaz de una aldea que aún no existe
  const title = !inGame && mode === "village" ? "1" : "0";
  if (document.body.dataset.title !== title) document.body.dataset.title = title;
  if (menu.isOpen && !inGame && mode === "village") {
    // Fondo del menú principal: la cámara gira despacio sobre el valle
    orbit += dt * 0.05;
    rts.setView(Math.sin(orbit) * 30, 20 + Math.cos(orbit) * 30, 0.5 + orbit, 140);
  } else rts.update(dt);
  if (!paused && !menuPaused && (inGame || mode === "battle")) {
    // Pasos fijos cortos: la simulación no depende de los FPS
    let left = dt * speed;
    while (left > 1e-4) {
      const step = Math.min(left, 1 / 30);
      if (mode === "battle") testBattle.update(step);
      else {
        village.update(step);
        updateVillagers(village, step);
        battle.update(step);
        campaign.update(step);
      }
      left -= step;
    }
  }
  if (mode === "battle") {
    testControls.prune();
    testView.update(testBattle, rts.camera, testControls.selected, testControls.previews, true);
    testHud.update(dt, paused, speed);
    applyAtmosphere(lights, terrain, forest, 0.45, 1.4);       // batalla: mediodía de verano
  } else {
    vControls.prune();
    controls.prune();
    applyAtmosphere(lights, terrain, forest, village.hour, village.seasonFloat);
    battleView.update(battle, rts.camera, controls.selected, controls.previews, true);
    vHud.update(dt, paused, speed);
    objectives.update(dt, inGame);
    hud.update(dt, paused, speed);
  }
  villageView.update(village, mode === "village" ? vControls.selected : null, dt);
  regionsView.refresh();
  mapT -= dt;
  if (mapT <= 0) { mapT = 0.25; mapPanel.update(); }
  if (inGame && mode === "village") villageEffects(dt);
  particles.update(menuPaused || paused ? 0 : dt * speed);
  audio.hour = mode === "battle" ? 0.5 : village.hour;
  audio.tension = mode === "battle" ? (testBattle.started && testBattle.result === null ? 1 : 0)
    : ["raid", "plunder"].includes(campaign.phase) ? 1 : 0;
  const view = rts.getView();
  audio.setListener(rts.target.x, rts.target.z, view.d);
  audio.update(dt);
  // La sombra sigue a la cámara para que siempre tenga resolución donde miras
  sun.target.position.copy(rts.target);
  sun.position.copy(rts.target).add(lights.sunOffset);
  renderer.render(scene, rts.camera);

  frames++; acc += dt;
  if (acc >= 0.5) { fpsEl.textContent = `${Math.round(frames / acc)} FPS`; frames = 0; acc = 0; }
});

// Acceso de depuración desde la consola del navegador
(window as any).game = { rival, regions, mapPanel, scene, terrain, rts, renderer, battle, controls, nav, village, vControls, forest, setMode, campaign, testBattle, testControls, menu, audio, saveNow, beginNew, beginFromSave, particles };
