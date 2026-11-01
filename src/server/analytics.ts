import type { Connect, Plugin } from "vite";
import {
  analyticsHttpHeaders,
  authorizeAnalyticsRead,
  ingestClientEvents,
  summarize,
} from "../../mcp/analytics.mjs";

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

export function analyticsPlugin(): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const request = req as NodeRequest;
      const url = new URL(request.url ?? "", "http://127.0.0.1");
      if (url.pathname !== "/api/analytics") {
        next();
        return;
      }
      void handle(request, res as NodeResponse, url);
    });
  };
  return {
    name: "kazitrust-analytics",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

async function handle(req: NodeRequest, res: NodeResponse, url: URL) {
  const headers = analyticsHttpHeaders();
  for (const key of Object.keys(headers)) res.setHeader(key, headers[key] ?? "");

  const method = (req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (method === "GET") {
    if (url.searchParams.get("health") === "1") {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, service: "analytics" }));
      return;
    }
    const auth = header(req, "authorization") || url.searchParams.get("token") || "";
    if (!authorizeAnalyticsRead(auth, process.env)) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "Analytics summary requires ANALYTICS_TOKEN." }));
      return;
    }
    const body = await summarize(process.env, { limit: Number(url.searchParams.get("limit") || 40) });
    res.statusCode = 200;
    res.end(JSON.stringify(body));
    return;
  }

  if (method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Use GET or POST." }));
    return;
  }

  try {
    const raw = await readBody(req);
    const parsed = JSON.parse(raw || "{}") as { events?: unknown } | unknown;
    const events = parsed && typeof parsed === "object" && "events" in parsed && Array.isArray(parsed.events) ? parsed.events : [parsed];
    const accepted = await ingestClientEvents(events, { ...process.env, KAZITRUST_MCP_OPEN: "1" });
    res.statusCode = 202;
    res.end(JSON.stringify({ ok: true, accepted: accepted.length }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Analytics failed." }));
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
      if (size > 80_000) {
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
