import type { Scraper } from "./types.js";

export const reddit: Scraper = {
  name: "reddit",
  match: [/^https:\/\/(www\.|old\.|new\.)?reddit\.com\//i],
  actions: {
    async getPost(args, ctx) {
      const url = String(args.url ?? location.href);
      if (location.href !== url) {
        location.href = url;
        await ctx.wait(2500);
      }
      await ctx.waitFor("shreddit-post, [data-test-id='post-content']", 15_000).catch(() => undefined);
      const title =
        (ctx.$("shreddit-post h1")?.textContent ?? ctx.$("h1")?.textContent ?? "").trim();
      const body = (ctx.$("shreddit-post [slot='text-body']")?.textContent ?? "").trim();
      const comments = ctx
        .$$("shreddit-comment")
        .slice(0, 20)
        .map((c) => ({
          author: (c.getAttribute("author") ?? "").trim(),
          body: (c.querySelector("[slot='comment']")?.textContent ?? "").trim(),
        }));
      return { title, body, comments, url: location.href };
    },

    async getSubredditTop(args, ctx) {
      const sub = String(args.sub ?? "").replace(/^r\//, "");
      const limit = Number(args.limit ?? 10);
      const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top/?t=day`;
      if (location.href !== url) {
        location.href = url;
        await ctx.wait(3000);
      }
      await ctx.waitFor("shreddit-post", 15_000).catch(() => undefined);
      const posts = ctx.$$("shreddit-post").slice(0, limit);
      return posts.map((p) => ({
        title: (p.querySelector("h1, h2, h3, [slot='title']")?.textContent ?? "").trim(),
        author: p.getAttribute("author") ?? "",
        score: p.getAttribute("score") ?? "",
        url: (p.querySelector("a") as HTMLAnchorElement | null)?.href ?? "",
      }));
    },
  },
};
