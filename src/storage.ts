import type { Report } from "./types";
import type { WalletActivity } from "./engine/wallet";

export type ThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  report?: Report;
  steps?: { label: string; state: "active" | "done" }[];
  followups?: string[];
  stopped?: boolean;
  earlier?: { content: string; after: ThreadMessage[] }[];
};

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  messages: ThreadMessage[];
};

export type WatchItem = {
  address: string;
  label: string;
  score: number | null;
  band: string;
  previousScore?: number | null;
  updatedAt: number;
};

const THREADS = "kazitrust.threads";
const WATCH = "kazitrust.watch";
const PROFILE = "kazitrust.profile";
const API_KEY = "kazitrust.apikey";
const WALLET_ACTIVITY = "kazitrust.wallet.activity";
const ACTIVITY_LIMIT = 80;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The browser refused the save. The session still works until refresh. */
  }
}

function dropLegacy(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Best-effort cleanup of pre-account-scoped keys. */
  }
}

function scopedKey(base: string, userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${base}.${userId}`;
}

export function loadThreads(userId: string | null | undefined): Thread[] {
  const key = scopedKey(THREADS, userId);
  if (!key) return [];
  dropLegacy(THREADS);
  return read<Thread[]>(key, []);
}

export function saveThreads(userId: string | null | undefined, threads: Thread[]) {
  const key = scopedKey(THREADS, userId);
  if (!key) return;
  write(key, threads.slice(0, 40));
  dropLegacy(THREADS);
}

export function loadWatch(userId: string | null | undefined): WatchItem[] {
  const key = scopedKey(WATCH, userId);
  if (!key) return [];
  dropLegacy(WATCH);
  return read<WatchItem[]>(key, []);
}

export function saveWatch(userId: string | null | undefined, items: WatchItem[]) {
  const key = scopedKey(WATCH, userId);
  if (!key) return;
  write(key, items.slice(0, 24));
  dropLegacy(WATCH);
}

export function cleanUsername(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

export function loadUsername(userId: string | null | undefined): string | null {
  const key = scopedKey(PROFILE, userId);
  if (!key) return null;
  dropLegacy(PROFILE);
  const saved = read<{ name?: string } | null>(key, null);
  const name = cleanUsername(saved?.name);
  return name || null;
}

export function saveUsername(userId: string | null | undefined, name: string) {
  const key = scopedKey(PROFILE, userId);
  if (!key) return;
  const clean = cleanUsername(name);
  if (!clean) return;
  write(key, { name: clean });
  dropLegacy(PROFILE);
}

export type SavedApiKey = {
  key: string;
  prefix: string;
  createdAt: string;
  expiresAt?: string;
};

export function loadApiKey(userId: string | null | undefined): SavedApiKey | null {
  const key = scopedKey(API_KEY, userId);
  if (!key) return null;
  dropLegacy(API_KEY);
  const saved = read<Partial<SavedApiKey> | null>(key, null);
  if (!saved?.key?.startsWith("kt_") || !saved.prefix || !saved.createdAt) return null;
  if (saved.key.length > 160 || saved.prefix.length > 12) return null;
  const expiresAt = typeof saved.expiresAt === "string" && Number.isFinite(Date.parse(saved.expiresAt)) ? saved.expiresAt : undefined;
  return { key: saved.key, prefix: saved.prefix, createdAt: saved.createdAt, ...(expiresAt ? { expiresAt } : {}) };
}

export function saveApiKey(userId: string | null | undefined, value: SavedApiKey) {
  const key = scopedKey(API_KEY, userId);
  if (!key) return;
  write(key, value);
  dropLegacy(API_KEY);
}

export function clearApiKey(userId: string | null | undefined) {
  const key = scopedKey(API_KEY, userId);
  try {
    if (key) localStorage.removeItem(key);
    localStorage.removeItem(API_KEY);
  } catch {
    /* The browser refused the clear. The next read still checks the prefix. */
  }
}

export function initials(name: string): string {
  const parts = cleanUsername(name).split(" ").filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}` : [...(parts[0] ?? "")].slice(0, 2).join("");
  return letters.toLocaleUpperCase() || "RE";
}

function activityKey(userId: string | null | undefined, address: string): string | null {
  const scoped = scopedKey(WALLET_ACTIVITY, userId);
  const clean = address.trim();
  if (!scoped || !clean) return null;
  return `${scoped}.${clean}`;
}

function isActivity(value: unknown): value is WalletActivity {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WalletActivity>;
  return typeof row.signature === "string" && row.signature.length > 8 && typeof row.title === "string";
}

export function loadWalletActivity(userId: string | null | undefined, address: string): WalletActivity[] {
  const key = activityKey(userId, address);
  if (!key) return [];
  const saved = read<unknown[]>(key, []);
  return mergeWalletActivity([], saved.filter(isActivity));
}

export function saveWalletActivity(userId: string | null | undefined, address: string, items: WalletActivity[]) {
  const key = activityKey(userId, address);
  if (!key) return;
  write(key, mergeWalletActivity([], items).slice(0, ACTIVITY_LIMIT));
}

export function mergeWalletActivity(...groups: WalletActivity[][]): WalletActivity[] {
  const map = new Map<string, WalletActivity>();
  for (const group of groups) {
    for (const item of group) {
      if (!item?.signature) continue;
      const prev = map.get(item.signature);
      if (!prev) {
        map.set(item.signature, item);
        continue;
      }
      map.set(item.signature, {
        ...prev,
        ...item,
        title: item.title || prev.title,
        detail: item.detail || prev.detail,
        amountText: item.amountText || prev.amountText,
        symbol: item.symbol || prev.symbol,
        image: item.image || prev.image,
        blockTime: item.blockTime ?? prev.blockTime,
        failed: item.failed || prev.failed,
        direction: item.direction !== "unknown" ? item.direction : prev.direction,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    const time = (b.blockTime ?? 0) - (a.blockTime ?? 0);
    if (time) return time;
    return (b.slot || 0) - (a.slot || 0);
  }).slice(0, ACTIVITY_LIMIT);
}
