export interface ScraperContext {
  log: (msg: string) => void;
  wait: (ms: number) => Promise<void>;
  waitFor: (selector: string, timeoutMs?: number) => Promise<Element>;
  $: (selector: string) => Element | null;
  $$: (selector: string) => Element[];
}

export type ScraperAction = (
  args: Record<string, unknown>,
  ctx: ScraperContext
) => Promise<unknown>;

export interface Scraper {
  name: string;
  match?: RegExp[];
  actions: Record<string, ScraperAction>;
}
