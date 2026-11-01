import { track } from "../../mcp/analytics.mjs";
import { apiKeyAllowed, bearer } from "../../mcp/keyauth.mjs";
import { clientIp, publicError, rateLimit, redactSecrets, securityHeaders } from "../../mcp/security.mjs";

export const config = { maxDuration: 30 };

const SERVICES = [
  { method: "POST", path: "/api/v1/rpc", about: "Solana JSON-RPC through KaziTrust." },
  { method: "GET", path: "/api/v1/rugcheck", about: "Token risk report for a mint. Pass mint." },
  { method: "GET", path: "/api/v1/restrictions", about: "OFAC SDN Solana addresses, the Meteora Kelsier blacklist, and the Binance hack 2026 Solana watchlist." },
  { method: "GET", path: "/api/v1/solscan", about: "Label, portfolio, and recent DeFi activity. Pass path and address." },
  { method: "POST", path: "/api/v1/wording", about: "Sentences for a read. The key does not change a score." },
  { method: "POST", path: "/mcp", about: "Model Context Protocol endpoint for ChatGPT and OpenAI tool use." },
];

export default async function handler(req, res) {
  const started = Date.now();
  const url = requestUrl(req);
  const route = normalizeRoute(url.pathname);
  try {
    const result = await run(req, url, route);
    await track(
      {
        source: "api",
        name: "api_v1",
        ok: result.status < 400,
        ms: Date.now() - started,
        error: result.status >= 400 ? redactSecrets(String(result.body?.error || result.status)) : undefined,
        meta: { route, method: (req?.method || "GET").toUpperCase(), status: result.status },
      },
      process.env,
    );
    return write(res, result.status, result.body);
  } catch (error) {
    await track(
      {
        source: "api",
        name: "api_v1",
        ok: false,
        ms: Date.now() - started,
        error: redactSecrets(error instanceof Error ? error.message : "gateway failed"),
        meta: { route, method: (req?.method || "GET").toUpperCase() },
      },
      process.env,
    );
    return write(res, 502, { error: publicError(error, "The service did not answer.") });
  }
}

async function run(req, url, route) {
  const method = (req?.method || "GET").toUpperCase();
  if (method === "OPTIONS") return { status: 204, body: "" };

  if (!rateLimit(`api_v1:${clientIp(req)}`, { limit: 90, windowMs: 60_000 })) {
    return { status: 429, body: { error: "Too many API requests. Try again shortly." } };
  }

  const token = bearer(header(req, "authorization"));
  if (!(await apiKeyAllowed(token, req?.headers || {}, process.env))) {
    return { status: 401, body: { error: "Send the API key in the Authorization header." } };
  }

  if (method === "GET" && (route === "/api/v1" || route === "/api/v1/")) {
    return { status: 200, body: { name: "KaziTrust", base: "/api/v1", services: SERVICES } };
  }

  const target = forward(route);
  if (!target || method !== target.method) {
    return { status: 404, body: { error: "That service is not on this key." } };
  }

  const next = new URL(target.path, `${url.protocol}//${url.host}`);
  url.searchParams.forEach((value, key) => next.searchParams.set(key, value));

  const init = {
    method,
    headers: {
      authorization: header(req, "authorization"),
      "content-type": "application/json",
      cookie: header(req, "cookie"),
    },
  };
  if (method === "POST") init.body = await bodyOf(req);

  const response = await fetch(next, init);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Never echo upstream raw bodies — they may contain provider errors or secrets.
    body = { error: "Upstream returned a non-JSON body." };
  }
  return { status: response.status, body };
}

function forward(pathname) {
  if (pathname === "/api/v1/rpc") return { method: "POST", path: "/api/rpc" };
  if (pathname === "/api/v1/rugcheck") return { method: "GET", path: "/api/rugcheck" };
  if (pathname === "/api/v1/restrictions") return { method: "GET", path: "/api/restrictions" };
  if (pathname === "/api/v1/solscan") return { method: "GET", path: "/api/solscan" };
  if (pathname === "/api/v1/wording") return { method: "POST", path: "/api/groq" };
  return null;
}

function normalizeRoute(pathname) {
  if (!pathname.startsWith("/api/v1")) return `/api/v1${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  return pathname.replace(/\/+$/, "") || "/api/v1";
}

function requestUrl(req) {
  const host = header(req, "x-forwarded-host") || header(req, "host") || "localhost";
  const proto = header(req, "x-forwarded-proto") || "https";
  const path = typeof req?.url === "string" ? req.url : "/api/v1";
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
    if (text.length > 200_000) throw new Error("too large");
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > 200_000) throw new Error("too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(res, status, body) {
  const headers = { "content-type": "application/json", ...securityHeaders() };
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
