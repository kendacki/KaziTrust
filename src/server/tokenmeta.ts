import { loadEnv, type Connect, type Plugin } from "vite";
import { permit } from "./apikey";

type NodeRequest = {
  method?: string;
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

export function tokenMetaPlugin(): Plugin {
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/token-meta", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, { appId, appSecret, local }, next);
    });
  };
  return {
    name: "kazitrust-token-meta",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      appId = env.PRIVY_APP_ID ?? "";
      appSecret = env.PRIVY_APP_SECRET ?? "";
      local = config.mode === "development";
    },
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

async function handle(
  req: NodeRequest,
  res: NodeResponse,
  auth: { appId: string; appSecret: string; local: boolean },
  next: Connect.NextFunction,
) {
  if (req.method !== "POST") {
    next();
    return;
  }
  const gate = await permit(req.headers?.authorization, auth.local, auth.appId, auth.appSecret);
  if (gate === "unconfigured") {
    send(res, 503, { error: "Sign-in is not configured." });
    return;
  }
  if (gate === "denied") {
    send(res, 401, { error: "Sign in before a query." });
    return;
  }
  let body = "";
  try {
    body = await readBody(req);
  } catch {
    send(res, 400, { error: "The token request was not readable." });
    return;
  }
  let uris: string[] = [];
  try {
    const parsed = JSON.parse(body) as { uris?: unknown };
    uris = Array.isArray(parsed.uris) ? parsed.uris.filter((item): item is string => typeof item === "string").slice(0, 8) : [];
  } catch {
    send(res, 400, { error: "The token request was not readable." });
    return;
  }
  const items = await Promise.all(uris.map((uri) => one(uri)));
  send(res, 200, { items });
}

async function one(uri: string): Promise<{ uri: string; image: string; name: string; symbol: string }> {
  const empty = { uri, image: "", name: "", symbol: "" };
  const url = publicUrl(uri);
  if (!url) return empty;
  if (isImage(url)) return { ...empty, image: url };
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { accept: "application/json,image/*", "user-agent": "KaziTrust token metadata" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !publicUrl(response.url)) return empty;
    const type = response.headers.get("content-type") || "";
    if (type.startsWith("image/")) return { ...empty, image: response.url };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 100_000) return empty;
    const text = new TextDecoder().decode(bytes).trim();
    if (!text.startsWith("{")) return empty;
    const json = JSON.parse(text) as Record<string, unknown>;
    return { uri, image: pickImage(json), name: clip(json.name), symbol: clip(json.symbol) };
  } catch {
    return empty;
  }
}

function pickImage(json: Record<string, unknown>): string {
  const files = json.properties && typeof json.properties === "object" ? (json.properties as { files?: { uri?: string; file?: string }[] }).files : undefined;
  const candidates = [json.image, json.image_url, json.logoURI, files?.[0]?.uri, files?.[0]?.file];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const url = publicUrl(candidate);
    if (url) return url;
  }
  return "";
}

function publicUrl(value: string): string {
  const raw = value.trim();
  if (raw.startsWith("ipfs://")) {
    const path = raw.slice("ipfs://".length).replace(/^ipfs\//, "");
    if (!path || path.length > 200 || path.includes("..") || path.includes("\\")) return "";
    return `https://ipfs.io/ipfs/${path}`;
  }
  if (raw.startsWith("ar://")) {
    const id = raw.slice("ar://".length);
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(id)) return "";
    return `https://arweave.net/${id}`;
  }
  return safeHttps(raw) ? raw : "";
}

function isImage(value: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|avif)(?:$|[?#])/i.test(value);
}

function safeHttps(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) return false;
  return !privateHost(host);
}

function privateHost(host: string): boolean {
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (bare === "::1" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd")) return true;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function clip(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 32) return "";
  return clean;
}

function readBody(req: NodeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20_000) reject(new Error("too large"));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
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
