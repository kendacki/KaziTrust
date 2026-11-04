import { createHash } from "node:crypto";

const PROD_ORIGINS = new Set(["https://www.kazitrustai.fun", "https://kazitrustai.fun"]);
const LOCAL_ORIGINS = new Set([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const SECRET_RE =
  /\b(?:kt_[A-Za-z0-9_]{8,}|gsk_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+|privy_app_secret_[A-Za-z0-9]+)\b/gi;
const URL_KEY_RE = /(\/mcp\/)(kt_[A-Za-z0-9_]+)/gi;
const QUERY_KEY_RE = /([?&](?:key|api_key|apiKey|token|authorization)=)([^&#\s]+)/gi;
const IP_RE =
  /\b(?:(?:127|10)\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|::1|localhost)\b/gi;

/** @type {Map<string, { tokens: number, updatedAt: number }>} */
const buckets = new Map();

const PROFILES = {
  default: { capacity: 60, refillPerSec: 1 },
  // Deep scans issue many chain reads; keep headroom so real users are not throttled.
  rpc: { capacity: 90, refillPerSec: 6 },
  mcp: { capacity: 48, refillPerSec: 2 },
  api: { capacity: 48, refillPerSec: 2 },
  analytics: { capacity: 24, refillPerSec: 0.5 },
  auth: { capacity: 12, refillPerSec: 0.25 },
  heavy: { capacity: 30, refillPerSec: 1 },
};

export function isProduction(env = process.env) {
  return String(env.VERCEL_ENV || "").toLowerCase() === "production" || String(env.NODE_ENV || "").toLowerCase() === "production";
}

/** Local/dev open mode only. Never honors MCP_OPEN on Vercel production. */
export function openModeEnabled(env = process.env) {
  const flagged = String(env.KAZITRUST_MCP_OPEN || env.MCP_OPEN || "").toLowerCase() === "1";
  if (!flagged) return false;
  if (String(env.VERCEL_ENV || "").toLowerCase() === "production") return false;
  return true;
}

export function allowedOrigins(env = process.env) {
  const origins = new Set(PROD_ORIGINS);
  if (!isProduction(env)) {
    for (const origin of LOCAL_ORIGINS) origins.add(origin);
  }
  return origins;
}

export function redactSecrets(value) {
  if (value == null) return "";
  let text = String(value);
  text = text.replace(URL_KEY_RE, "$1kt_…");
  text = text.replace(QUERY_KEY_RE, "$1…");
  text = text.replace(IP_RE, "[local]");
  text = text.replace(SECRET_RE, (match) => {
    if (match.toLowerCase().startsWith("kt_")) return `${match.slice(0, 7)}…`;
    if (match.toLowerCase().startsWith("bearer ")) return "Bearer …";
    if (match.toLowerCase().startsWith("gsk_")) return "gsk_…";
    if (match.toLowerCase().startsWith("privy_")) return "privy_…";
    if (match.startsWith("eyJ")) return "jwt…";
    return "…";
  });
  return text;
}

export function publicError(error, fallback = "Request failed.") {
  if (!error) return fallback;
  const message = error instanceof Error ? error.message : String(error);
  if (/too large/i.test(message)) return "Request body is too large.";
  if (/timeout|aborted|network/i.test(message)) return "Upstream timed out.";
  if (/JSON|Unexpected token|Body must/i.test(message)) return "Body must be valid JSON.";
  if (/ENOENT|EACCES|ECONN|redis|upstash|privy|secret|token|key=|kt_|gsk_|127\.0\.0\.1|localhost/i.test(message)) {
    return fallback;
  }
  const cleaned = redactSecrets(message).slice(0, 160);
  if (!cleaned || cleaned !== message) return fallback;
  return cleaned || fallback;
}

export function securityHeaders(extra = {}) {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
    ...extra,
  };
}

export function corsHeaders(req, { allowCredentials = false, env = process.env } = {}) {
  const origin = headerValue(req, "origin");
  const allowed = allowedOrigins(env);
  const allowOrigin = origin && allowed.has(origin) ? origin : "https://www.kazitrustai.fun";
  /** @type {Record<string, string>} */
  const headers = {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-api-key, x-auth-token, mcp-session-id, mcp-protocol-version",
    vary: "Origin",
  };
  if (allowCredentials && origin && allowed.has(origin)) {
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}

/** MCP connectors are non-browser; discovery stays readable. Do not echo secrets. */
export function mcpCorsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-api-key, x-auth-token, mcp-session-id, mcp-protocol-version",
  };
}

/**
 * Browser Origin gate for open endpoints. Server-to-server / MCP (no Origin) stays allowed.
 */
export function browserOriginAllowed(req, env = process.env) {
  const origin = headerValue(req, "origin").trim();
  if (!origin) return true;
  return allowedOrigins(env).has(origin);
}

/**
 * Privacy-preserving client fingerprint for rate buckets.
 * Never returns a raw IP address.
 */
export function clientIp(req) {
  return fingerprintClient(req);
}

export function fingerprintClient(req) {
  return createHash("sha256").update(`kazitrust-rl:${rawClientAddress(req)}`).digest("hex").slice(0, 24);
}

/**
 * Token-bucket rate limit. Generous defaults so normal app/MCP use is unaffected.
 * @returns {{ ok: boolean, remaining: number, retryAfterSec: number, headers: Record<string, string> }}
 */
export function rateLimitAllow(reqOrKey, profileName = "default", options = {}) {
  const profile = PROFILES[profileName] || PROFILES.default;
  const capacity = Number(options.capacity) || profile.capacity;
  const refillPerSec = Number(options.refillPerSec) || profile.refillPerSec;
  const key =
    typeof reqOrKey === "string"
      ? reqOrKey
      : `${profileName}:${fingerprintClient(reqOrKey)}${options.suffix ? `:${options.suffix}` : ""}`;

  const now = Date.now();
  const current = buckets.get(key) || { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, (now - current.updatedAt) / 1000);
  const tokens = Math.min(capacity, current.tokens + elapsed * refillPerSec);
  if (tokens < 1) {
    const retryAfterSec = Math.max(1, Math.ceil((1 - tokens) / refillPerSec));
    buckets.set(key, { tokens, updatedAt: now });
    pruneBuckets(now);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec,
      headers: rateLimitHeaders(0, capacity, retryAfterSec),
    };
  }
  const next = tokens - 1;
  buckets.set(key, { tokens: next, updatedAt: now });
  pruneBuckets(now);
  return {
    ok: true,
    remaining: Math.floor(next),
    retryAfterSec: 0,
    headers: rateLimitHeaders(Math.floor(next), capacity, 0),
  };
}

/** Back-compat boolean helper. Prefer rateLimitAllow for Retry-After headers. */
export function rateLimit(key, { limit = 60, windowMs = 60_000 } = {}) {
  const refillPerSec = limit / Math.max(1, windowMs / 1000);
  const result = rateLimitAllow(key, "default", { capacity: limit, refillPerSec });
  return result.ok;
}

function rateLimitHeaders(remaining, limit, retryAfterSec) {
  /** @type {Record<string, string>} */
  const headers = {
    "x-ratelimit-limit": String(limit),
    "x-ratelimit-remaining": String(Math.max(0, remaining)),
  };
  if (retryAfterSec > 0) headers["retry-after"] = String(retryAfterSec);
  return headers;
}

function pruneBuckets(now) {
  if (buckets.size <= 8000) return;
  for (const [entry, state] of buckets) {
    if (now - state.updatedAt > 15 * 60_000) buckets.delete(entry);
  }
}

function rawClientAddress(req) {
  // Prefer platform-controlled headers so clients cannot freely spoof the bucket key.
  const vercel = headerValue(req, "x-vercel-forwarded-for").split(",")[0].trim();
  if (vercel) return normalizeIp(vercel);
  const real = headerValue(req, "x-real-ip").trim();
  if (real) return normalizeIp(real);
  const forwarded = headerValue(req, "x-forwarded-for").split(",")[0].trim();
  if (forwarded) return normalizeIp(forwarded);
  return "local";
}

function normalizeIp(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "local";
  if (raw === "::1") return "loopback";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  if (raw === "127.0.0.1") return "loopback";
  return raw.slice(0, 64);
}

function headerValue(req, name) {
  if (!req) return "";
  if (req.headers && typeof req.headers.get === "function") return req.headers.get(name) || "";
  const headers = req.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : value || "";
}
