import * as THREE from "three";
import { Terrain } from "./terrain";
import { Forest } from "./forest";

// Luz del día y estaciones: color del cielo, intensidad y dirección del sol,
// tinte del terreno y de los árboles, y nieve en invierno.

const SKY_DAY = new THREE.Color("#b9d3df"), SKY_DUSK = new THREE.Color("#dca57e"), SKY_NIGHT = new THREE.Color("#2b3852");
const SEASON_TINT = [new THREE.Color(1, 1, 1), new THREE.Color(1.05, 1.0, 0.82), new THREE.Color(1.14, 0.93, 0.66), new THREE.Color(0.95, 0.97, 1.0)];
const TREE_TINT = [new THREE.Color(1, 1, 1), new THREE.Color(1, 0.98, 0.9), new THREE.Color(1.02, 0.94, 0.82), new THREE.Color(1.25, 1.3, 1.35)];

export interface Lights {
  scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sunOffset: THREE.Vector3;
}

/** hour: 0–1 (0.5 = mediodía). season: 0–4 continuo (0 primavera … 3 invierno). */
export function applyAtmosphere(l: Lights, terrain: Terrain, forest: Forest, hour: number, season: number) {
  const elev = Math.sin((hour - 0.25) * Math.PI * 2);           // -1 medianoche, 1 mediodía
  const day = THREE.MathUtils.clamp(elev * 1.4 + 0.35, 0.28, 1);
  const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 3, 0, 1) * (elev > -0.3 ? 1 : 0);

  const sky = new THREE.Color().copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.6);
  (l.scene.background as THREE.Color).copy(sky);
  (l.scene.fog as THREE.Fog).color.copy(sky);
  l.sun.intensity = 2.5 * Math.max(0.12, day * day);
  l.sun.color.set("#fff1d6").lerp(new THREE.Color("#ffad6b"), dusk);
  l.hemi.intensity = 0.45 + 0.7 * day;
  const az = (hour - 0.25) * Math.PI * 2;
  l.sunOffset.set(-Math.cos(az) * 150, 40 + Math.max(0, elev) * 130, 70 - Math.sin(az) * 40);

  const s = Math.floor(season) % 4, t = season - Math.floor(season);
  const k = THREE.MathUtils.smoothstep(t, 0.75, 1);              // cambia en los últimos días de cada estación
  terrain.tint.value.copy(SEASON_TINT[s]).lerp(SEASON_TINT[(s + 1) % 4], k);
  const snow = s === 3 ? 1 - k : s === 2 ? k : 0;   // primeras nieves a final de otoño, deshielo a final de invierno
  terrain.snow.value = snow * 0.6;
  forest.setTint(new THREE.Color().copy(TREE_TINT[s]).lerp(TREE_TINT[(s + 1) % 4], k).lerp(TREE_TINT[3], s === 3 ? snow * 0.5 : 0));
}
