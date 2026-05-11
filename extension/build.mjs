import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

cpSync("public", outdir, { recursive: true });
cpSync("src/sidepanel/sidepanel.html", `${outdir}/sidepanel.html`);
cpSync("src/open/open.html", `${outdir}/open.html`);

const common = {
  bundle: true,
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
};

const entries = [
  { entryPoints: ["src/background.ts"], outfile: `${outdir}/background.js` },
  { entryPoints: ["src/sidepanel/sidepanel.ts"], outfile: `${outdir}/sidepanel.js` },
  { entryPoints: ["src/open/open.ts"], outfile: `${outdir}/open.js` },
  { entryPoints: ["src/content/overlay.ts"], outfile: `${outdir}/overlay.js`, format: "iife" },
  { entryPoints: ["src/content/executor.ts"], outfile: `${outdir}/executor.js`, format: "iife" },
];

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...common, ...e });
    await ctx.watch();
  }
  console.log("watching...");
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
  console.log(`built -> ${outdir}/`);
}
