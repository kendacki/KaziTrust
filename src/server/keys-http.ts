import { bearer, bindKeyStore, issueKey, keyRecord, rememberKey, savedKey, type SavedKey } from "./apikey";
import { signedIn } from "./session";

declare const process: { env: Record<string, string | undefined> };

type Header = string | string[] | undefined;

export type KeyRequest = {
  method?: string;
  headers: { authorization?: Header; cookie?: Header; host?: Header; "x-forwarded-host"?: Header };
};

export type KeyResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

const COOKIE = "kazitrust_key";
let bound = false;

export async function handleKeys(req: KeyRequest, res: KeyResponse) {
  try {
    if (!bound) {
      bound = true;
      bindKeyStore("/tmp/kazitrust");
    }
    const appId = process.env.PRIVY_APP_ID ?? "";
    const secret = process.env.PRIVY_APP_SECRET ?? "";
    if (!appId || !secret) {
      send(res, 503, { error: "Sign-in is not configured." });
      return;
    }
    const restored = await readCookie(header(req.headers.cookie), secret);
    if (restored) rememberKey(restored);
    if (!(await signedIn(appId, secret, bearer(req.headers.authorization)))) {
      send(res, 401, { error: "Sign in before creating a key." });
      return;
    }
    if (req.method === "GET") {
      send(res, 200, { key: keyRecord() });
      return;
    }
    if (req.method === "POST") {
      const issued = await issueKey();
      const saved = savedKey();
      if (saved) res.setHeader("set-cookie", await seal(saved, secret, header(req.headers["x-forwarded-host"]) || header(req.headers.host)));
      send(res, 200, issued);
      return;
    }
    send(res, 405, { error: "Use GET or POST." });
  } catch {
    send(res, 503, { error: "Sign-in is not configured." });
  }
}

function header(value: Header): string {
  return (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim() ?? "";
}

function send(res: KeyResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

async function seal(record: SavedKey, secret: string, host: string): Promise<string> {
  const payload = b64(JSON.stringify({ hash: record.hash, prefix: record.prefix, createdAt: record.createdAt }));
  const sig = await mac(secret, payload);
  const domain = host.endsWith("kazitrustai.fun") ? "; Domain=.kazitrustai.fun" : "";
  return `${COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000${domain}`;
}

async function readCookie(cookie: string, secret: string): Promise<SavedKey | null> {
  const pair = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!pair) return null;
  const value = pair.slice(COOKIE.length + 1);
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if ((await mac(secret, payload)) !== sig) return null;
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
