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

function mill(): THREE.Group {
  const g = new THREE.Group();
  // Torre troncocónica de piedra con caperuza y aspas que giran (userData.spin)
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.9, 7.5, 8), mat(C.stone));
  tower.position.y = 3.75;
  g.add(tower);
  const capRoof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 8), mat(C.roof));
  capRoof.position.y = 8.7;
  g.add(capRoof);
  g.add(box(1.1, 2, 0.12, C.door, 0, 0, 2.62));
  g.add(box(0.6, 0.7, 0.1, C.darkWood, 0, 4.4, 2.35));
  const hub = new THREE.Group();
  hub.position.set(0, 7.2, 2.6);
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 6), mat(C.darkWood));
  axle.rotation.x = Math.PI / 2;
  hub.add(axle);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    const spar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 5.2, 0.12), mat(C.timber));
    spar.position.y = 2.6;
    const sail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 3.8, 0.05), mat(C.plaster));
    sail.position.set(0.62, 3.1, 0.05);
    arm.add(spar, sail);
    hub.add(arm);
  }
  hub.userData.spin = true;
  g.add(hub);
  // Sacos de harina
  for (const [x, z] of [[-2.6, 2.4], [-2.1, 3.1], [2.7, 2.6]]) g.add(box(0.7, 0.6, 0.5, C.plaster, x, 0, z));
  return g;
}

function bakery(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(5.6, 2.8, 4.6, C.plaster, -0.6, 0, -0.4));
  for (const [x, z] of [[-3.4, -2.7], [2.2, -2.7], [-3.4, 1.9], [2.2, 1.9]]) g.add(box(0.25, 2.8, 0.25, C.timber, x, 0, z));
  g.add(gable(6.2, 5.6, 2.1, C.roof, 2.8, -0.4));
  g.add(box(1, 1.7, 0.12, C.door, -1.4, 0, 1.92));
  // Horno de cúpula a un lado, con su chimenea
  const oven = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.stone));
  oven.position.set(3.2, 0, 0.6);
  g.add(oven);
  g.add(box(0.5, 0.5, 0.2, "#2a1a10", 3.2, 0.1, 1.95));
  g.add(box(0.5, 1.8, 0.5, C.stone, 3.2, 1.1, 0.2));
  // Mesa con hogazas
  g.add(box(1.6, 0.8, 0.7, C.wood, 0.9, 0, 2.6));
  for (const x of [0.4, 0.9, 1.4]) {
    const loaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), mat(C.hay));
    loaf.scale.set(1.3, 0.7, 1);
    loaf.position.set(x, 0.92, 2.6);
    g.add(loaf);
  }
  return g;
}

function tower(): THREE.Group {
  const g = new THREE.Group();
  // Cuatro postes inclinados, plataforma con barandilla y tejadillo
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
    const p = box(0.32, 7.4, 0.32, C.timber, x * 0.85, 0, z * 0.85);
    p.rotation.set(z * 0.035, 0, -x * 0.035);
    g.add(p);
  }
  for (const y of [2.2, 4.4]) {
    g.add(box(3.1, 0.14, 0.14, C.darkWood, 0, y, -1.4), box(3.1, 0.14, 0.14, C.darkWood, 0, y, 1.4));
    g.add(box(0.14, 0.14, 3.1, C.darkWood, -1.4, y, 0), box(0.14, 0.14, 3.1, C.darkWood, 1.4, y, 0));
  }
  g.add(box(3.6, 0.22, 3.6, C.wood, 0, 7.2, 0));
  for (const [w, d, x, z] of [[3.6, 0.12, 0, -1.75], [3.6, 0.12, 0, 1.75], [0.12, 3.6, -1.75, 0], [0.12, 3.6, 1.75, 0]] as const) g.add(box(w, 0.9, d, C.wood, x, 7.4, z));
  for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) g.add(box(0.14, 2.2, 0.14, C.timber, x, 7.4, z));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.9, 1.8, 4), mat(C.roof));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 10.4;
  g.add(roof);
  g.add(box(0.5, 0.18, 2.4, C.darkWood, 0.9, 3.4, 0));   // escalera (simplificada)
  return g;
}

function horse(coat: string, x: number, z: number, r: number): THREE.Group {
  const h = new THREE.Group();
  h.add(box(0.55, 0.55, 1.5, coat, 0, 0.85, 0));
  const neck = box(0.28, 0.75, 0.32, coat, 0, 0, 0); neck.position.set(0, 1.65, 0.7); neck.rotation.x = 0.5; h.add(neck);
  const head = box(0.24, 0.26, 0.55, coat, 0, 0, 0); head.position.set(0, 1.95, 1.0); head.rotation.x = 0.4; h.add(head);
  for (const [lx, lz] of [[-0.18, 0.55], [0.18, 0.55], [-0.18, -0.55], [0.18, -0.55]]) h.add(box(0.13, 0.85, 0.15, coat, lx, 0, lz));
  h.position.set(x, 0, z); h.rotation.y = r;
  return h;
}

function stable(): THREE.Group {
  const g = new THREE.Group();
  // Cuadra alargada con tejado a un agua y cuatro boxes abiertos al frente
  g.add(box(10, 2.6, 3.6, C.wood, 0, 0, -2));
  const roof = box(10.8, 0.25, 4.6, C.thatch, 0, 2.7, -1.8); roof.rotation.x = 0.22; g.add(roof);
  for (let i = 0; i < 5; i++) g.add(box(0.25, 2.6, 0.25, C.timber, -5 + i * 2.5, 0, -0.1));
  g.add(horse("#6b4a2e", -3.75, -1.6, Math.PI), horse("#2f2a26", 1.25, -1.6, Math.PI));
  // Cercado con caballo suelto y heno
  for (let i = 0; i < 6; i++) g.add(box(0.15, 1.1, 0.15, C.darkWood, -5.5 + i * 2.2, 0, 3.7));
  g.add(box(11.2, 0.12, 0.08, C.timber, 0, 0.9, 3.7), box(11.2, 0.12, 0.08, C.timber, 0, 0.5, 3.7));
  g.add(horse("#8a6a4a", 3, 2, 1.2));
  g.add(box(1.1, 0.8, 0.9, C.hay, -3.8, 0, 2.2), box(0.9, 0.6, 0.9, C.hay, -2.6, 0, 2.4));
  g.add(box(1.4, 0.45, 0.5, C.darkWood, 0.2, 0, 1.6));   // abrevadero
  return g;
}

function smithy(): THREE.Group {
  const g = new THREE.Group();
  // Fragua de piedra con chimenea, cobertizo abierto, yunque y brasas
  g.add(box(3.2, 2.2, 2.6, C.stone, -1.9, 0, -1.6));
  g.add(box(1.1, 3.6, 1.1, C.stone, -2.5, 2.2, -2));
  g.add(box(0.9, 0.4, 0.5, "#ff7a2a", -1.9, 1.1, -0.2));         // brasas
  for (const [x, z] of [[-3.6, 0.1], [3.6, 0.1], [3.6, -2.9]]) g.add(box(0.3, 2.8, 0.3, C.timber, x, 0, z));
  const roof = box(7.8, 0.22, 3.6, C.roof, 0, 2.9, -1.5); roof.rotation.x = 0.18; g.add(roof);
  g.add(box(3.4, 2.4, 0.2, C.wood, 1.9, 0, -2.9));                // pared del fondo
  g.add(box(0.5, 0.55, 0.5, C.darkWood, 1, 0, 0.6), box(0.9, 0.22, 0.32, "#4a4e52", 1, 0.55, 0.6)); // yunque
  g.add(box(1.4, 0.5, 0.7, C.darkWood, 2.6, 0, 1.6));             // banco
  for (let i = 0; i < 3; i++) g.add(box(0.08, 1.2, 0.08, "#6d7176", 2.2 + i * 0.4, 0.5, 1.6)); // espadas
  g.add(logPile(-3, 2.4, 3));
  return g;
}

function sawmill(): THREE.Group {
  const g = new THREE.Group();
  // Cobertizo abierto con banco de sierra, tronco en caballetes y pila de tablones
  for (const [x, z] of [[-3.8, -2.6], [3.8, -2.6], [-3.8, 1.2], [3.8, 1.2]]) g.add(box(0.3, 2.9, 0.3, C.timber, x, 0, z));
  const roof = box(8.6, 0.2, 4.8, C.thatch, 0, 2.9, -0.7); roof.rotation.x = 0.14; g.add(roof);
  g.add(box(8, 1.6, 0.2, C.wood, 0, 0, -2.75));
  for (const x of [-2.4, 0, 2.4]) g.add(box(0.25, 0.9, 1.1, C.darkWood, x, 0, -0.8));   // caballetes
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 6.4, 7), mat(C.wood));
  log.rotation.z = Math.PI / 2; log.position.set(0, 1.25, -0.8); g.add(log);
  g.add(box(0.06, 1.4, 0.7, "#8a8e92", 0.6, 0.9, -0.8));                                  // sierra
  for (let i = 0; i < 5; i++) g.add(box(3.4, 0.12, 0.5, "#c9a370", 2.2, i * 0.14, 2.6 - (i % 2) * 0.1)); // tablones
  for (let i = 0; i < 4; i++) g.add(box(3.4, 0.12, 0.5, "#c9a370", 2.2, i * 0.14, 3.2));
  g.add(logPile(-2.6, 2.6, 5));
  return g;
}

const BUILDERS: Record<BuildingKind, () => THREE.Group> = { house, woodcutter, farm, storehouse, market, barracks, mill, bakery, tower, stable, smithy, sawmill };

/** Mejora de casa: huerto delante a la izquierda o taller con tejadillo a la derecha. */
export function houseExtraModel(kind: "garden" | "workshop"): THREE.Group {
  const g = new THREE.Group();
  if (kind === "garden") {
    g.add(box(2.6, 0.12, 1.1, "#5a4030", -1.7, 0, 2.95));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) g.add(box(0.32, 0.3, 0.32, i % 2 ? "#6f9a3a" : "#4f8a34", -2.7 + i * 0.65, 0.1, 2.7 + j * 0.5));
    for (let i = 0; i < 5; i++) g.add(box(0.07, 0.6, 0.07, C.timber, -3.05 + i * 0.68, 0, 3.5));
    g.add(box(2.8, 0.06, 0.05, C.timber, -1.7, 0.45, 3.5));
  } else {
    for (const x of [1.6, 3.2]) g.add(box(0.14, 2, 0.14, C.timber, x, 0, 3.3));
    const roof = box(2, 0.1, 1.2, C.roof, 2.4, 2.0, 2.85); roof.rotation.x = -0.25; g.add(roof);
    g.add(box(1.3, 0.75, 0.5, C.darkWood, 2.4, 0, 2.75));
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 8), mat(C.wood));
    barrel.position.set(3.15, 0.35, 2.75); g.add(barrel);
    g.add(box(0.7, 0.08, 0.35, "#c9a370", 2.2, 0.75, 2.75));
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** Torre del homenaje del señor rival: piedra, almenas y estandarte rojo. */
export function keepModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(9, 11, 9, C.stone));
  for (let i = 0; i < 4; i++) for (let k = -1; k <= 1; k++) {
    const side = i * Math.PI / 2;
    const bx = Math.sin(side) * 4.3 + Math.cos(side) * k * 3, bz = Math.cos(side) * 4.3 - Math.sin(side) * k * 3;
    g.add(box(1.4, 1.3, 1.4, C.stone, bx, 11, bz));
  }
  g.add(box(1.8, 3, 0.2, C.door, 0, 0, 4.55));
  for (const [x, y] of [[-2.4, 6], [2.4, 6], [0, 8.5]]) g.add(box(0.6, 1.1, 0.12, C.darkWood, x, y, 4.55));
  g.add(box(0.14, 6, 0.14, C.timber, 0, 11, 0));
  const flag = box(2.6, 1.6, 0.06, "#a8302a", 1.35, 0, 0); flag.position.y = 15.6; g.add(flag);
  g.add(box(10.4, 0.5, 10.4, "#7c786d", 0, 0, 0));
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

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
