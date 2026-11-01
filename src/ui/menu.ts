import { Settings, saveSettings } from "../core/settings";
import { readSave } from "../core/save";

export interface MenuActions {
  continueGame(): void;   // cargar la partida guardada
  newGame(): void;
  saveGame(): boolean;
  testBattle(): void;
  resume(): void;
  settingsChanged(s: Settings): void;
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * Menú principal (al abrir el juego) y menú de pausa (tecla M o botón «Menú»).
 * Pantallas: principal, confirmar partida nueva, ajustes y cómo jugar.
 */
export class Menu {
  isOpen = false;
  private root = $("menu");
  private screens = ["menu-main", "menu-confirm", "menu-settings", "menu-howto"];

  constructor(private actions: MenuActions, private settings: Settings, private inGame: () => boolean) {
    $("m-continue").onclick = () => this.actions.continueGame();
    $("m-new").onclick = () => {
      if (this.inGame() || readSave()) this.show("menu-confirm"); else this.actions.newGame();
    };
    $("m-confirm-yes").onclick = () => this.actions.newGame();
    $("m-confirm-no").onclick = () => this.show("menu-main");
    $("m-save").onclick = () => {
      const ok = this.actions.saveGame();
      $("m-save-note").textContent = ok ? "Partida guardada" : "No se pudo guardar: el navegador no deja almacenar datos";
      this.refresh();
    };
    $("m-battle").onclick = () => this.actions.testBattle();
    $("m-resume").onclick = () => this.actions.resume();
    $("m-settings").onclick = () => this.show("menu-settings");
    $("m-howto").onclick = () => this.show("menu-howto");
    for (const id of ["m-settings-back", "m-howto-back"]) $(id).onclick = () => this.show("menu-main");

    // Ajustes
    const bindRange = (id: string, key: "master" | "music" | "sfx") => {
      const el = $(id) as HTMLInputElement;
      const label = el.nextElementSibling as HTMLElement | null;
      el.value = String(Math.round(this.settings[key] * 100));
      if (label) label.textContent = el.value;
      el.oninput = () => { this.settings[key] = Number(el.value) / 100; if (label) label.textContent = el.value; this.changed(); };
    };
    bindRange("s-master", "master"); bindRange("s-music", "music"); bindRange("s-sfx", "sfx");
    const bindCheck = (id: string, key: "edgePan" | "help") => {
      const el = $(id) as HTMLInputElement;
      el.checked = this.settings[key];
      el.onchange = () => { this.settings[key] = el.checked; this.changed(); };
    };
    bindCheck("s-edge", "edgePan"); bindCheck("s-help", "help");
  }

  private changed() {
    saveSettings(this.settings);
    this.actions.settingsChanged(this.settings);
  }

  private show(id: string) {
    for (const s of this.screens) $(s).hidden = s !== id;
    if (id === "menu-main") this.refresh();
  }

  /** Muestra u oculta botones según haya partida en curso o guardada. */
  refresh() {
    const save = readSave();
    const playing = this.inGame();
    $("m-resume").hidden = !playing;
    $("m-save").hidden = !playing;
    $("m-continue").hidden = !save;
    $("m-continue-label").textContent = playing ? "Cargar la última partida guardada" : "Continuar";
    $("m-continue-sub").textContent = save
      ? `${save.summary} · guardada ${new Date(save.savedAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "";
    $("m-new").classList.toggle("primary", !save && !playing);
    $("m-continue").classList.toggle("primary", !!save && !playing);
    $("m-resume").classList.toggle("primary", playing);
    this.root.dataset.ingame = playing ? "1" : "0";
  }

  open() {
    this.isOpen = true;
    this.root.hidden = false;
    $("m-save-note").textContent = "";
    this.show("menu-main");
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
  }
}
