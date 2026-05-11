import type { Scraper } from "./types.js";

export const generic: Scraper = {
  name: "generic",
  actions: {
    async textOf(args, ctx) {
      const sel = String(args.selector ?? "");
      const el = ctx.$(sel);
      return el ? (el.textContent ?? "").trim() : null;
    },
    async countOf(args, ctx) {
      const sel = String(args.selector ?? "");
      return ctx.$$(sel).length;
    },
    async attrOf(args, ctx) {
      const sel = String(args.selector ?? "");
      const attr = String(args.attr ?? "");
      const el = ctx.$(sel);
      if (!el) return null;
      return el.getAttribute(attr);
    },
    async allText(args, ctx) {
      const sel = String(args.selector ?? "");
      return ctx.$$(sel).map((el) => (el.textContent ?? "").trim());
    },
    async waitFor(args, ctx) {
      const sel = String(args.selector ?? "");
      const timeoutMs = Number(args.timeoutMs ?? 10_000);
      const el = await ctx.waitFor(sel, timeoutMs);
      return { found: true, tag: el.tagName };
    },
    async title() {
      return document.title;
    },
    async url() {
      return location.href;
    },
  },
};
