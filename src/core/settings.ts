// Ajustes del jugador, guardados en el navegador.

export interface Settings {
  master: number;   // 0–1
  music: number;
  sfx: number;
  edgePan: boolean;
  help: boolean;
  lowGraphics: boolean; // sin sombras y a resolución normal (ordenadores modestos)
}

const KEY = "senorio.settings.v1";
const DEFAULTS: Settings = { master: 0.8, music: 0.5, sfx: 0.8, edgePan: true, help: true, lowGraphics: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
}
