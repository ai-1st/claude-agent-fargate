import type { OverlayState } from "./types.js";

export interface StorageShape {
  /** Lambda Function URL base (no trailing slash). */
  base?: string;
  /** App password for /ext/sessions* list API (same as web login). */
  apiPassword?: string;
  /** Currently bound session for browser polling. */
  sid?: string;
  token?: string;
  inputUrl?: string;
  boundTabId?: number;
  state?: OverlayState;
  lastPollAt?: number;
  lastPollError?: string;
}

const KEY = "claw";

export async function readState(): Promise<StorageShape> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY, (res) => resolve((res?.[KEY] ?? {}) as StorageShape));
  });
}

export async function writeState(patch: Partial<StorageShape>): Promise<StorageShape> {
  const cur = await readState();
  const next = { ...cur, ...patch };
  await new Promise<void>((resolve) => chrome.storage.local.set({ [KEY]: next }, () => resolve()));
  return next;
}

export async function clearState(): Promise<void> {
  await new Promise<void>((resolve) => chrome.storage.local.remove(KEY, () => resolve()));
}

/** Clear browser binding only; keep base + apiPassword. */
export async function clearBrowserBinding(): Promise<StorageShape> {
  const cur = await readState();
  const next: StorageShape = {
    base: cur.base,
    apiPassword: cur.apiPassword,
    state: "idle",
  };
  await new Promise<void>((resolve) => chrome.storage.local.set({ [KEY]: next }, () => resolve()));
  return next;
}

export function onStateChanged(cb: (s: StorageShape) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[KEY]) {
      cb((changes[KEY].newValue ?? {}) as StorageShape);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
