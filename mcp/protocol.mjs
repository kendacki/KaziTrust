import { track } from "./analytics.mjs";
import { keyFromArgs, stripKeyArgs, withApiKey } from "./auth.mjs";
import { callTool, INSTRUCTIONS, SERVER_INFO, TOOLS } from "./handlers.mjs";

const SUPPORTED_PROTOCOL = new Set(["2024-11-05", "2025-03-26", "2025-06-18"]);

export async function handleMcpMessage(message, env = process.env) {
  if (!message || typeof message !== "object") {
    return errorResponse(null, -32600, "Invalid request");
  }
  if (Array.isArray(message)) {
    const parts = [];
    for (const item of message) {
      const reply = await handleOne(item, env);
      if (reply) parts.push(reply);
    }
    return parts;
  }
  return handleOne(message, env);
}

async function handleOne(message, env) {
  const id = "id" in message ? message.id : null;
  const method = message.method;
  if (typeof method !== "string") return errorResponse(id, -32600, "Invalid request");

  if (method.startsWith("notifications/")) return null;

  const started = Date.now();
  try {
    if (method === "initialize") {
      const requested = String(message.params?.protocolVersion || "2024-11-05");
      const protocolVersion = SUPPORTED_PROTOCOL.has(requested) ? requested : "2024-11-05";
      const payload = result(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
          title: SERVER_INFO.title,
          description: SERVER_INFO.description,
        },
        instructions: INSTRUCTIONS,
      });
      await track({ source: "mcp", name: "initialize", ok: true, ms: Date.now() - started, meta: { protocolVersion } }, env);
      return payload;
    }
    if (method === "ping") return result(id, {});
    if (method === "tools/list") {
      await track({ source: "mcp", name: "tools/list", ok: true, ms: Date.now() - started }, env);
      return result(id, { tools: TOOLS });
    }
    if (method === "tools/call") {
      const name = message.params?.name;
      const rawArgs = message.params?.arguments ?? {};
      if (typeof name !== "string") {
        await track(
          { source: "mcp", name: "tools/call", ok: false, ms: Date.now() - started, error: "Tool name required" },
          env,
        );
        return errorResponse(id, -32602, "Tool name required");
      }
      const callEnv = withApiKey(env, keyFromArgs(rawArgs));
      const args = stripKeyArgs(rawArgs);
      const gate = authorize(callEnv, name);
      if (gate) {
        await track(
          {
            source: "mcp",
            name: "tools/call",
            ok: false,
            ms: Date.now() - started,
            error: gate,
            meta: { tool: name, reason: "auth" },
          },
          env,
        );
        return errorResponse(id, -32001, gate);
      }
      const output = await callTool(name, args, callEnv);
      const failed = Boolean(output?.isError);
      await track(
        {
          source: "mcp",
          name: "tools/call",
          ok: !failed,
          ms: Date.now() - started,
          error: failed ? String(output?.content?.[0]?.text || "tool error").slice(0, 240) : undefined,
          meta: { tool: name },
        },
        env,
      );
      return result(id, output);
    }
    await track(
      {
        source: "mcp",
        name: method,
        ok: false,
        ms: Date.now() - started,
        error: `Method not found: ${method}`,
      },
      env,
    );
    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Internal error";
    await track(
      {
        source: "mcp",
        name: typeof method === "string" ? method : "error",
        ok: false,
        ms: Date.now() - started,
        error: messageText,
      },
      env,
    );
    return errorResponse(id, -32603, messageText);
  }
}

function authorize(env, toolName) {
  const open = String(env.KAZITRUST_MCP_OPEN || "").toLowerCase() === "1" || String(env.MCP_OPEN || "").toLowerCase() === "1";
  if (open) return null;
  if (toolName === "search" || toolName === "fetch" || toolName === "list_services" || toolName === "screen_address") {
    return null;
  }
  const key = (env.KAZITRUST_API_KEY || env.MCP_API_KEY || "").trim();
  if (!key) {
    return "wallet_snapshot and token_risk need a kt_ API key. In Claude: reconnect the connector with https://www.kazitrustai.fun/mcp/kt_YOUR_KEY (or add Request header Authorization = Bearer kt_YOUR_KEY if your plan shows that field). You can also pass api_key on the tool call.";
  }
  return null;
}

function result(id, value) {
  return { jsonrpc: "2.0", id, result: value };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function mcpHttpHeaders() {
  return {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization, x-api-key, x-auth-token, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}
