import { track } from "../mcp/analytics.mjs";
import { keyFromHeaders, keyFromUrl, withApiKey } from "../mcp/auth.mjs";
import { handleMcpMessage, mcpHttpHeaders } from "../mcp/protocol.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const result = await run(req);
    if ((req?.method || "GET").toUpperCase() !== "GET" || result.status >= 400) {
      await track(
        {
          source: "mcp",
          name: "http",
          ok: result.status < 400,
          ms: Date.now() - started,
          error: result.status >= 400 ? String(result.body?.error || result.status) : undefined,
          meta: { route: "/mcp", status: result.status, method: (req?.method || "GET").toUpperCase() },
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
  const accept = header(req, "accept").toLowerCase();
  const requestUrl = requestUrlOf(req);

  if (method === "OPTIONS") {
    return { status: 204, body: "", headers };
  }

  if (method === "DELETE") {
    return { status: 405, body: { error: "This MCP server does not use client-managed sessions." }, headers };
  }

  if (method === "GET") {
    // Streamable HTTP clients that only ask for SSE should get 405, not a JSON page.
    if (accept.includes("text/event-stream") && !accept.includes("application/json") && !accept.includes("*/*") && !accept.includes("text/html")) {
      return { status: 405, body: { error: "SSE listen is not enabled. Use JSON-RPC POST." }, headers };
    }
    return {
      status: 200,
      body: {
        name: "KaziTrust MCP",
        agent: "Kaz",
        transport: "streamable-http",
        protocol: "MCP over JSON-RPC POST",
        endpoint: "/mcp",
        tools: ["search", "fetch", "screen_address", "wallet_snapshot", "token_risk", "list_services"],
        auth: {
          header: "Authorization: Bearer kt_your_key",
          also: ["x-api-key", "path /mcp/kt_your_key", "tool arg api_key"],
          note: "search, fetch, screen_address, and list_services work without a key.",
        },
        connect: {
          claude:
            "Settings → Connectors → Add custom connector. If there is no Request headers field, paste https://www.kazitrustai.fun/mcp/kt_YOUR_KEY. If Request headers is available, use the plain /mcp URL and set Authorization to Bearer kt_YOUR_KEY.",
          chatgpt: "Add a custom MCP server with https://www.kazitrustai.fun/mcp and a Bearer kt_ key when asked.",
          note: "Do not open this URL as a normal chat link. Paste it into the MCP / connector settings of your client.",
        },
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

  let env = { ...process.env };
  const key =
    keyFromHeaders((name) => header(req, name)) ||
    keyFromUrl(requestUrl);
  env = withApiKey(env, key);
  if (!env.KAZITRUST_BASE_URL) {
    const host = header(req, "x-forwarded-host") || header(req, "host") || "www.kazitrustai.fun";
    const proto = header(req, "x-forwarded-proto") || "https";
    env.KAZITRUST_BASE_URL = `${proto}://${host}`;
  }

  const reply = await handleMcpMessage(message, env);
  if (reply == null) return { status: 202, body: "", headers };
  return { status: 200, body: reply, headers };
}

function requestUrlOf(req) {
  const host = header(req, "x-forwarded-host") || header(req, "host") || "www.kazitrustai.fun";
  const proto = header(req, "x-forwarded-proto") || "https";
  if (typeof req?.url === "string" && req.url) {
    try {
      return new URL(req.url, `${proto}://${host}`);
    } catch {
      /* fall through */
    }
  }
  return new URL(`${proto}://${host}/mcp`);
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
