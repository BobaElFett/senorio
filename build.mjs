// Compila el juego a un único dist/index.html que se abre con doble clic (sin servidor).
//   node build.mjs          → build de producción
//   node build.mjs --watch  → recompila al guardar
import * as esbuild from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

async function inline(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = await readFile("index.html", "utf8");
  await mkdir("dist", { recursive: true });
  await writeFile("dist/index.html", html.replace("<!--BUNDLE-->", () => `<script>${js}</script>`));
  console.log(`dist/index.html listo (${(js.length / 1024).toFixed(0)} KB) ${new Date().toLocaleTimeString()}`);
}

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: !watch && !process.env.NOMIN,
  sourcemap: watch ? "inline" : false,
  write: false,
  plugins: [{ name: "inline-html", setup(b) { b.onEnd((r) => r.errors.length || inline(r)); } }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Vigilando cambios en src/ …");
} else {
  await esbuild.build(options);
}
