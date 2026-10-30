import { loadEnv, type Connect, type Plugin } from "vite";
import { bearer, bindKeyStore, issueKey, keyMatches, keyRecord } from "./apikey";
import { signedIn } from "./session";

const SERVICES = [
  { method: "POST", path: "/api/v1/rpc", about: "Solana JSON-RPC through KaziTrust." },
  { method: "GET", path: "/api/v1/rugcheck", about: "Token risk report for a mint. Pass mint." },
  { method: "GET", path: "/api/v1/restrictions", about: "OFAC SDN Solana addresses and the Meteora Kelsier blacklist." },
  { method: "GET", path: "/api/v1/solscan", about: "Label, portfolio, and recent DeFi activity. Pass path and address." },
  { method: "POST", path: "/api/v1/wording", about: "Sentences for a read. The key does not change a score." },
];

type NodeRequest = {
  method?: string;
  url?: string;
  headers?: { authorization?: string | string[] };
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

export function gatewayPlugin(): Plugin {
  let origin = "http://127.0.0.1:5173";
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const request = req as NodeRequest;
      const url = new URL(request.url ?? "", "http://127.0.0.1");
      if (url.pathname !== "/api/keys" && !url.pathname.startsWith("/api/v1")) {
        next();
        return;
      }
      void handle(request, res as NodeResponse, url, { origin, appId, appSecret, local });
    });
  };
  return {
    name: "kazitrust-gateway",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      bindKeyStore(config.root);
      appId = env.PRIVY_APP_ID ?? "";
      appSecret = env.PRIVY_APP_SECRET ?? "";
      local = config.mode === "development";
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

async function handle(
  req: NodeRequest,
  res: NodeResponse,
  url: URL,
  auth: { origin: string; appId: string; appSecret: string; local: boolean },
) {
  if (url.pathname === "/api/keys") {
    await keys(req, res, auth);
    return;
  }
  const token = bearer(req.headers?.authorization);
  if (!(await keyMatches(token))) {
    send(res, 401, { error: "Send the API key in the Authorization header." });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/v1") {
    send(res, 200, { name: "KaziTrust", base: "/api/v1", services: SERVICES });
    return;
  }
  const target = forward(url.pathname);
  if (!target || req.method !== target.method) {
    send(res, 404, { error: "That service is not on this key." });
    return;
  }
  const next = new URL(target.path, auth.origin);
  url.searchParams.forEach((value, key) => next.searchParams.set(key, value));
  try {
    const body = req.method === "POST" ? await readBody(req) : undefined;
    const response = await fetch(next, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body,
    });
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("content-type", "application/json");
    res.end(text.slice(0, 2_000_000));
  } catch {
    send(res, 502, { error: "The service did not answer." });
  }
}

function forward(pathname: string): { method: "GET" | "POST"; path: string } | null {
  if (pathname === "/api/v1/rpc") return { method: "POST", path: "/rpc" };
  if (pathname === "/api/v1/rugcheck") return { method: "GET", path: "/api/rugcheck" };
  if (pathname === "/api/v1/restrictions") return { method: "GET", path: "/api/restrictions" };
  if (pathname === "/api/v1/solscan") return { method: "GET", path: "/api/solscan" };
  if (pathname === "/api/v1/wording") return { method: "POST", path: "/api/groq" };
  return null;
}

async function keys(
  req: NodeRequest,
  res: NodeResponse,
  auth: { appId: string; appSecret: string; local: boolean },
) {
  if (!auth.local) {
    if (!auth.appId || !auth.appSecret) {
      send(res, 503, { error: "Sign-in is not configured." });
      return;
    }
    if (!(await signedIn(auth.appId, auth.appSecret, bearer(req.headers?.authorization)))) {
      send(res, 401, { error: "Sign in before creating a key." });
      return;
    }
  }
  if (req.method === "GET") {
    send(res, 200, { key: keyRecord() });
    return;
  }
  if (req.method === "POST") {
    const hours = await chosenHours(req);
    if (hours == null) {
      send(res, 400, { error: "Choose how long the key stays active." });
      return;
    }
    try {
      const issued = await issueKey(hours);
      send(res, 200, issued);
    } catch {
      send(res, 400, { error: "Choose how long the key stays active." });
    }
    return;
  }
  send(res, 405, { error: "Use GET or POST." });
}

async function chosenHours(req: NodeRequest): Promise<number | null> {
  try {
    const text = await readBody(req);
    if (!text) return null;
    const body = JSON.parse(text) as { hours?: unknown };
    return typeof body.hours === "number" ? body.hours : null;
  } catch {
    return null;
  }
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

function send(res: NodeResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
