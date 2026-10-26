import type { Report } from "./types";

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

export function loadThreads(): Thread[] {
  return read<Thread[]>(THREADS, []);
}

export function saveThreads(threads: Thread[]) {
  write(THREADS, threads.slice(0, 40));
}

export function loadWatch(): WatchItem[] {
  return read<WatchItem[]>(WATCH, []);
}

export function saveWatch(items: WatchItem[]) {
  write(WATCH, items.slice(0, 24));
}

export function cleanUsername(value: string | null | undefined): string {
  return (value ?? "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
}

export function loadUsername(): string | null {
  const saved = read<{ name?: string } | null>(PROFILE, null);
  const name = cleanUsername(saved?.name);
  return name || null;
}

export function saveUsername(name: string) {
  const clean = cleanUsername(name);
  if (clean) write(PROFILE, { name: clean });
}

const API_KEY = "kazitrust.apikey";

export type SavedApiKey = {
  key: string;
  prefix: string;
  createdAt: string;
};

export function loadApiKey(): SavedApiKey | null {
  const saved = read<Partial<SavedApiKey> | null>(API_KEY, null);
  if (!saved?.key?.startsWith("kt_") || !saved.prefix || !saved.createdAt) return null;
  if (saved.key.length > 80 || saved.prefix.length > 12) return null;
  return { key: saved.key, prefix: saved.prefix, createdAt: saved.createdAt };
}

export function saveApiKey(value: SavedApiKey) {
  write(API_KEY, value);
}

export function clearApiKey() {
  try {
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
