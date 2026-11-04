import { dailyReadLimit, issueApiKey, keyQuota, saveRemoteKey } from "../mcp/keyauth.mjs";
import { track } from "../mcp/analytics.mjs";
import { rateLimitAllow, securityHeaders } from "../mcp/security.mjs";

const COOKIE = "kazitrust_key";
const LIFETIMES = [1, 6, 24, 168, 720];
let current = null;
let cachedKey = "";

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const request = asRequest(req);
    const raw = request.method === "POST" ? await nodeBody(req) : "";
    const result = await run(request, raw);
    await track(
      {
        source: "api",
        name: request.method === "POST" ? "api_key_create" : "api_key_view",
        ok: result.status < 400,
        ms: Date.now() - started,
        error: result.status >= 400 ? String(result.body?.error || result.status) : undefined,
        meta: { route: "/api/keys", status: result.status },
      },
      process.env,
    );
    if (res && typeof res.end === "function") {
      writeNode(res, result);
      return;
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json", ...securityHeaders(), ...(result.headers || {}) },
    });
  } catch (error) {
    await track(
      {
        source: "api",
        name: "api_key",
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "key service failed",
        meta: { route: "/api/keys" },
      },
      process.env,
    );
    const body = JSON.stringify({ error: "The key service did not answer." });
    const headers = { "content-type": "application/json", ...securityHeaders() };
    if (res && typeof res.end === "function") {
      res.statusCode = 500;
      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      res.end(body);
      return;
    }
    return new Response(body, { status: 500, headers });
  }
}

async function run(request, raw) {
  const limit = rateLimitAllow(request, "auth");
  if (!limit.ok) {
    return { status: 429, body: { error: "Too many key requests. Try again shortly." }, headers: limit.headers };
  }
  const appId = env("PRIVY_APP_ID") || env("VITE_PRIVY_APP_ID");
  const secret = env("PRIVY_APP_SECRET");
  if (!appId || !secret) return { status: 503, body: { error: "Sign-in is not configured." } };
  const restored = await readCookie(request.headers.get("cookie") || "", secret);
  if (restored) current = restored;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  let session;
  try {
    session = await signedIn(appId, secret, token);
  } catch {
    return { status: 503, body: { error: "Sign-in is not configured." } };
  }
  if (!session?.ok || !session.ownerId) return { status: 401, body: { error: "Sign in before creating a key." } };
  if (request.method === "GET") {
    const view = viewOf(current);
    if (!view) return { status: 200, body: { key: null, quota: null } };
    const quota = current?.hash ? await keyQuota(current.hash, {}, process.env) : null;
    return {
      status: 200,
      body: {
        key: view,
        quota: quota?.ok
          ? { used: quota.used, limit: quota.limit, remaining: quota.remaining }
          : { used: 0, limit: dailyReadLimit(process.env), remaining: dailyReadLimit(process.env) },
      },
    };
  }
  if (request.method !== "POST") return { status: 405, body: { error: "Use GET or POST." } };
  const parsed = readBody(raw);
  const hours = parsed.hours;
  const purpose = parsed.purpose;
  if (!LIFETIMES.includes(hours)) return { status: 400, body: { error: "Choose how long the key stays active." } };
  if (purpose !== "development" && purpose !== "production") {
    return { status: 400, body: { error: "Choose production or development for this key." } };
  }
  // Development keys are short-lived test keys for MCP / local clients.
  if (purpose === "development" && hours > 168) {
    return { status: 400, body: { error: "Development keys can stay active for at most 7 days." } };
  }
  const readLimit = dailyReadLimit(process.env);
  const issued = await issueApiKey(
    { hours, purpose, ownerId: session.ownerId, readLimit },
    process.env,
  );
  current = {
    hash: issued.hash,
    prefix: issued.prefix,
    createdAt: issued.createdAt,
    expiresAt: issued.expiresAt,
    ownerId: session.ownerId,
    readLimit: issued.readLimit,
    purpose: issued.purpose,
  };
  await saveRemoteKey(current, process.env);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const maxAge = Math.max(1, Math.ceil((Date.parse(issued.expiresAt) - Date.now()) / 1000));
  return {
    status: 200,
    body: {
      key: issued.key,
      prefix: issued.prefix,
      createdAt: issued.createdAt,
      expiresAt: issued.expiresAt,
      readLimit: issued.readLimit,
      purpose: issued.purpose,
      ownerBound: true,
      quota: { used: 0, limit: issued.readLimit, remaining: issued.readLimit },
    },
    cookie: await seal(current, secret, host, maxAge),
  };
}

function viewOf(record) {
  if (!record) return null;
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : null;
  const ends = expiresAt ? Date.parse(expiresAt) : NaN;
  const active = !expiresAt || (Number.isFinite(ends) && ends > Date.now());
  return {
    prefix: record.prefix,
    createdAt: record.createdAt,
    expiresAt,
    active,
    readLimit: Number(record.readLimit) || dailyReadLimit(process.env),
    ownerBound: Boolean(record.ownerId),
    purpose: record.purpose === "development" ? "development" : "production",
  };
}

function readBody(raw) {
  if (!raw || raw.length > 400) return { hours: null, purpose: null };
  try {
    const body = JSON.parse(raw);
    return {
      hours: typeof body?.hours === "number" ? body.hours : null,
      purpose: body?.purpose === "development" || body?.purpose === "production" ? body.purpose : null,
    };
  } catch {
    return { hours: null, purpose: null };
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
  const headers = { "content-type": "application/json", ...securityHeaders(), ...(result.headers || {}) };
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
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

async function signedIn(appId, appSecret, token) {
  if (!token || token.length > 8000) return { ok: false };
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
  if (parts.length !== 3) return { ok: false };
  const header = JSON.parse(new TextDecoder().decode(base64Url(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(base64Url(parts[1])));
  if (header.alg !== "ES256" || payload.iss !== "privy.io") return { ok: false };
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(appId)) return { ok: false };
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return { ok: false };
  if (!payload.sub?.startsWith("did:privy:")) return { ok: false };
  const key = await crypto.subtle.importKey("spki", copyBytes(pemBytes(pem)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, copyBytes(base64Url(parts[2])), data);
  if (!ok) return { ok: false };
  return { ok: true, ownerId: String(payload.sub).slice(0, 120) };
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
