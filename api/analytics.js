import {
  analyticsHttpHeaders,
  authorizeAnalyticsRead,
  ingestClientEvents,
  summarize,
  track,
} from "../mcp/analytics.mjs";
import { clientIp, publicError, rateLimit } from "../mcp/security.mjs";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    const result = await run(req);
    return write(res, result.status, result.body, result.headers);
  } catch (error) {
    return write(
      res,
      500,
      { error: publicError(error, "Analytics failed.") },
      analyticsHttpHeaders(req),
    );
  }
}

async function run(req) {
  const method = (req?.method || "GET").toUpperCase();
  const headers = analyticsHttpHeaders(req);

  if (method === "OPTIONS") return { status: 204, body: "", headers };

  if (!rateLimit(`analytics:${clientIp(req)}:${method}`, { limit: method === "GET" ? 20 : 30, windowMs: 60_000 })) {
    return { status: 429, body: { error: "Too many analytics requests from this client." }, headers };
  }

  if (method === "GET") {
    const url = requestUrl(req);
    if (url.searchParams.get("health") === "1") {
      return { status: 200, body: { ok: true, service: "analytics" }, headers };
    }
    // Never accept the analytics token in the query string (logs / referrers).
    const auth = header(req, "authorization") || "";
    if (!authorizeAnalyticsRead(auth, process.env)) {
      return { status: 401, body: { error: "Analytics summary requires Authorization: Bearer ANALYTICS_TOKEN." }, headers };
    }
    const limit = Number(url.searchParams.get("limit") || 40);
    const body = await summarize(process.env, { limit });
    return { status: 200, body, headers };
  }

  if (method !== "POST") {
    return { status: 405, body: { error: "Use GET or POST." }, headers };
  }

  const raw = await bodyOf(req);
  let parsed;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { status: 400, body: { error: "Body must be JSON." }, headers };
  }

  const events = Array.isArray(parsed?.events) ? parsed.events : [parsed];
  const accepted = await ingestClientEvents(events, process.env);
  await track(
    {
      source: "api",
      name: "analytics_ingest",
      ok: true,
      meta: { accepted: accepted.length, route: "/api/analytics" },
    },
    process.env,
  );
  return { status: 202, body: { ok: true, accepted: accepted.length }, headers };
}

function requestUrl(req) {
  const host = header(req, "x-forwarded-host") || header(req, "host") || "localhost";
  const proto = header(req, "x-forwarded-proto") || "https";
  const path = typeof req?.url === "string" ? req.url : "/api/analytics";
  return new URL(path.startsWith("http") ? path : `${proto}://${host}${path}`);
}

function header(req, name) {
  if (req?.headers && typeof req.headers.get === "function") return req.headers.get(name) || "";
  const headers = req?.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : value || "";
}

async function bodyOf(req) {
  if (req && typeof req.text === "function" && req.headers && typeof req.headers.get === "function") {
    const text = await req.text();
    if (text.length > 80_000) throw new Error("too large");
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > 80_000) throw new Error("too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(res, status, body, headers = {}) {
  if (typeof res?.status === "function" && typeof res?.json === "function") {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    if (body === "") return res.status(status).end();
    if (typeof body === "string") return res.status(status).send(body);
    return res.status(status).json(body);
  }
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  if (body === "") {
    res.end();
    return;
  }
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
