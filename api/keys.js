const COOKIE = "kazitrust_key";
const LIFETIMES = [1, 6, 24, 168, 720];
let current = null;
let cachedKey = "";

export default async function handler(req, res) {
  try {
    const request = asRequest(req);
    const raw = request.method === "POST" ? await nodeBody(req) : "";
    const result = await run(request, raw);
    if (res && typeof res.end === "function") {
      writeNode(res, result);
      return;
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    const body = JSON.stringify({ error: "The key service did not answer." });
    if (res && typeof res.end === "function") {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(body);
      return;
    }
    return new Response(body, { status: 500, headers: { "content-type": "application/json" } });
  }
}

async function run(request, raw) {
  const appId = env("PRIVY_APP_ID") || env("VITE_PRIVY_APP_ID");
  const secret = env("PRIVY_APP_SECRET");
  if (!appId || !secret) return { status: 503, body: { error: "Sign-in is not configured." } };
  const restored = await readCookie(request.headers.get("cookie") || "", secret);
  if (restored) current = restored;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let allowed = false;
  try {
    allowed = await signedIn(appId, secret, token);
  } catch {
    return { status: 503, body: { error: "Sign-in is not configured." } };
  }
  if (!allowed) return { status: 401, body: { error: "Sign in before creating a key." } };
  if (request.method === "GET") {
    return { status: 200, body: { key: viewOf(current) } };
  }
  if (request.method !== "POST") return { status: 405, body: { error: "Use GET or POST." } };
  const hours = readHours(raw);
  if (!LIFETIMES.includes(hours)) return { status: 400, body: { error: "Choose how long the key stays active." } };
  const issued = mint(hours);
  current = { hash: await sha(issued.key), prefix: issued.prefix, createdAt: issued.createdAt, expiresAt: issued.expiresAt };
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const maxAge = Math.max(1, Math.ceil((Date.parse(issued.expiresAt) - Date.now()) / 1000));
  return { status: 200, body: issued, cookie: await seal(current, secret, host, maxAge) };
}

function viewOf(record) {
  if (!record) return null;
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : null;
  const ends = expiresAt ? Date.parse(expiresAt) : NaN;
  const active = !expiresAt || (Number.isFinite(ends) && ends > Date.now());
  return { prefix: record.prefix, createdAt: record.createdAt, expiresAt, active };
}

function readHours(raw) {
  if (!raw || raw.length > 200) return null;
  try {
    const body = JSON.parse(raw);
    return typeof body?.hours === "number" ? body.hours : null;
  } catch {
    return null;
  }
}

function nodeBody(req) {
  if (req && typeof req.text === "function" && typeof req.on !== "function") return req.text();
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== "function") {
      resolve("");
      return;
    }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.byteLength || chunk.length || 0;
      if (size > 2000) {
        reject(new Error("too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function writeNode(res, result) {
  res.statusCode = result.status;
  res.setHeader("content-type", "application/json");
  if (result.cookie) res.setHeader("set-cookie", result.cookie);
  res.end(JSON.stringify(result.body));
}

function asRequest(input) {
  if (input && input.headers && typeof input.headers.get === "function") return input;
  const headers = new Headers();
  const source = input?.headers || {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const host = headers.get("host") || "localhost";
  const url = typeof input?.url === "string" && input.url.startsWith("http") ? input.url : `https://${host}${input?.url || "/api/keys"}`;
  return new Request(url, { method: input?.method || "GET", headers });
}

function env(name) {
  return globalThis.process?.env?.[name] || "";
}

function mint(hours) {
  const created = new Date();
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = `kt_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  return {
    key,
    prefix: key.slice(0, 7),
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + hours * 60 * 60 * 1000).toISOString(),
  };
}

async function sha(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedIn(appId, appSecret, token) {
  if (!token || token.length > 8000) return false;
  const key = cachedKey || (await verificationKey(appId, appSecret));
  cachedKey = key;
  return verify(token, key, appId);
}

async function verificationKey(appId, appSecret) {
  const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, {
    headers: {
      authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`,
      "privy-app-id": appId,
    },
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

async function seal(record, secret, host, maxAge) {
  const payload = b64(JSON.stringify(record));
  const sig = await mac(secret, payload);
  const name = host.split(":")[0];
  const domain = name === "kazitrustai.fun" || name.endsWith(".kazitrustai.fun") ? "; Domain=.kazitrustai.fun" : "";
  const age = Number.isFinite(maxAge) ? Math.max(1, Math.floor(maxAge)) : 3600;
  return `${COOKIE}=${payload}.${sig}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${age}${domain}`;
}

async function readCookie(cookie, secret) {
  try {
    const pair = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    if (!pair) return null;
    const value = decodeURIComponent(pair.slice(COOKIE.length + 1));
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = value.slice(0, dot);
    if ((await mac(secret, payload)) !== value.slice(dot + 1)) return null;
    const body = JSON.parse(unb64(payload));
    if (!body.hash || !body.prefix || !body.createdAt) return null;
    if (body.expiresAt && !Number.isFinite(Date.parse(body.expiresAt))) return null;
    return body;
  } catch {
    return null;
  }
}

async function mac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return b64(new Uint8Array(sig));
}

function unb64(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function b64(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
