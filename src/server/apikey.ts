import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { keyActive, keyExpiry, keyLifetime } from "../engine/keylife";
import { signedIn } from "./session";

export type SavedKey = {
  hash: string;
  prefix: string;
  createdAt: string;
  expiresAt?: string;
};

export type KeyView = {
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
};

let root = "";
let saved: SavedKey | null = null;

export function bindKeyStore(nextRoot: string) {
  root = nextRoot;
  saved = read();
}

export function keyRecord(now = Date.now()): KeyView | null {
  if (!saved) return null;
  return {
    prefix: saved.prefix,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt ?? null,
    active: keyActive(saved.expiresAt, now),
  };
}

export async function issueKey(hours: number): Promise<{ key: string; prefix: string; createdAt: string; expiresAt: string }> {
  const life = keyLifetime(hours);
  if (!life) throw new Error("Choose how long the key stays active.");
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = `kt_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const createdAt = new Date().toISOString();
  const expiresAt = keyExpiry(createdAt, life.hours);
  if (!expiresAt) throw new Error("Choose how long the key stays active.");
  const prefix = key.slice(0, 7);
  saved = { hash: await sha(key), prefix, createdAt, expiresAt };
  write(saved);
  return { key, prefix, createdAt, expiresAt };
}

export async function keyMatches(token: string, now = Date.now()): Promise<boolean> {
  if (!saved || !keyActive(saved.expiresAt, now) || !token.startsWith("kt_") || token.length > 80) return false;
  return (await sha(token)) === saved.hash;
}

export function bearer(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.replace(/^Bearer\s+/i, "").trim() ?? "";
}

export async function permit(
  header: string | string[] | undefined,
  local: boolean,
  appId: string,
  appSecret: string,
): Promise<"ok" | "unconfigured" | "denied"> {
  const token = bearer(header);
  if (token.startsWith("kt_") && (await keyMatches(token))) return "ok";
  if (local) return "ok";
  if (!appId || !appSecret) return "unconfigured";
  if (await signedIn(appId, appSecret, token)) return "ok";
  return "denied";
}

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function filePath(): string {
  const slash = root.includes("\\") ? "\\" : "/";
  return `${root}${slash}data${slash}api-keys.json`;
}

function read(): SavedKey | null {
  if (!root) return null;
  const path = filePath();
  if (!existsSync(path)) return null;
  try {
    const body = JSON.parse(readFileSync(path, "utf8")) as Partial<SavedKey>;
    if (!body.hash || !body.prefix || !body.createdAt) return null;
    const expiresAt = typeof body.expiresAt === "string" && Number.isFinite(Date.parse(body.expiresAt)) ? body.expiresAt : undefined;
    return { hash: body.hash, prefix: body.prefix, createdAt: body.createdAt, ...(expiresAt ? { expiresAt } : {}) };
  } catch {
    return null;
  }
}

function write(record: SavedKey) {
  if (!root) return;
  try {
    const slash = root.includes("\\") ? "\\" : "/";
    const dir = `${root}${slash}data`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath(), JSON.stringify(record));
  } catch {
    /* A read-only disk still leaves the record in memory and in the signed cookie. */
  }
}
