let cachedKey = "";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  try {
    const result = await run(req);
    return write(res, result.status, result.body);
  } catch {
    return write(res, 502, { error: "Token metadata could not be read." });
  }
}

async function run(req) {
  if ((req?.method || "GET") !== "POST") return { status: 405, body: { error: "Use POST." } };
  const appId = env("PRIVY_APP_ID") || env("VITE_PRIVY_APP_ID");
  const secret = env("PRIVY_APP_SECRET");
  if (!appId || !secret) return { status: 503, body: { error: "Sign-in is not configured." } };
  const request = asRequest(req);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let allowed = false;
  try {
    allowed = await signedIn(appId, secret, token);
  } catch {
    return { status: 503, body: { error: "Sign-in is not configured." } };
  }
  if (!allowed) return { status: 401, body: { error: "Sign in before a query." } };
  let body;
  try {
    body = JSON.parse(await bodyOf(req));
  } catch {
    return { status: 400, body: { error: "The token request was not readable." } };
  }
  const uris = Array.isArray(body?.uris) ? body.uris.filter((item) => typeof item === "string").slice(0, 8) : [];
  const items = await Promise.all(uris.map((uri) => one(uri)));
  return { status: 200, body: { items } };
}

async function one(uri) {
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
    if (bytes.length > 100000) return empty;
    const text = new TextDecoder().decode(bytes).trim();
    if (!text.startsWith("{")) return empty;
    const json = JSON.parse(text);
    return { uri, image: pickImage(json), name: clip(json.name), symbol: clip(json.symbol) };
  } catch {
    return empty;
  }
}

function pickImage(json) {
  const files = json?.properties && typeof json.properties === "object" ? json.properties.files : undefined;
  const candidates = [json?.image, json?.image_url, json?.logoURI, files?.[0]?.uri, files?.[0]?.file];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const url = publicUrl(candidate);
    if (url) return url;
  }
  return "";
}

function publicUrl(value) {
  if (typeof value !== "string") return "";
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

function isImage(value) {
  return /\.(png|jpe?g|gif|webp|svg|avif)(?:$|[?#])/i.test(value);
}

function safeHttps(value) {
  let url;
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

function privateHost(host) {
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

function clip(value) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 32) return "";
  return clean;
}

function env(name) {
  return globalThis.process?.env?.[name] || "";
}

function asRequest(input) {
  if (input && input.headers && typeof input.headers.get === "function") return input;
  const headers = new Headers();
  const source = input?.headers || {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return new Request("https://kazitrustai.fun/api/token-meta", { method: input?.method || "POST", headers });
}

async function bodyOf(req) {
  if (req && typeof req.text === "function" && req.headers && typeof req.headers.get === "function") {
    const text = await req.text();
    if (text.length > 20000) throw new Error("too large");
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > 20000) throw new Error("too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(res, status, body) {
  const text = JSON.stringify(body);
  if (res && typeof res.end === "function") {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(text);
    return;
  }
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

async function signedIn(appId, appSecret, token) {
  if (!token || token.length > 8000) return false;
  const key = cachedKey || (await verificationKey(appId, appSecret));
  cachedKey = key;
  return verify(token, key, appId);
}

async function verificationKey(appId, appSecret) {
  const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, {
    headers: { authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`, "privy-app-id": appId },
  });
  if (!response.ok) throw new Error("Privy did not accept the app credentials.");
  const body = await response.json();
  if (!body.verification_key?.includes("BEGIN PUBLIC KEY")) throw new Error("Privy did not return a verification key.");
  return body.verification_key;
}

async function verify(token, pem, appId) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const header = JSON.parse(new TextDecoder().decode(base64Url(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64Url(parts[1])));
  if (header.alg !== "ES256" || payload.iss !== "privy.io") return false;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(appId)) return false;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.sub?.startsWith("did:privy:")) return false;
  const key = await crypto.subtle.importKey("spki", copyBytes(pemBytes(pem)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, copyBytes(base64Url(parts[2])), data);
}

function copyBytes(bytes) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function pemBytes(pem) {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function base64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
