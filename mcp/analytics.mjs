import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { corsHeaders, redactSecrets, securityHeaders, trustedRedisConfig } from "./security.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "data", "analytics.jsonl");
const RING_MAX = 800;
const COUNTER_KEY = "kazitrust:analytics:counters";
const EVENTS_KEY = "kazitrust:analytics:events";
const FAIL_KEY = "kazitrust:analytics:failures";

/** @type {Array<Record<string, unknown>>} */
const ring = [];

const UI_EVENTS = new Set([
  "page_view",
  "auth_login",
  "auth_logout",
  "investigate_start",
  "investigate_complete",
  "investigate_error",
  "investigate_quota",
  "watch_pin",
  "watch_unpin",
  "mode_change",
  "pdf_export",
  "api_key_create",
  "api_key_view",
  "cta_click",
  "attach_file",
  "thread_create",
  "client_error",
  "jailbreak_blocked",
]);

export function isUiEventName(name) {
  return typeof name === "string" && UI_EVENTS.has(name);
}

/**
 * @param {Record<string, unknown>} partial
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export async function track(partial, env = process.env) {
  const event = normalize(partial);
  if (!event) return null;
  ring.push(event);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  logLine(event);
  try {
    appendLocal(event);
  } catch {
    // Local file store is best-effort.
  }
  try {
    await persistRemote(event, env);
  } catch {
    // Remote store is best-effort; never fail the caller.
  }
  return event;
}

/**
 * @param {unknown} batch
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export async function ingestClientEvents(batch, env = process.env) {
  const list = Array.isArray(batch) ? batch : [batch];
  const accepted = [];
  for (const item of list.slice(0, 40)) {
    if (!item || typeof item !== "object") continue;
    const name = /** @type {{ name?: unknown }} */ (item).name;
    if (!isUiEventName(String(name || ""))) continue;
    const saved = await track(
      {
        .../** @type {Record<string, unknown>} */ (item),
        source: "ui",
      },
      env,
    );
    if (saved) accepted.push(saved);
  }
  return accepted;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {{ limit?: number }} [options]
 */
export async function summarize(env = process.env, options = {}) {
  const limit = Math.min(100, Math.max(10, Number(options.limit) || 40));
  const remote = await readRemote(env, limit);
  const events = remote.events.length ? remote.events : ring.slice(-limit).reverse();
  const failures = remote.failures.length
    ? remote.failures
    : events.filter((event) => event.ok === false).slice(0, 25);
  const counters = remote.counters && Object.keys(remote.counters).length ? remote.counters : countLocal(events.length ? events : ring);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    store: remote.store,
    totals: {
      events: Number(counters["total"] || 0) || events.length || ring.length,
      ok: Number(counters["ok"] || 0),
      failed: Number(counters["failed"] || 0),
      ui: Number(counters["source:ui"] || 0),
      api: Number(counters["source:api"] || 0),
      mcp: Number(counters["source:mcp"] || 0),
    },
    byName: pickPrefixed(counters, "name:"),
    byTool: pickPrefixed(counters, "tool:"),
    byRoute: pickPrefixed(counters, "route:"),
    recentFailures: failures,
    recent: events.slice(0, limit),
  };
}

export function analyticsHttpHeaders(req) {
  return {
    "content-type": "application/json",
    ...securityHeaders(),
    ...corsHeaders(req),
  };
}

export function authorizeAnalyticsRead(reqAuth, env = process.env) {
  const expected = String(env.ANALYTICS_TOKEN || env.KAZITRUST_ANALYTICS_TOKEN || "").trim();
  if (!expected) return false;
  const raw = String(reqAuth || "").trim();
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === expected;
}

/**
 * Timed helper for API/MCP handlers.
 * @template T
 * @param {Record<string, unknown>} base
 * @param {() => Promise<T>} work
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {Promise<T>}
 */
export async function timed(base, work, env = process.env) {
  const started = Date.now();
  try {
    const value = await work();
    const ok = inferOk(value, base);
    await track(
      {
        ...base,
        ok,
        ms: Date.now() - started,
        ...(ok ? {} : { error: inferError(value) }),
      },
      env,
    );
    return value;
  } catch (error) {
    await track(
      {
        ...base,
        ok: false,
        ms: Date.now() - started,
        error: redactSecrets(error instanceof Error ? error.message : "failed"),
      },
      env,
    );
    throw error;
  }
}

function inferOk(value, base) {
  if (typeof base.ok === "boolean") return base.ok;
  if (value && typeof value === "object") {
    if ("isError" in value && /** @type {{ isError?: boolean }} */ (value).isError) return false;
    if ("ok" in value && typeof /** @type {{ ok?: unknown }} */ (value).ok === "boolean") {
      return /** @type {{ ok: boolean }} */ (value).ok;
    }
    if ("status" in value && typeof /** @type {{ status?: unknown }} */ (value).status === "number") {
      const status = /** @type {{ status: number }} */ (value).status;
      return status >= 200 && status < 400;
    }
  }
  return true;
}

function inferError(value) {
  if (!value || typeof value !== "object") return "failed";
  const content = /** @type {{ content?: Array<{ text?: string }> }} */ (value).content;
  if (Array.isArray(content) && content[0]?.text) return String(content[0].text).slice(0, 240);
  if ("error" in value) return String(/** @type {{ error?: unknown }} */ (value).error).slice(0, 240);
  return "failed";
}

function normalize(partial) {
  if (!partial || typeof partial !== "object") return null;
  const name = String(partial.name || "").trim().slice(0, 80);
  if (!name) return null;
  const source = ["ui", "api", "mcp"].includes(String(partial.source)) ? String(partial.source) : "api";
  const meta = scrubMeta(partial.meta);
  return {
    id: typeof partial.id === "string" && partial.id ? partial.id.slice(0, 64) : makeId(),
    ts: typeof partial.ts === "string" && partial.ts ? partial.ts : new Date().toISOString(),
    source,
    name,
    ok: partial.ok !== false,
    ms: Number.isFinite(Number(partial.ms)) ? Math.max(0, Math.round(Number(partial.ms))) : undefined,
    error: partial.ok === false && partial.error ? redactSecrets(String(partial.error)).slice(0, 240) : undefined,
    meta: Object.keys(meta).length ? meta : undefined,
  };
}

function scrubMeta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(input).slice(0, 24)) {
    const lower = key.toLowerCase();
    if (/auth|token|secret|password|cookie|authorization|apikey|api_key|bearer|key$/.test(lower)) continue;
    if (typeof value === "string") {
      out[key] = redact(value).slice(0, 160);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (value == null) {
      continue;
    } else {
      out[key] = redactSecrets(String(value)).slice(0, 120);
    }
  }
  return out;
}

function redact(value) {
  const cleaned = redactSecrets(value);
  if (/^kt_[a-f0-9_]{8,}$/i.test(cleaned)) return `${cleaned.slice(0, 7)}…`;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleaned)) return `${cleaned.slice(0, 4)}…${cleaned.slice(-4)}`;
  return cleaned;
}

function makeId() {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logLine(event) {
  try {
    console.log(JSON.stringify({ kazitrust_analytics: event }));
  } catch {
    // ignore
  }
}

function appendLocal(event) {
  const dir = dirname(FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(FILE, `${JSON.stringify(event)}\n`, "utf8");
}

function redisConfig(env) {
  return trustedRedisConfig(env);
}

async function persistRemote(event, env) {
  const redis = redisConfig(env);
  if (!redis) return;
  const payload = JSON.stringify(event);
  if (payload.length > 4000) return;
  const pipeline = [
    ["LPUSH", EVENTS_KEY, payload],
    ["LTRIM", EVENTS_KEY, "0", String(RING_MAX - 1)],
    ["HINCRBY", COUNTER_KEY, "total", "1"],
    ["HINCRBY", COUNTER_KEY, event.ok ? "ok" : "failed", "1"],
    ["HINCRBY", COUNTER_KEY, `source:${event.source}`, "1"],
    ["HINCRBY", COUNTER_KEY, `name:${event.name}`, "1"],
  ];
  if (event.meta && typeof event.meta.tool === "string") {
    pipeline.push(["HINCRBY", COUNTER_KEY, `tool:${event.meta.tool}`, "1"]);
  }
  if (event.meta && typeof event.meta.route === "string") {
    pipeline.push(["HINCRBY", COUNTER_KEY, `route:${event.meta.route}`, "1"]);
  }
  if (!event.ok) {
    pipeline.push(["LPUSH", FAIL_KEY, JSON.stringify(event)]);
    pipeline.push(["LTRIM", FAIL_KEY, "0", "199"]);
  }
  await redisFetch(redis, pipeline);
}

async function readRemote(env, limit) {
  const redis = redisConfig(env);
  if (!redis) {
    return { store: existsSync(FILE) ? "local-file" : "memory", events: [], failures: [], counters: {} };
  }
  try {
    const raw = await redisFetch(redis, [
      ["LRANGE", EVENTS_KEY, "0", String(limit - 1)],
      ["LRANGE", FAIL_KEY, "0", "24"],
      ["HGETALL", COUNTER_KEY],
    ]);
    const events = parseList(raw?.[0]).map(parseJson).filter(Boolean);
    const failures = parseList(raw?.[1]).map(parseJson).filter(Boolean);
    const counters = hashToObject(raw?.[2]);
    return { store: "upstash", events, failures, counters };
  } catch {
    return { store: "memory-fallback", events: [], failures: [], counters: {} };
  }
}

async function redisFetch(redis, pipeline) {
  const response = await fetch(`${redis.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${redis.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error(`redis ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body.map((row) => row?.result) : [];
}

function parseList(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function hashToObject(value) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!Array.isArray(value)) return out;
  for (let i = 0; i + 1 < value.length; i += 2) {
    out[String(value[i])] = Number(value[i + 1]) || 0;
  }
  return out;
}

function pickPrefixed(counters, prefix) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, value] of Object.entries(counters || {})) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = Number(value) || 0;
  }
  return out;
}

function countLocal(events) {
  /** @type {Record<string, number>} */
  const counters = { total: 0, ok: 0, failed: 0 };
  for (const event of events) {
    counters.total += 1;
    counters[event.ok === false ? "failed" : "ok"] = (counters[event.ok === false ? "failed" : "ok"] || 0) + 1;
    counters[`source:${event.source}`] = (counters[`source:${event.source}`] || 0) + 1;
    counters[`name:${event.name}`] = (counters[`name:${event.name}`] || 0) + 1;
    if (event.meta?.tool) counters[`tool:${event.meta.tool}`] = (counters[`tool:${event.meta.tool}`] || 0) + 1;
    if (event.meta?.route) counters[`route:${event.meta.route}`] = (counters[`route:${event.meta.route}`] || 0) + 1;
  }
  if (!events.length && existsSync(FILE)) {
    try {
      const lines = readFileSync(FILE, "utf8").trim().split(/\n+/).filter(Boolean).slice(-RING_MAX);
      return countLocal(lines.map(parseJson).filter(Boolean));
    } catch {
      return counters;
    }
  }
  return counters;
}
