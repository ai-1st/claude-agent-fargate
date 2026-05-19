import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const watch = process.argv.includes("--watch");
const outdir = "dist";
const root = dirname(fileURLToPath(import.meta.url));

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

cpSync("public", outdir, { recursive: true });
cpSync("src/open/open.html", `${outdir}/open.html`);

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

const esbuildEntries = [
  { entryPoints: ["src/background.ts"], outfile: `${outdir}/background.js` },
  { entryPoints: ["src/open/open.ts"], outfile: `${outdir}/open.js` },
  { entryPoints: ["src/content/overlay.ts"], outfile: `${outdir}/overlay.js`, format: "iife" },
  { entryPoints: ["src/content/executor.ts"], outfile: `${outdir}/executor.js`, format: "iife" },
];

function buildSidepanel() {
  const r = spawnSync(
    "npx",
    ["vite", "build", "--config", "vite.sidepanel.config.ts"],
    { cwd: root, stdio: "inherit", shell: false }
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (watch) {
  buildSidepanel();
  for (const e of esbuildEntries) {
    const ctx = await context({ ...common, ...e });
    await ctx.watch();
  }
  console.log("watching esbuild entries (re-run npm run build for sidepanel)...");
} else {
  buildSidepanel();
  await Promise.all(esbuildEntries.map((e) => build({ ...common, ...e })));
  console.log(`built -> ${outdir}/`);
}
