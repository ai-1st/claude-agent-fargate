import { svelte } from "@sveltejs/vite-plugin-svelte";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const sidepanelRoot = resolve(__dirname, "src/sidepanel");
const outDir = resolve(__dirname, "dist");

export default defineConfig({
  root: sidepanelRoot,
  base: "./",
  plugins: [
    svelte(),
    {
      name: "sidepanel-html",
      closeBundle() {
        const built = resolve(outDir, "index.html");
        let html = readFileSync(built, "utf8");
        html = html.replaceAll('href="/', 'href="./').replaceAll('src="/', 'src="./');
        writeFileSync(resolve(outDir, "sidepanel.html"), html);
        rmSync(built, { force: true });
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(sidepanelRoot, "index.html"),
      output: {
        entryFileNames: "sidepanel.js",
        chunkFileNames: "sidepanel-[name].js",
        assetFileNames: "sidepanel[extname]",
      },
    },
  },
});
