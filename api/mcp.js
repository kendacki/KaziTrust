import { track } from "../mcp/analytics.mjs";
import { handleMcpMessage, mcpHttpHeaders } from "../mcp/protocol.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const result = await run(req);
    if ((req?.method || "GET").toUpperCase() !== "GET") {
      await track(
        {
          source: "mcp",
          name: "http",
          ok: result.status < 400,
          ms: Date.now() - started,
          error: result.status >= 400 ? String(result.body?.error || result.status) : undefined,
          meta: { route: "/mcp", status: result.status },
        },
        process.env,
      );
    }
    return write(res, result.status, result.body, result.headers);
  } catch (error) {
    await track(
      {
        source: "mcp",
        name: "http",
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "MCP failed",
        meta: { route: "/mcp" },
      },
      process.env,
    );
    return write(res, 500, { error: error instanceof Error ? error.message : "MCP failed." }, mcpHttpHeaders());
  }
}

async function run(req) {
  const method = (req?.method || "GET").toUpperCase();
  const headers = mcpHttpHeaders();

  if (method === "OPTIONS") {
    return { status: 204, body: "", headers };
  }

  if (method === "GET") {
    return {
      status: 200,
      body: {
        name: "KaziTrust MCP",
        transport: "streamable-http",
        protocol: "MCP over JSON-RPC POST",
        endpoint: "/mcp",
        tools: ["search", "fetch", "screen_address", "wallet_snapshot", "token_risk", "list_services"],
        auth: "Optional Bearer kt_ key for hosted chain and RugCheck tools. search, fetch, screen_address, and list_services work without a key.",
      },
      headers,
    };
  }

  if (method !== "POST") {
    return { status: 405, body: { error: "Use GET or POST." }, headers };
  }

  const raw = await bodyOf(req);
  let message;
  try {
    message = JSON.parse(raw || "{}");
  } catch {
    return { status: 400, body: { error: "Body must be JSON-RPC." }, headers };
  }

  const env = { ...process.env };
  const auth = header(req, "authorization");
  if (auth) {
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (token) env.KAZITRUST_API_KEY = token;
  }
  if (!env.KAZITRUST_BASE_URL) {
    const host = header(req, "x-forwarded-host") || header(req, "host") || "kazitrustai.fun";
    const proto = header(req, "x-forwarded-proto") || "https";
    env.KAZITRUST_BASE_URL = `${proto}://${host}`;
  }

  const reply = await handleMcpMessage(message, env);
  if (reply == null) return { status: 202, body: "", headers };
  return { status: 200, body: reply, headers };
}

function header(req, name) {
  if (req?.headers && typeof req.headers.get === "function") return req.headers.get(name) || "";
  const headers = req?.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] : value || "";
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
