import * as THREE from "three";
import { BuildingKind, BUILDINGS } from "../data/buildings";

// Modelos low-poly de los edificios, generados por código.
// Coordenadas locales: centrados en el origen, suelo en y = 0, fachada hacia +z.

const mat = (() => {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  return (color: string) => {
    let m = cache.get(color);
    if (!m) cache.set(color, (m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 })));
    return m;
  };
})();

const C = {
  plaster: "#e3d6b4", timber: "#6b4a2e", roof: "#8f4f2f", thatch: "#b89a5a", wood: "#9a7246",
  darkWood: "#4f3622", stone: "#9a968a", door: "#4a3020", hay: "#d6b65a", cloth1: "#b8463a",
  cloth2: "#3f6fae", cloth3: "#d8b04a", log: "#7a5634", logEnd: "#c9a477", blue: "#2f58b0",
};

function box(w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  return m;
}

/** Tejado a dos aguas: prisma triangular con la cumbrera a lo largo de x. */
function gable(w: number, d: number, h: number, color: string, y: number, z = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, h); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(0, y, z);
  return m;
}

function logPile(x: number, z: number, n: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.22, 0.22, 2.4, 6);
  geo.rotateZ(Math.PI / 2);
  let k = 0;
  for (let row = 0; row < 3 && k < n; row++) {
    for (let i = 0; i < 4 - row && k < n; i++, k++) {
      const m = new THREE.Mesh(geo, mat(C.log));
      m.position.set(x, 0.22 + row * 0.38, z + (i - (3 - row) / 2) * 0.46);
      g.add(m);
    }
  }
  return g;
}

function house(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(5.4, 2.8, 4.6, C.plaster));
  // Entramado de madera en las esquinas
  for (const [x, z] of [[-2.7, -2.3], [2.7, -2.3], [-2.7, 2.3], [2.7, 2.3]]) g.add(box(0.25, 2.8, 0.25, C.timber, x, 0, z));
  g.add(box(5.6, 0.22, 4.8, C.timber, 0, 2.7, 0));
  g.add(gable(6.2, 5.6, 2.2, C.thatch, 2.9));
  g.add(box(1, 1.7, 0.12, C.door, 0.8, 0, 2.32));
  g.add(box(0.7, 0.6, 0.1, C.darkWood, -1.4, 1.3, 2.32));
  g.add(box(0.6, 1.6, 0.6, C.stone, -1.8, 3.6, -1));
  return g;
}

function woodcutter(): THREE.Group {
  const g = new THREE.Group();
  // Cobertizo abierto: postes y tejado inclinado
  for (const [x, z] of [[-3, -2.6], [3, -2.6], [-3, 1.2], [3, 1.2]]) g.add(box(0.3, z < 0 ? 3 : 2.4, 0.3, C.timber, x, 0, z));
  const roof = box(7, 0.2, 4.6, C.roof, 0, 0, -0.7);
  roof.position.y = 2.75;
  roof.rotation.x = 0.13;
  g.add(roof);
  g.add(box(6.4, 1.4, 0.2, C.wood, 0, 0, -2.6));
  g.add(logPile(-1.2, -1, 9));
  g.add(logPile(1.6, -1, 6));
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.6, 7), mat(C.logEnd));
  stump.position.set(2, 0.3, 2.4);
  g.add(stump);
  return g;
}

function farm(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(5, 2.6, 4.2, C.plaster, -0.8, 0, -0.6));
  g.add(gable(5.8, 5.2, 2, C.thatch, 2.6, -0.6));
  g.add(box(1, 1.6, 0.12, C.door, -0.8, 0, 1.52));
  const hay = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.2, 7), mat(C.hay));
  hay.position.set(2.8, 1.1, 1.6);
  g.add(hay);
  // Cerca baja
  for (let i = 0; i < 5; i++) g.add(box(0.15, 0.9, 0.15, C.timber, 3.6, 0, -2.8 + i * 1.2));
  g.add(box(0.1, 0.12, 5, C.timber, 3.6, 0.65, -0.4));
  return g;
}

function storehouse(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(9.6, 3.6, 6.4, C.wood));
  for (const x of [-4.8, -1.6, 1.6, 4.8]) g.add(box(0.3, 3.6, 6.6, C.darkWood, x, 0, 0));
  g.add(gable(10.4, 7.4, 2.8, C.roof, 3.6));
  g.add(box(2.6, 2.6, 0.14, C.darkWood, 0, 0, 3.22));
  for (const [x, z] of [[-3.4, 4], [-2.6, 4.3], [3.3, 4.1]]) g.add(box(0.8, 0.8, 0.8, C.wood, x, 0, z));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.95, 8), mat(C.log));
  barrel.position.set(4.2, 0.48, 4.1);
  g.add(barrel);
  return g;
}

function market(): THREE.Group {
  const g = new THREE.Group();
  const well = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 0.9, 10), mat(C.stone));
  well.position.y = 0.45;
  g.add(well);
  g.add(box(0.15, 2, 0.15, C.timber, -0.8, 0, 0), box(0.15, 2, 0.15, C.timber, 0.8, 0, 0));
  g.add(gable(2, 1.6, 0.6, C.roof, 2, 0));
  const cloths = [C.cloth1, C.cloth2, C.cloth3, C.cloth1];
  [[-3.8, -3.8, 0], [3.8, -3.8, 0], [-3.8, 3.8, Math.PI], [3.8, 3.8, Math.PI]].forEach(([x, z, r], i) => {
    const s = new THREE.Group();
    s.add(box(2.6, 0.9, 1.1, C.wood, 0, 0, 0));
    for (const px of [-1.2, 1.2]) s.add(box(0.12, 2.3, 0.12, C.timber, px, 0, -0.5), box(0.12, 2, 0.12, C.timber, px, 0, 0.6));
    const awning = box(2.9, 0.08, 1.7, cloths[i], 0, 0, 0);
    awning.position.y = 2.15; awning.rotation.x = -0.25;
    s.add(awning);
    s.add(box(0.5, 0.35, 0.5, C.hay, -0.6, 0.9, 0), box(0.5, 0.3, 0.5, C.cloth1, 0.5, 0.9, 0));
    s.position.set(x, 0, z);
    s.rotation.y = r;
    g.add(s);
  });
  return g;
}

function barracks(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(9, 3, 5, C.wood, 0, 0, -1.5));
  g.add(gable(9.8, 6, 2.2, C.roof, 3, -1.5));
  g.add(box(1.4, 2, 0.12, C.door, 0, 0, 1.05));
  // Empalizada a los lados
  for (let i = 0; i < 8; i++) {
    g.add(box(0.35, 2.2, 0.35, C.darkWood, -5.6, 0, -4.4 + i * 1.2));
    g.add(box(0.35, 2.2, 0.35, C.darkWood, 5.6, 0, -4.4 + i * 1.2));
  }
  // Muñeco de entrenamiento y mástil con bandera
  g.add(box(0.2, 1.6, 0.2, C.timber, 3, 0, 3), box(1.2, 0.18, 0.18, C.timber, 3, 1.1, 3), box(0.5, 0.5, 0.4, C.hay, 3, 1.4, 3));
  g.add(box(0.12, 6, 0.12, C.timber, -3.5, 0, 3.5));
  const flag = box(1.6, 1, 0.05, C.blue, -2.7, 0, 3.5);
  flag.position.y = 5.2;
  g.add(flag);
  return g;
}

const BUILDERS: Record<BuildingKind, () => THREE.Group> = { house, woodcutter, farm, storehouse, market, barracks };

export function buildingModel(kind: BuildingKind): THREE.Group {
  const g = BUILDERS[kind]();
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Obra: cimientos, andamio y muros que suben con el progreso. */
export function constructionModel(kind: BuildingKind): { group: THREE.Group; walls: THREE.Mesh } {
  const t = BUILDINGS[kind];
  const g = new THREE.Group();
  const w = t.w - 1.6, d = t.d - 1.6, h = 3;
  const walls = box(w, h, d, C.wood);
  walls.scale.y = 0.01;
  g.add(walls);
  const poles: [number, number][] = [[-w / 2 - 0.4, -d / 2 - 0.4], [w / 2 + 0.4, -d / 2 - 0.4], [-w / 2 - 0.4, d / 2 + 0.4], [w / 2 + 0.4, d / 2 + 0.4]];
  for (const [x, z] of poles) g.add(box(0.18, h + 1.2, 0.18, C.timber, x, 0, z));
  g.add(box(w + 1, 0.14, 0.18, C.timber, 0, h * 0.55, -d / 2 - 0.4), box(w + 1, 0.14, 0.18, C.timber, 0, h * 0.55, d / 2 + 0.4));
  g.add(logPile(w / 2 + 1.6, 0, 5));
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, walls };
}
