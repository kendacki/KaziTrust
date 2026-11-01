import type { Connect, Plugin } from "vite";
// Local MCP JSON-RPC helpers (plain ESM next to the Vite app).
import { handleMcpMessage, mcpHttpHeaders } from "../../mcp/protocol.mjs";

type NodeRequest = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

export function mcpPlugin(): Plugin {
  let origin = "http://127.0.0.1:5173";
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const request = req as NodeRequest;
      const url = new URL(request.url ?? "", "http://127.0.0.1");
      if (url.pathname !== "/mcp" && url.pathname !== "/api/mcp") {
        next();
        return;
      }
      void handle(request, res as NodeResponse, origin);
    });
  };
  return {
    name: "kazitrust-mcp",
    configResolved(config) {
      const host = config.server.host && config.server.host !== true ? config.server.host : "127.0.0.1";
      const port = config.server.port ?? 5173;
      origin = `http://${host}:${port}`;
    },
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      const host = server.config.server.host && server.config.server.host !== true ? server.config.server.host : "127.0.0.1";
      origin = `http://${host}:${server.config.server.port ?? 4173}`;
      attach(server.middlewares);
    },
  };
}

async function handle(req: NodeRequest, res: NodeResponse, origin: string) {
  const headers = mcpHttpHeaders();
  for (const key of Object.keys(headers)) res.setHeader(key, headers[key] ?? "");

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET") {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        name: "KaziTrust MCP",
        transport: "streamable-http",
        endpoint: `${origin}/mcp`,
        tools: ["search", "fetch", "screen_address", "wallet_snapshot", "token_risk", "list_services"],
      }),
    );
    return;
  }

  if (method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Use GET or POST." }));
    return;
  }

  try {
    const raw = await readBody(req);
    const message = JSON.parse(raw || "{}") as unknown;
    const env: Record<string, string | undefined> = { ...process.env, KAZITRUST_BASE_URL: origin, KAZITRUST_MCP_OPEN: "1" };
    const auth = header(req, "authorization");
    if (auth) {
      const token = auth.replace(/^Bearer\s+/i, "").trim();
      if (token) env.KAZITRUST_API_KEY = token;
    }
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
}

function header(req: NodeRequest, name: string): string {
  const headers = req.headers || {};
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : "";
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readBody(req: NodeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > 200_000) {
        reject(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(merged));
    });
    req.on("error", reject);
  });
}
