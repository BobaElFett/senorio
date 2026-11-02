/**
 * Opinión de los jugadores de prueba. En la versión publicada en claude.ai se guarda
 * en la base de datos del artefacto (una ficha por jugador, con todos sus envíos);
 * si no se puede guardar (archivo local, sin sesión o solo lectura), se ofrece copiar el texto.
 */
type Db = { doc(path: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> } };
type User = { id(): Promise<string | null> };
const use = (name: string): Promise<unknown> => {
  const c = (window as any).claude;
  return c && typeof c.use === "function" ? c.use(name).catch(() => null) : Promise.resolve(null);
};

const $ = (id: string) => document.getElementById(id)!;

export class Feedback {
  private form = $("menu-feedback") as HTMLFormElement;
  private note = $("fb-note");
  private copyBtn = $("fb-copy") as HTMLButtonElement;
  private sendBtn = $("fb-send") as HTMLButtonElement;
  private lastText = "";
  private started = performance.now();

  constructor(private summary: () => Record<string, unknown>) {
    this.form.addEventListener("submit", (e) => { e.preventDefault(); void this.send(); });
    this.copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(this.lastText); this.note.textContent = "Copiado: pégalo en un mensaje a quien te pasó el juego."; }
      catch { this.note.textContent = "No se pudo copiar automáticamente."; }
    };
  }

  /** Al abrir la pantalla: limpia avisos. */
  reset() { this.note.textContent = ""; this.copyBtn.hidden = true; this.sendBtn.disabled = false; }

  private read() {
    const f = new FormData(this.form);
    const val = (k: string) => String(f.get(k) ?? "").trim().slice(0, 600);
    return { fun: Number(f.get("fun") ?? 0) || null, again: val("again") || null, liked: val("liked"), confused: val("confused"), bugs: val("bugs") };
  }

  private async send() {
    const answers = this.read();
    if (!answers.fun && !answers.again && !answers.liked && !answers.confused && !answers.bugs) {
      this.note.textContent = "Contesta al menos una pregunta."; return;
    }
    const entry = { at: new Date().toISOString(), minutes: Math.round((performance.now() - this.started) / 60000), ...answers, game: this.summary() };
    this.lastText = [
      `Diversión: ${answers.fun ?? "-"}/5 · Volvería: ${answers.again ?? "-"}`,
      answers.liked && `Le gustó: ${answers.liked}`, answers.confused && `Le confundió: ${answers.confused}`, answers.bugs && `Fallos: ${answers.bugs}`,
      `Partida: ${JSON.stringify(entry.game)} · ${entry.minutes} min`,
    ].filter(Boolean).join("\n");
    this.sendBtn.disabled = true;
    this.note.textContent = "Enviando…";
    try {
      const [db, user] = await Promise.all([use("db") as Promise<Db | null>, use("user") as Promise<User | null>]);
      const id = user ? await user.id() : null;
      if (!db || !id) throw new Error("unavailable");
      const ref = db.doc("feedback/" + id);
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data()?.entries as unknown[] | undefined) ?? [] : [];
      await ref.set({ entries: [...prev, entry].slice(-20), last: entry.at });
      this.note.textContent = "¡Gracias! Tu opinión ha llegado.";
      this.form.reset();
    } catch {
      this.note.textContent = "No se ha podido enviar desde aquí. Cópialo y mándalo por mensaje:";
      this.copyBtn.hidden = false;
      this.sendBtn.disabled = false;
    }
  }
}
