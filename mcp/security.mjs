const OWN_ORIGINS = new Set([
  "https://www.kazitrustai.fun",
  "https://kazitrustai.fun",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);

const SECRET_RE =
  /\b(?:kt_[A-Za-z0-9_]{8,}|gsk_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9\-._~+/]+=*|eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+|privy_app_secret_[A-Za-z0-9]+)\b/gi;
const URL_KEY_RE = /(\/mcp\/)(kt_[A-Za-z0-9_]+)/gi;
const QUERY_KEY_RE = /([?&](?:key|api_key|apiKey|token|authorization)=)([^&#\s]+)/gi;

const hits = new Map();

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

export function redactSecrets(value) {
  if (value == null) return "";
  let text = String(value);
  text = text.replace(URL_KEY_RE, "$1kt_…");
  text = text.replace(QUERY_KEY_RE, "$1…");
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
  // Never return stack traces, paths, or secret-bearing messages to clients.
  if (/ENOENT|EACCES|ECONN|redis|upstash|privy|secret|token|key=|kt_|gsk_/i.test(message)) return fallback;
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

export function corsHeaders(req, { allowCredentials = false } = {}) {
  const origin = headerValue(req, "origin");
  const allowOrigin = origin && OWN_ORIGINS.has(origin) ? origin : OWN_ORIGINS.has("https://www.kazitrustai.fun") ? "https://www.kazitrustai.fun" : "null";
  /** @type {Record<string, string>} */
  const headers = {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-api-key, x-auth-token, mcp-session-id, mcp-protocol-version",
    vary: "Origin",
  };
  if (allowCredentials && origin && OWN_ORIGINS.has(origin)) {
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

export function clientIp(req) {
  const forwarded = headerValue(req, "x-forwarded-for").split(",")[0].trim();
  return forwarded || headerValue(req, "x-real-ip") || "local";
}

/**
 * Simple in-memory rate limit. Best-effort on serverless (per-instance).
 * @returns {boolean} true when allowed
 */
export function rateLimit(key, { limit = 60, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const bucket = hits.get(key) || [];
  const recent = bucket.filter((ts) => now - ts < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [entry, stamps] of hits) {
      if (!stamps.length || now - stamps[stamps.length - 1] > windowMs) hits.delete(entry);
    }
  }
  return true;
}

function headerValue(req, name) {
  if (!req) return "";
  if (req.headers && typeof req.headers.get === "function") return req.headers.get(name) || "";
  const headers = req.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : value || "";
}
