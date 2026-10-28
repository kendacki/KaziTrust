const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

let cachedKey = "";

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  try {
    const result = await run(req);
    return write(res, result.status, result.body);
  } catch {
    return write(res, 502, { error: "RugCheck did not return a token report." });
  }
}

async function run(req) {
  if ((req?.method || "GET") !== "GET") return { status: 405, body: { error: "Use GET." } };
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
  const mint = new URL(request.url).searchParams.get("mint") || "";
  if (!MINT.test(mint)) return { status: 400, body: { error: "That mint cannot be scanned." } };
  const report = await loadReport(mint, env("RUGCHECK_API_KEY"));
  if (!report) return { status: 502, body: { error: "RugCheck did not return a token report." } };
  return { status: 200, body: report };
}

async function loadReport(mint, apiKey) {
  const keyed = await pull(mint, apiKey);
  const body = keyed ?? (apiKey ? await pull(mint, "") : null);
  return body ? trimReport(mint, body) : null;
}

async function pull(mint, apiKey) {
  const headers = { accept: "application/json" };
  if (apiKey) headers["X-API-KEY"] = apiKey;
  const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
    headers,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  return response.json();
}

function trimReport(mint, body) {
  const record = asRecord(body);
  if (!record) return null;
  const reported = asText(record.mint);
  if (reported && reported !== mint) return null;
  const score = asNumber(record.score);
  const scoreNormalised = asNumber(record.score_normalised);
  if (score == null || scoreNormalised == null) return null;
  const token = asRecord(record.token);
  const meta = asRecord(record.tokenMeta);
  const risks = readRisks(record.risks);
  const networks = readNetworks(record.insiderNetworks);
  const lpLockedPct = highestLock(record.markets);
  const insiderAccounts = asNumber(record.graphInsidersDetected);
  const liquidity = asNumber(record.totalMarketLiquidity);
  const holders = asNumber(record.totalHolders);
  const price = asNumber(record.price);
  const name = asText(meta?.name);
  const symbol = asText(meta?.symbol);
  return {
    mint: reported || mint,
    ...(name ? { name } : {}),
    ...(symbol ? { symbol } : {}),
    score,
    scoreNormalised,
    band: bandFor(score),
    mintAuthority: asText(record.mintAuthority) || asText(token?.mintAuthority) || null,
    freezeAuthority: asText(record.freezeAuthority) || asText(token?.freezeAuthority) || null,
    ...(lpLockedPct == null ? {} : { lpLockedPct }),
    ...(insiderAccounts == null ? {} : { insiderAccounts }),
    networks,
    ...(liquidity == null ? {} : { liquidity }),
    ...(holders == null ? {} : { holders }),
    ...(price == null ? {} : { price }),
    risks,
  };
}

function bandFor(score) {
  if (score < 1000) return "Good";
  if (score <= 5000) return "Warning";
  return "Danger";
}

function readRisks(value) {
  if (!Array.isArray(value)) return [];
  const risks = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const level = row.level === "warn" || row.level === "danger" ? row.level : null;
    const name = asText(row.name);
    const description = asText(row.description);
    const score = asNumber(row.score);
    if (!level || !name || !description || score == null) continue;
    risks.push({ name, description, score, level });
  }
  risks.sort((a, b) => b.score - a.score);
  return risks.slice(0, 6);
}

function readNetworks(value) {
  if (!Array.isArray(value)) return [];
  const networks = [];
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const type = row.type === "trade" || row.type === "transfer" ? row.type : null;
    const size = asNumber(row.size);
    if (!type || size == null) continue;
    networks.push({ type, size });
    if (networks.length === 4) break;
  }
  return networks;
}

function highestLock(value) {
  if (!Array.isArray(value)) return undefined;
  let best;
  for (const item of value) {
    const row = asRecord(item);
    const pct = asNumber(row?.lpLockedPct);
    if (pct == null) continue;
    if (best == null || pct > best) best = pct;
  }
  return best;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  const host = "https://kazitrustai.fun";
  const path = typeof input?.url === "string" ? input.url : "/api/rugcheck";
  return new Request(path.startsWith("http") ? path : `${host}${path}`, { method: input?.method || "GET", headers });
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
