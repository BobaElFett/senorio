// Tipos de edificio de la aldea. Costes, tamaños y producción viven aquí.

export type BuildingKind = "house" | "woodcutter" | "farm" | "storehouse" | "market" | "barracks" | "mill" | "bakery" | "tower" | "stable" | "smithy";
export type Resource = "wood" | "food" | "coins" | "flour" | "bread";
export const RESOURCES: Resource[] = ["wood", "food", "coins", "flour", "bread"];

export interface BuildingType {
  kind: BuildingKind;
  label: string;
  description: string;
  cost: Partial<Record<Resource, number>>;
  buildDays: number;       // días de trabajo de una familia constructora
  w: number; d: number;    // huella en metros (ancho x fondo) sin girar
  field?: { w: number; d: number };  // parcela delante del edificio (granja)
  workers: number;         // familias que pueden trabajar aquí
  housing: number;         // familias que puede alojar
  storage: number;         // capacidad extra de cada recurso
}

export const BUILDINGS: Record<BuildingKind, BuildingType> = {
  house: {
    kind: "house", label: "Casa", description: "Aloja a una familia. En invierno quema leña.",
    cost: { wood: 4 }, buildDays: 2, w: 7, d: 7, workers: 0, housing: 1, storage: 0,
  },
  woodcutter: {
    kind: "woodcutter", label: "Leñador", description: "Tala árboles en 45 m a la redonda. Ponlo junto al bosque.",
    cost: { wood: 3 }, buildDays: 2, w: 8, d: 7, workers: 2, housing: 0, storage: 0,
  },
  farm: {
    kind: "farm", label: "Granja", description: "Cultiva el campo de delante. Siembra en primavera, cosecha en otoño, nada en invierno.",
    cost: { wood: 5 }, buildDays: 3, w: 8, d: 7, field: { w: 20, d: 16 }, workers: 2, housing: 0, storage: 0,
  },
  storehouse: {
    kind: "storehouse", label: "Almacén", description: "Guarda 150 más de cada recurso.",
    cost: { wood: 6 }, buildDays: 3, w: 11, d: 8, workers: 0, housing: 0, storage: 150,
  },
  market: {
    kind: "market", label: "Mercado", description: "Con un tendero, cada familia con casa paga impuestos y la aprobación sube.",
    cost: { wood: 8, coins: 10 }, buildDays: 4, w: 12, d: 12, workers: 1, housing: 0, storage: 0,
  },
  mill: {
    kind: "mill", label: "Molino", description: "Muele 4 de grano al día por molinero y lo convierte en harina. Deja siempre 10 de grano en reserva.",
    cost: { wood: 8, coins: 5 }, buildDays: 3, w: 8, d: 8, workers: 1, housing: 0, storage: 0,
  },
  bakery: {
    kind: "bakery", label: "Panadería", description: "Cuece 3 de harina al día por panadero y saca 5 de pan. Las familias comen pan antes que grano.",
    cost: { wood: 6, coins: 10 }, buildDays: 3, w: 8, d: 7, workers: 1, housing: 0, storage: 0,
  },
  tower: {
    kind: "tower", label: "Torre", description: "Con un vigía, avista a los bandidos un día antes y les dispara flechas a 70 m.",
    cost: { wood: 8, coins: 5 }, buildDays: 2, w: 5, d: 5, workers: 1, housing: 0, storage: 0,
  },
  barracks: {
    kind: "barracks", label: "Cuartel", description: "Recluta lanceros y arqueros entre las familias de la aldea.",
    cost: { wood: 10, coins: 30 }, buildDays: 4, w: 12, d: 10, workers: 0, housing: 0, storage: 0,
  },
  smithy: {
    kind: "smithy", label: "Herrería", description: "Con un herrero, forja mejores armas y armaduras para tus regimientos.",
    cost: { wood: 10, coins: 20 }, buildDays: 3, w: 8, d: 7, workers: 1, housing: 0, storage: 0,
  },
  stable: {
    kind: "stable", label: "Establo", description: "Cría caballos y forma jinetes: dos por familia. Los caballos comen grano.",
    cost: { wood: 14, coins: 25 }, buildDays: 4, w: 12, d: 8, workers: 0, housing: 0, storage: 0,
  },
};

export const BUILD_ORDER: BuildingKind[] = ["house", "woodcutter", "farm", "mill", "bakery", "storehouse", "market", "barracks", "smithy", "tower", "stable"];

export const RESOURCE_LABEL: Record<Resource, string> = { wood: "Madera", food: "Grano", coins: "Monedas", flour: "Harina", bread: "Pan" };

// Ritmo del tiempo y de la economía
export const DAY_SECONDS = 40;        // segundos reales por día a 1×
export const DAYS_PER_SEASON = 10;
export const SEASONS = ["Primavera", "Verano", "Otoño", "Invierno"] as const;
export const BASE_STORAGE = 100;
export const FOOD_PER_FAMILY = 0.8;   // por día
export const FIREWOOD_PER_HOUSE = 0.3; // por día de invierno
export const WOOD_PER_WORKER = 2.2;   // por día, con bosque denso
export const FARM_YIELD = [1.0, 2.2, 3.0, 0]; // comida por trabajador y día, por estación
export const TAX_PER_FAMILY = 0.25;   // monedas por familia con casa y día, con mercado atendido
export const MILL_PER_WORKER = 4;     // grano → harina, por día
export const MILL_RESERVE = 10;       // el molino no toca los últimos 10 de grano
export const BAKE_PER_WORKER = 3;     // harina por día
export const BREAD_PER_FLOUR = 5 / 3;
export const TOWER_RANGE = 70;        // m
export const TOWER_RELOAD = 1.6;      // s entre flechas
export const TOWER_DAMAGE = 5;
/** Mejoras de la herrería: dos niveles de armas y dos de armaduras. */
export type Upgrade = "arms" | "armor";
export const UPGRADES: Record<Upgrade, { label: string; effect: string; levels: { wood: number; coins: number; days: number }[] }> = {
  arms: { label: "Armas", effect: "+1 de ataque y flechas más dañinas", levels: [{ wood: 10, coins: 20, days: 4 }, { wood: 15, coins: 35, days: 6 }] },
  armor: { label: "Armaduras", effect: "+1 de defensa y +1,5 de vida", levels: [{ wood: 12, coins: 25, days: 4 }, { wood: 18, coins: 40, days: 6 }] },
};
export const HORSE_FOOD = 0.25;      // grano por caballo y día (jinetes en servicio)
