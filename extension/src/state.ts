import type { OverlayState } from "./types.js";

export interface StorageShape {
  sid?: string;
  token?: string;
  base?: string;
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

export function onStateChanged(cb: (s: StorageShape) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      cb((changes[KEY].newValue ?? {}) as StorageShape);
    }
  });
}
