import { callTool, INSTRUCTIONS, SERVER_INFO, TOOLS } from "./handlers.mjs";

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

  try {
    if (method === "initialize") {
      return result(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: SERVER_INFO.name,
          version: SERVER_INFO.version,
          title: SERVER_INFO.title,
          description: SERVER_INFO.description,
        },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === "ping") return result(id, {});
    if (method === "tools/list") return result(id, { tools: TOOLS });
    if (method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments ?? {};
      if (typeof name !== "string") return errorResponse(id, -32602, "Tool name required");
      const gate = authorize(env, name);
      if (gate) return errorResponse(id, -32001, gate);
      const output = await callTool(name, args, env);
      return result(id, output);
    }
    return errorResponse(id, -32601, `Method not found: ${method}`);
  } catch (error) {
    return errorResponse(id, -32603, error instanceof Error ? error.message : "Internal error");
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
    return "Set KAZITRUST_API_KEY for wallet_snapshot and token_risk, or set KAZITRUST_MCP_OPEN=1 for local open mode.";
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
    "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}
