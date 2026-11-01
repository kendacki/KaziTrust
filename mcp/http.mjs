#!/usr/bin/env node
import { createServer } from "node:http";
import { keyFromHeaders, keyFromUrl, withApiKey } from "./auth.mjs";
import { handleMcpMessage, mcpHttpHeaders } from "./protocol.mjs";

const port = Number(process.env.MCP_PORT || 8787);
const host = process.env.MCP_HOST || "127.0.0.1";

const server = createServer(async (req, res) => {
  const headers = mcpHttpHeaders();
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET") {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        name: "KaziTrust MCP",
        transport: "streamable-http",
        endpoint: `http://${host}:${port}/mcp`,
      }),
    );
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Use GET or POST." }));
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const message = JSON.parse(raw || "{}");
    const requestUrl = new URL(req.url || "/mcp", `http://${host}:${port}`);
    let env = { ...process.env };
    env = withApiKey(
      env,
      keyFromHeaders((name) => {
        const value = req.headers[name] || req.headers[name.toLowerCase()];
        return Array.isArray(value) ? value[0] || "" : value || "";
      }) || keyFromUrl(requestUrl),
    );
    if (!env.KAZITRUST_BASE_URL) env.KAZITRUST_BASE_URL = `http://${host}:${process.env.VITE_PORT || 5173}`;
    const reply = await handleMcpMessage(message, env);
    if (reply == null) {
      res.statusCode = 202;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify(reply));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "MCP failed." }));
  }
});

server.listen(port, host, () => {
  console.log(`KaziTrust MCP listening on http://${host}:${port}/mcp`);
});
