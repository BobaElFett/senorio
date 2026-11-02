// Tipos de edificio de la aldea. Costes, tamaños y producción viven aquí.

export type BuildingKind = "house" | "woodcutter" | "farm" | "storehouse" | "market" | "barracks" | "mill" | "bakery" | "tower" | "stable" | "smithy" | "sawmill";
export type Resource = "wood" | "food" | "coins" | "flour" | "bread" | "planks";
export const RESOURCES: Resource[] = ["wood", "food", "coins", "flour", "bread", "planks"];

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
  sawmill: {
    kind: "sawmill", label: "Aserradero", description: "Sierra 3 de madera al día por aserrador y saca 2 tablones. Deja siempre 15 de madera para leña y obras.",
    cost: { wood: 8, coins: 5 }, buildDays: 3, w: 9, d: 7, workers: 2, housing: 0, storage: 0,
  },
  smithy: {
    kind: "smithy", label: "Herrería", description: "Con un herrero, forja mejores armas y armaduras para tus regimientos.",
    cost: { wood: 10, coins: 20 }, buildDays: 3, w: 8, d: 7, workers: 1, housing: 0, storage: 0,
  },
  stable: {
    kind: "stable", label: "Establo", description: "Cría caballos y forma jinetes: dos por familia. Los caballos comen grano.",
    cost: { wood: 6, planks: 8, coins: 25 }, buildDays: 4, w: 12, d: 8, workers: 0, housing: 0, storage: 0,
  },
};

export const BUILD_ORDER: BuildingKind[] = ["house", "woodcutter", "farm", "mill", "bakery", "sawmill", "storehouse", "market", "barracks", "smithy", "tower", "stable"];

export const RESOURCE_LABEL: Record<Resource, string> = { wood: "Madera", food: "Grano", coins: "Monedas", flour: "Harina", bread: "Pan", planks: "Tablones" };

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
export const UPGRADES: Record<Upgrade, { label: string; effect: string; levels: { cost: Partial<Record<Resource, number>>; days: number }[] }> = {
  arms: { label: "Armas", effect: "+1 de ataque y flechas más dañinas", levels: [{ cost: { wood: 10, coins: 20 }, days: 4 }, { cost: { planks: 10, coins: 35 }, days: 6 }] },
  armor: { label: "Armaduras", effect: "+1 de defensa y +1,5 de vida", levels: [{ cost: { wood: 12, coins: 25 }, days: 4 }, { cost: { planks: 12, coins: 40 }, days: 6 }] },
};
/** Mejoras de casa: las trabaja la propia familia, sin ocupar un puesto. */
export type HouseExtra = "garden" | "workshop";
export const HOUSE_EXTRAS: Record<HouseExtra, { label: string; description: string; cost: Partial<Record<Resource, number>>; food: number; coins: number }> = {
  garden: { label: "Huerto", description: "+0,35 de grano al día (no en invierno)", cost: { wood: 3, coins: 4 }, food: 0.35, coins: 0 },
  workshop: { label: "Taller", description: "+0,3 monedas al día vendiendo lo que fabrica", cost: { planks: 4, coins: 6 }, food: 0, coins: 0.3 },
};
export const EXTRA_MIN_APPROVAL = 60; // la familia solo invierte en su casa si está contenta
/** Comercio en el mercado: lotes de 10; se compra caro y se vende barato, y cada trato mueve el precio. */
export type TradeGood = "wood" | "food" | "planks" | "bread";
export const TRADE_GOODS: TradeGood[] = ["wood", "food", "planks", "bread"];
export const TRADE_BASE: Record<TradeGood, number> = { wood: 0.6, food: 0.8, planks: 1.8, bread: 1.3 }; // monedas por unidad
export const TRADE_SEASON = [1.1, 1.0, 0.8, 1.4];   // la comida: cara en invierno, barata en la cosecha
export const TRADE_LOT = 10;
export const TRADE_SELL = 0.8, TRADE_BUY = 1.25;
export const SAW_PER_WORKER = 3;      // madera → tablones, por día
export const PLANKS_PER_WOOD = 2 / 3;
export const SAW_RESERVE = 15;
/** «Falta madera (8)» / «Faltan tablones (4)» */
export const lackText = (r: Resource, n: number) => `${RESOURCE_LABEL[r].endsWith("s") ? "Faltan" : "Falta"} ${RESOURCE_LABEL[r].toLowerCase()} (${n})`;
export const costLine = (c: Partial<Record<Resource, number>>) =>
  (Object.entries(c) as [Resource, number][]).map(([r, n]) => `${n} ${RESOURCE_LABEL[r].toLowerCase()}`).join(" · ");
export const HORSE_FOOD = 0.25;      // grano por caballo y día (jinetes en servicio)
