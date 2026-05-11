import type { Scraper } from "./types.js";

export const linkedin: Scraper = {
  name: "linkedin",
  match: [/^https:\/\/(www\.)?linkedin\.com\//i],
  actions: {
    async searchPeople(args, ctx) {
      const query = String(args.query ?? "");
      const limit = Number(args.limit ?? 10);
      location.href = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
      await ctx.wait(3500);
      await ctx.waitFor("main", 15_000).catch(() => undefined);
      const cards = ctx.$$("div.search-results-container li").slice(0, limit);
      return cards.map((c) => ({
        name: (c.querySelector("span[aria-hidden='true']")?.textContent ?? "").trim(),
        headline: (c.querySelector(".entity-result__primary-subtitle")?.textContent ?? "").trim(),
        location: (c.querySelector(".entity-result__secondary-subtitle")?.textContent ?? "").trim(),
        profileUrl: (c.querySelector("a.app-aware-link") as HTMLAnchorElement | null)?.href,
      }));
    },

    async getProfile(args, ctx) {
      const url = String(args.url ?? location.href);
      if (location.href !== url) {
        location.href = url;
        await ctx.wait(3500);
      }
      await ctx.waitFor("main", 15_000).catch(() => undefined);
      return {
        name: (ctx.$("h1")?.textContent ?? "").trim(),
        headline: (ctx.$(".text-body-medium")?.textContent ?? "").trim(),
        about: (ctx.$('section[data-section="summary"]')?.textContent ?? "").trim(),
        url: location.href,
      };
    },

    async getFeed(args, ctx) {
      const limit = Number(args.limit ?? 5);
      if (!/\/feed\//.test(location.href)) {
        location.href = "https://www.linkedin.com/feed/";
        await ctx.wait(3000);
      }
      await ctx.waitFor(".feed-shared-update-v2", 15_000).catch(() => undefined);
      const posts = ctx.$$(".feed-shared-update-v2").slice(0, limit);
      return posts.map((p) => ({
        author: (p.querySelector(".update-components-actor__name")?.textContent ?? "").trim(),
        text: (p.querySelector(".feed-shared-update-v2__description")?.textContent ?? "").trim().slice(0, 2000),
      }));
    },
  },
};
