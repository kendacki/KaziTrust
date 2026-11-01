import { openModeEnabled } from "./security.mjs";

const COOKIE = "kazitrust_key";
const LEGACY_REMOTE_KEY = "kazitrust:api-key";
const KEY_PREFIX = "kazitrust:key:";
const OWNER_PREFIX = "kazitrust:owner-key:";
const READS_PREFIX = "kazitrust:key-reads:";
const DEFAULT_DAILY_READS = 30;

/** @type {Map<string, { date: string, count: number }>} */
const memoryReads = new Map();
/** @type {Map<string, Record<string, unknown>>} */
const memoryKeys = new Map();
/** @type {Map<string, string>} */
const memoryOwners = new Map();

export async function sha(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bearer(headerValue) {
  return String(headerValue || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export function dailyReadLimit(env = process.env) {
  const raw = Number(env.KAZITRUST_API_DAILY_READS || env.API_DAILY_READS || DEFAULT_DAILY_READS);
  if (!Number.isFinite(raw)) return DEFAULT_DAILY_READS;
  return Math.min(500, Math.max(1, Math.floor(raw)));
}

export async function saveRemoteKey(record, env = process.env) {
  if (!record?.hash || !record?.prefix) return false;
  const limit = Number(record.readLimit) || dailyReadLimit(env);
  const payload = {
    hash: String(record.hash).toLowerCase(),
    prefix: String(record.prefix).slice(0, 12),
    createdAt: record.createdAt || new Date().toISOString(),
    expiresAt: record.expiresAt || null,
    ownerId: typeof record.ownerId === "string" ? record.ownerId.slice(0, 120) : null,
    readLimit: limit,
  };
  memoryKeys.set(payload.hash, payload);
  if (payload.ownerId) memoryOwners.set(payload.ownerId, payload.hash);

  const redis = redisConfig(env);
  if (!redis) return true;
  try {
    const commands = [
      ["SET", `${KEY_PREFIX}${payload.hash}`, JSON.stringify(payload)],
      ["SET", LEGACY_REMOTE_KEY, JSON.stringify(payload)],
    ];
    if (payload.ownerId) {
      const previous = await getOwnerKeyHash(payload.ownerId, env);
      if (previous && previous !== payload.hash) {
        commands.push(["DEL", `${KEY_PREFIX}${previous}`]);
      }
      commands.push(["SET", `${OWNER_PREFIX}${payload.ownerId}`, payload.hash]);
    }
    const response = await fetch(`${redis.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${redis.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiKeyAllowed(token, reqHeaders = {}, env = process.env) {
  const resolved = await resolveApiKey(token, reqHeaders, env);
  return resolved.ok;
}

/**
 * @returns {Promise<{ ok: boolean, reason?: string, hash?: string, record?: Record<string, unknown> }>}
 */
export async function resolveApiKey(token, reqHeaders = {}, env = process.env) {
  if (!token || typeof token !== "string" || !token.startsWith("kt_") || token.length > 80) {
    return { ok: false, reason: "missing" };
  }
  if (openModeEnabled(env)) {
    const hash = await sha(token);
    return {
      ok: true,
      hash,
      record: {
        hash,
        prefix: token.slice(0, 7),
        readLimit: dailyReadLimit(env),
        expiresAt: null,
        ownerId: "local-open",
      },
    };
  }

  const hash = await sha(token);
  const envHash = String(env.KAZITRUST_API_KEY_HASH || "").trim().toLowerCase();
  if (envHash && hash === envHash) {
    return {
      ok: true,
      hash,
      record: {
        hash,
        prefix: token.slice(0, 7),
        readLimit: dailyReadLimit(env),
        expiresAt: null,
        ownerId: "env",
      },
    };
  }

  const remote = (await loadKeyByHash(hash, env)) || (await loadLegacyKey(env));
  if (remote?.hash && String(remote.hash).toLowerCase() === hash) {
    if (remote.expiresAt && Date.parse(String(remote.expiresAt)) <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, hash, record: remote };
  }

  const cookieHeader = headerOf(reqHeaders, "cookie");
  const cookie = await readKeyCookie(cookieHeader, env.PRIVY_APP_SECRET || "");
  if (cookie?.hash && String(cookie.hash).toLowerCase() === hash) {
    if (cookie.expiresAt && Date.parse(String(cookie.expiresAt)) <= Date.now()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, hash, record: { ...cookie, readLimit: dailyReadLimit(env) } };
  }
  return { ok: false, reason: "invalid" };
}

/**
 * Consume one daily read against the key that owns the quota.
 * @returns {Promise<{ ok: boolean, used: number, limit: number, remaining: number, error?: string }>}
 */
export async function consumeKeyRead(tokenOrHash, reqHeaders = {}, env = process.env) {
  if (openModeEnabled(env)) {
    const limit = dailyReadLimit(env);
    return { ok: true, used: 0, limit, remaining: limit };
  }

  let hash = "";
  let limit = dailyReadLimit(env);
  if (typeof tokenOrHash === "string" && tokenOrHash.startsWith("kt_")) {
    const resolved = await resolveApiKey(tokenOrHash, reqHeaders, env);
    if (!resolved.ok || !resolved.hash) {
      return { ok: false, used: 0, limit, remaining: 0, error: "API key is invalid or expired." };
    }
    hash = resolved.hash;
    limit = Number(resolved.record?.readLimit) || limit;
  } else if (typeof tokenOrHash === "string" && /^[a-f0-9]{64}$/i.test(tokenOrHash)) {
    hash = tokenOrHash.toLowerCase();
    const record = await loadKeyByHash(hash, env);
    if (record?.readLimit) limit = Number(record.readLimit) || limit;
  } else {
    return { ok: false, used: 0, limit, remaining: 0, error: "API key is invalid or expired." };
  }

  const day = new Date().toISOString().slice(0, 10);
  const used = await incrReads(hash, day, env);
  if (used > limit) {
    return {
      ok: false,
      used,
      limit,
      remaining: 0,
      error: `This API key has used its ${limit} reads for today. The counter resets tomorrow (UTC).`,
    };
  }
  return { ok: true, used, limit, remaining: Math.max(0, limit - used) };
}

export async function keyQuota(tokenOrHash, reqHeaders = {}, env = process.env) {
  const limit = dailyReadLimit(env);
  let hash = "";
  let recordLimit = limit;
  if (typeof tokenOrHash === "string" && tokenOrHash.startsWith("kt_")) {
    const resolved = await resolveApiKey(tokenOrHash, reqHeaders, env);
    if (!resolved.ok || !resolved.hash) return { used: 0, limit, remaining: 0, ok: false };
    hash = resolved.hash;
    recordLimit = Number(resolved.record?.readLimit) || limit;
  } else if (typeof tokenOrHash === "string" && /^[a-f0-9]{64}$/i.test(tokenOrHash)) {
    hash = tokenOrHash.toLowerCase();
    const record = await loadKeyByHash(hash, env);
    recordLimit = Number(record?.readLimit) || limit;
  } else {
    return { used: 0, limit, remaining: 0, ok: false };
  }
  const day = new Date().toISOString().slice(0, 10);
  const used = await readReads(hash, day, env);
  return { used, limit: recordLimit, remaining: Math.max(0, recordLimit - used), ok: true };
}

async function incrReads(hash, day, env) {
  const memKey = `${hash}:${day}`;
  const redis = redisConfig(env);
  if (!redis) {
    const current = memoryReads.get(memKey);
    const count = current?.date === day ? current.count + 1 : 1;
    memoryReads.set(memKey, { date: day, count });
    return count;
  }
  try {
    const key = `${READS_PREFIX}${hash}:${day}`;
    const response = await fetch(`${redis.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${redis.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(60 * 60 * 48)],
      ]),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error("incr failed");
    const body = await response.json();
    const value = Number(body?.[0]?.result ?? body?.[0]);
    if (!Number.isFinite(value)) throw new Error("incr missing");
    memoryReads.set(memKey, { date: day, count: value });
    return value;
  } catch {
    const current = memoryReads.get(memKey);
    const count = current?.date === day ? current.count + 1 : 1;
    memoryReads.set(memKey, { date: day, count });
    return count;
  }
}

async function readReads(hash, day, env) {
  const memKey = `${hash}:${day}`;
  const redis = redisConfig(env);
  if (!redis) return memoryReads.get(memKey)?.date === day ? memoryReads.get(memKey).count : 0;
  try {
    const response = await fetch(`${redis.url}/get/${READS_PREFIX}${hash}:${day}`, {
      headers: { authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return memoryReads.get(memKey)?.date === day ? memoryReads.get(memKey).count : 0;
    const body = await response.json();
    const value = Number(body?.result || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return memoryReads.get(memKey)?.date === day ? memoryReads.get(memKey).count : 0;
  }
}

async function loadKeyByHash(hash, env) {
  const normalized = String(hash || "").toLowerCase();
  if (!normalized) return null;
  if (memoryKeys.has(normalized)) return memoryKeys.get(normalized);
  const redis = redisConfig(env);
  if (!redis) return null;
  try {
    const response = await fetch(`${redis.url}/get/${KEY_PREFIX}${normalized}`, {
      headers: { authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.result) return null;
    const record = typeof body.result === "string" ? JSON.parse(body.result) : body.result;
    if (record?.hash) memoryKeys.set(String(record.hash).toLowerCase(), record);
    return record;
  } catch {
    return null;
  }
}

async function loadLegacyKey(env) {
  const redis = redisConfig(env);
  if (!redis) return null;
  try {
    const response = await fetch(`${redis.url}/get/${LEGACY_REMOTE_KEY}`, {
      headers: { authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (!body?.result) return null;
    return typeof body.result === "string" ? JSON.parse(body.result) : body.result;
  } catch {
    return null;
  }
}

async function getOwnerKeyHash(ownerId, env) {
  if (memoryOwners.has(ownerId)) return memoryOwners.get(ownerId);
  const redis = redisConfig(env);
  if (!redis) return null;
  try {
    const response = await fetch(`${redis.url}/get/${OWNER_PREFIX}${ownerId}`, {
      headers: { authorization: `Bearer ${redis.token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.result === "string" ? body.result : null;
  } catch {
    return null;
  }
}

function redisConfig(env) {
  const url = String(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || "").trim().replace(/\/$/, "");
  const token = String(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  return { url, token };
}

async function readKeyCookie(cookie, secret) {
  if (!cookie || !secret) return null;
  try {
    const pair = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`));
    if (!pair) return null;
    const value = decodeURIComponent(pair.slice(COOKIE.length + 1));
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = value.slice(0, dot);
    if ((await mac(secret, payload)) !== value.slice(dot + 1)) return null;
    const body = JSON.parse(unb64(payload));
    if (!body.hash || !body.prefix) return null;
    return body;
  } catch {
    return null;
  }
}

async function mac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64(new Uint8Array(sig));
}

function unb64(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function b64(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function headerOf(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : value || "";
}
