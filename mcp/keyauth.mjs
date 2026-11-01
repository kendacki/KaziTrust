import { openModeEnabled } from "./security.mjs";

const COOKIE = "kazitrust_key";
const REMOTE_KEY = "kazitrust:api-key";

export async function sha(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bearer(headerValue) {
  return String(headerValue || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

export async function saveRemoteKey(record, env = process.env) {
  const redis = redisConfig(env);
  if (!redis || !record?.hash) return false;
  try {
    const response = await fetch(`${redis.url}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${redis.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([["SET", REMOTE_KEY, JSON.stringify(record)]]),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function apiKeyAllowed(token, reqHeaders = {}, env = process.env) {
  if (!token || typeof token !== "string" || !token.startsWith("kt_") || token.length > 80) return false;
  // Local/dev open mode only. Never bypass key checks on Vercel production.
  if (openModeEnabled(env)) return true;
  const hash = await sha(token);
  const envHash = String(env.KAZITRUST_API_KEY_HASH || "").trim().toLowerCase();
  if (envHash && hash === envHash) return true;

  const remote = await loadRemoteKey(env);
  if (remote?.hash && remote.hash === hash) {
    if (remote.expiresAt && Date.parse(remote.expiresAt) <= Date.now()) return false;
    return true;
  }

  const cookieHeader = headerOf(reqHeaders, "cookie");
  const cookie = await readKeyCookie(cookieHeader, env.PRIVY_APP_SECRET || "");
  if (cookie?.hash && cookie.hash === hash) {
    if (cookie.expiresAt && Date.parse(cookie.expiresAt) <= Date.now()) return false;
    return true;
  }
  return false;
}

async function loadRemoteKey(env) {
  const redis = redisConfig(env);
  if (!redis) return null;
  try {
    const response = await fetch(`${redis.url}/get/${REMOTE_KEY}`, {
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
