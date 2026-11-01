// Tipos de regimiento. Todos los números de equilibrio del combate viven aquí.

export type UnitKind = "spear" | "archer" | "militia";

export interface UnitType {
  kind: UnitKind;
  label: string;        // nombre del tipo en la interfaz
  soldiers: number;     // efectivos al completo
  hp: number;           // vida por soldado
  attack: number;       // cuerpo a cuerpo
  defense: number;      // cuerpo a cuerpo y escudo contra flechas
  speed: number;        // marcha, m/s
  runSpeed: number;     // carga, m/s
  morale: number;       // moral máxima (0–100)
  spacing: number;      // separación entre soldados en formación, m
  charge: number;       // fuerza del impacto de carga (0 = no carga)
  range: number;        // alcance de tiro, m (0 = sin arcos)
  reload: number;       // segundos entre flechas
  arrowDamage: number;
  defaultFiles: number; // ancho de formación por defecto
}

export const UNIT_TYPES: Record<UnitKind, UnitType> = {
  spear: {
    kind: "spear", label: "Lanceros", soldiers: 40, hp: 10, attack: 3, defense: 5,
    speed: 3.0, runSpeed: 4.6, morale: 75, spacing: 1.3, charge: 0.6,
    range: 0, reload: 0, arrowDamage: 0, defaultFiles: 10,
  },
  militia: {
    kind: "militia", label: "Milicia", soldiers: 36, hp: 9, attack: 4, defense: 2,
    speed: 3.4, runSpeed: 5.2, morale: 60, spacing: 1.4, charge: 1,
    range: 0, reload: 0, arrowDamage: 0, defaultFiles: 9,
  },
  archer: {
    kind: "archer", label: "Arqueros", soldiers: 30, hp: 7, attack: 2, defense: 1,
    speed: 3.2, runSpeed: 4.8, morale: 55, spacing: 1.6, charge: 0,
    range: 90, reload: 5, arrowDamage: 4.5, defaultFiles: 10,
  },
};
