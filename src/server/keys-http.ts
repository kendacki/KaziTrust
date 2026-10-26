import { signedIn } from "./session";

type SavedKey = {
  hash: string;
  prefix: string;
  createdAt: string;
};

const COOKIE = "kazitrust_key";
let current: SavedKey | null = null;

export async function handleKeyRequest(request: Request): Promise<Response> {
  try {
    const appId = env("PRIVY_APP_ID") || env("VITE_PRIVY_APP_ID");
    const secret = env("PRIVY_APP_SECRET");
    if (!appId || !secret) return json({ error: "Sign-in is not configured." }, 503);
    const restored = await readCookie(request.headers.get("cookie") ?? "", secret);
    if (restored) current = restored;
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!(await signedIn(appId, secret, token))) return json({ error: "Sign in before creating a key." }, 401);
    if (request.method === "GET") {
      return json({ key: current ? { prefix: current.prefix, createdAt: current.createdAt } : null }, 200);
    }
    if (request.method === "POST") {
      const issued = await mint();
      current = { hash: await sha(issued.key), prefix: issued.prefix, createdAt: issued.createdAt };
      const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
      return json(issued, 200, { "set-cookie": await seal(current, secret, host) });
    }
    return json({ error: "Use GET or POST." }, 405);
  } catch {
    return json({ error: "The key service did not answer." }, 500);
  }
}

function env(name: string): string {
  const fromProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return fromProcess ?? "";
}

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: extra });
}

async function mint(): Promise<{ key: string; prefix: string; createdAt: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = `kt_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const createdAt = new Date().toISOString();
  return { key, prefix: key.slice(0, 7), createdAt };
}

async function sha(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seal(record: SavedKey, secret: string, host: string): Promise<string> {
  const payload = b64(JSON.stringify(record));
  const sig = await mac(secret, payload);
  const name = host.split(":")[0];
  const domain = name === "kazitrustai.fun" || name.endsWith(".kazitrustai.fun") ? "; Domain=.kazitrustai.fun" : "";
  return `${COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000${domain}`;
}

async function readCookie(cookie: string, secret: string): Promise<SavedKey | null> {
  const pair = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!pair) return null;
  const value = decodeURIComponent(pair.slice(COOKIE.length + 1));
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  if ((await mac(secret, payload)) !== value.slice(dot + 1)) return null;
  try {
    const body = JSON.parse(unb64(payload)) as Partial<SavedKey>;
    if (!body.hash || !body.prefix || !body.createdAt) return null;
    return { hash: body.hash, prefix: body.prefix, createdAt: body.createdAt };
  } catch {
    return null;
  }
}

async function mac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64(new Uint8Array(sig));
}

function unb64(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function b64(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
