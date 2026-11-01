import { apiKeyAllowed, bearer } from "../mcp/keyauth.mjs";
import { track } from "../mcp/analytics.mjs";

const ALLOWED = new Set(["account/portfolio", "account/metadata", "account/defi/activities"]);
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let cachedKey = "";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  const started = Date.now();
  try {
    const result = await run(req);
    await track(
      {
        source: "api",
        name: "solscan",
        ok: result.status < 400,
        ms: Date.now() - started,
        error: result.status >= 400 ? String(result.body?.error || result.status) : undefined,
        meta: { route: "/api/solscan", status: result.status },
      },
      process.env,
    );
    return write(res, result.status, result.body);
  } catch (error) {
    await track(
      {
        source: "api",
        name: "solscan",
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : "Solscan failed",
        meta: { route: "/api/solscan" },
      },
      process.env,
    );
    return write(res, 502, { error: "Solscan did not answer." });
  }
}

async function run(req) {
  if ((req?.method || "GET") !== "GET") return { status: 405, body: { error: "Use GET." } };
  const request = asRequest(req);
  const url = new URL(request.url);
  const path = url.searchParams.get("path") || "";
  const address = url.searchParams.get("address") || "";
  if (!ALLOWED.has(path) || !ADDRESS.test(address)) {
    return { status: 400, body: { error: "That Solscan read is not available." } };
  }

  const appId = env("PRIVY_APP_ID") || env("VITE_PRIVY_APP_ID");
  const secret = env("PRIVY_APP_SECRET");
  const token = bearer(request.headers.get("authorization") || "");
  let allowed = await apiKeyAllowed(token, request.headers, process.env);
  if (!allowed) {
    if (!appId || !secret) return { status: 503, body: { error: "Sign-in is not configured." } };
    try {
      allowed = await signedIn(appId, secret, token);
    } catch {
      return { status: 503, body: { error: "Sign-in is not configured." } };
    }
  }
  if (!allowed) return { status: 401, body: { error: "Sign in before a query." } };

  const apiKey = env("SOLSCAN_API_KEY");
  if (!apiKey) return { status: 503, body: { error: "Solscan is not configured." } };

  const target = new URL(`https://pro-api.solscan.io/v2.0/${path}`);
  target.searchParams.set("address", address);
  if (path === "account/portfolio") target.searchParams.set("exclude_low_score_tokens", "false");
  if (path === "account/defi/activities") {
    target.searchParams.set("page", "1");
    target.searchParams.set("page_size", "10");
    target.searchParams.set("sort_by", "block_time");
    target.searchParams.set("sort_order", "desc");
  }
  const response = await fetch(target, { headers: { token: apiKey }, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: "Solscan returned a non-JSON body." };
  }
  return { status: response.status, body };
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
  const url = typeof input?.url === "string" && input.url.startsWith("http") ? input.url : `https://${host}${input?.url || "/api/solscan"}`;
  return new Request(url, { method: input?.method || "GET", headers });
}

function env(name) {
  return globalThis.process?.env?.[name] || "";
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

function write(res, status, body) {
  if (typeof res?.status === "function" && typeof res?.json === "function") {
    if (typeof body === "string") return res.status(status).send(body);
    return res.status(status).json(body);
  }
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
