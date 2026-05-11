import type { BrowserOp, RuntimeMessage } from "../types.js";
import { findScraper } from "../scrapers/index.js";
import type { ScraperContext } from "../scrapers/types.js";

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  if (msg.type !== "execute_op") return;
  (async () => {
    try {
      const data = await run(msg.op, msg.args);
      sendResponse({ ok: true, data });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
  })();
  return true;
});

async function run(op: BrowserOp, args: Record<string, unknown>): Promise<unknown> {
  switch (op) {
    case "readText":
      return readText(args.selector as string | undefined);
    case "click":
      return click(String(args.selector));
    case "fill":
      return fill(String(args.selector), String(args.value));
    case "scroll":
      return scroll(args);
    case "extract":
      return extract(args.selectors as Record<string, string>);
    case "screenshot":
      return screenshot();
    case "run_scraper":
      return runScraper(String(args.name), String(args.action), (args.args ?? {}) as Record<string, unknown>);
    case "open":
      return { error: "open is handled by background" };
    default:
      throw new Error(`unknown op: ${op}`);
  }
}

function readText(selector?: string): string {
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) throw new Error(`not found: ${selector}`);
  return (root.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20_000);
}

function click(selector: string): { clicked: true } {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) throw new Error(`not found: ${selector}`);
  el.scrollIntoView({ block: "center" });
  el.click();
  return { clicked: true };
}

function fill(selector: string, value: string): { filled: true } {
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) throw new Error(`not found: ${selector}`);
  el.focus();
  const proto =
    el instanceof HTMLInputElement
      ? window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { filled: true };
}

function scroll(args: Record<string, unknown>): { scrolled: true } {
  const pixels = typeof args.pixels === "number" ? args.pixels : undefined;
  const direction = typeof args.direction === "string" ? args.direction : undefined;
  if (pixels !== undefined) {
    window.scrollBy({ top: pixels, behavior: "smooth" });
  } else if (direction === "top") {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (direction === "bottom") {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } else if (direction === "up") {
    window.scrollBy({ top: -window.innerHeight * 0.8, behavior: "smooth" });
  } else {
    window.scrollBy({ top: window.innerHeight * 0.8, behavior: "smooth" });
  }
  return { scrolled: true };
}

function extract(selectors: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(selectors ?? {})) {
    const [sel, attr] = spec.split("@");
    const nodes = Array.from(document.querySelectorAll(sel));
    if (nodes.length === 0) {
      out[key] = null;
      continue;
    }
    const vals = nodes.map((n) => (attr ? n.getAttribute(attr) : (n.textContent ?? "").trim()));
    out[key] = vals.length === 1 ? vals[0] : vals;
  }
  return out;
}

async function screenshot(): Promise<{ dataUrl: string }> {
  const reply = await chrome.runtime.sendMessage({ type: "capture_screenshot" } as unknown as RuntimeMessage);
  if (!reply || !reply.dataUrl) throw new Error("screenshot failed");
  return { dataUrl: reply.dataUrl as string };
}

async function runScraper(
  name: string,
  actionName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const s = findScraper(name);
  if (!s) throw new Error(`scraper not found: ${name}`);
  const action = s.actions[actionName];
  if (!action) throw new Error(`action not found: ${name}.${actionName}`);
  const ctx: ScraperContext = {
    log: (m) => console.log(`[scraper:${name}] ${m}`),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    waitFor: (selector, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const find = () => {
          const el = document.querySelector(selector);
          if (el) return resolve(el);
          if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor timeout: ${selector}`));
          setTimeout(find, 200);
        };
        find();
      }),
    $: (selector) => document.querySelector(selector),
    $$: (selector) => Array.from(document.querySelectorAll(selector)),
  };
  return await action(args, ctx);
}
