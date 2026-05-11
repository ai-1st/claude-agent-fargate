import type { Scraper } from "./types.js";
import { generic } from "./generic.js";
import { linkedin } from "./linkedin.js";
import { reddit } from "./reddit.js";

export const SCRAPERS: Scraper[] = [generic, linkedin, reddit];

export function findScraper(name: string): Scraper | undefined {
  return SCRAPERS.find((s) => s.name === name);
}
