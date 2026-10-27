import { inflateRawSync } from "node:zlib";

const SDN_ZIP = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.ZIP";
const TTL = 6 * 60 * 60 * 1000;
const SNAPSHOT_AT = "2026-10-27T05:53:00.000Z";
const SNAPSHOT = [
  { address: "42RLPACwZPx3vYYmxSueqsogfynBDqXK298EDsNoyoHi", name: "Sokolovski Rolan", programs: [] },
  { address: "Fc1EwQUZyTEagaDvA1utHXCcZNyG1x2PLt2DfNu1cJdH", name: "Rashevskyi Dmytro", programs: [] },
  { address: "FuCC7GoYwt5TsNTjWL23Xx9UKCvC18chjMEFPL3vJDCC", name: "Rashevskyi Dmytro", programs: [] },
  { address: "6wjqWWra8ombzaw6VHrG5xpQ972jCYF6bbHiFCbWmr4U", name: "SHPS Shelbit", programs: [] },
];

let cache = null;
let refreshing = false;
let nextTry = 0;
let cachedKey = "";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const result = await run(req);
    return write(res, result.status, result.body);
  } catch {
    return write(res, 503, { error: "The OFAC SDN list could not be read." });
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
  return { status: 200, body: bodyFor(await loadList()) };
}

function bodyFor(list) {
  return {
    source: "OFAC SDN list",
    fetchedAt: new Date(list.fetchedAt).toISOString(),
    entries: list.entries,
  };
}

function snapshot() {
  return { fetchedAt: Date.parse(SNAPSHOT_AT), entries: SNAPSHOT };
}

async function loadList() {
  if (cache?.entries?.length && Date.now() - cache.fetchedAt < TTL) return cache;
  const published = snapshot();
  if (!refreshing && Date.now() > nextTry) {
    refreshing = true;
    nextTry = Date.now() + 15 * 60 * 1000;
    refresh()
      .then((entries) => {
        if (entries.length) cache = { fetchedAt: Date.now(), entries };
      })
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
  }
  return cache?.entries?.length ? cache : published;
}

async function refresh() {
  const response = await fetch(SDN_ZIP, {
    headers: { "user-agent": "KaziTrust wallet screening" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(String(response.status));
  return parseAdvanced(new Uint8Array(await response.arrayBuffer()));
}

function parseAdvanced(zip) {
  const xml = unzip(zip);
  const typeIds = [...solTypeIds(xml)];
  if (!typeIds.length) return [];
  const names = identityNames(xml);
  const feature = new RegExp(`<Feature\\b[^>]*\\bFeatureTypeID="(?:${typeIds.join("|")})"[^>]*>([\\s\\S]*?)</Feature>`, "g");
  const entries = [];
  const seen = new Set();
  for (const match of xml.matchAll(feature)) {
    const body = match[1];
    const address = body.match(/<VersionDetail\b[^>]*>([^<]+)<\/VersionDetail>/)?.[1]?.trim() ?? "";
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) || seen.has(address)) continue;
    const identity = body.match(/IdentityID="(\d+)"/)?.[1] ?? "";
    seen.add(address);
    entries.push({ address, name: names.get(identity) || "SDN entry", programs: [] });
  }
  return entries;
}

function solTypeIds(xml) {
  const ids = new Set();
  for (const match of xml.matchAll(/<FeatureType\b[^>]*\bID="(\d+)"[^>]*>\s*Digital Currency Address - SOL\s*</g)) ids.add(match[1]);
  return ids;
}

function identityNames(xml) {
  const names = new Map();
  for (const chunk of xml.split("<Identity ")) {
    const id = chunk.match(/^ID="(\d+)"/)?.[1];
    if (!id || names.has(id)) continue;
    const alias = chunk.split("</Alias>")[0] ?? "";
    const parts = [...alias.matchAll(/<NamePartValue\b[^>]*>([^<]+)<\/NamePartValue>/g)].map((item) => item[1].trim()).filter(Boolean);
    if (parts.length) names.set(id, parts.slice(0, 3).join(" "));
  }
  return names;
}

function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) throw new Error("bad zip");
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const start = 30 + nameLen + extraLen;
  const data = zip.subarray(start, start + size);
  const xml = method === 8 ? inflateRawSync(data) : data;
  return new TextDecoder().decode(xml);
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
  return new Request("https://kazitrustai.fun/api/restrictions", { method: input?.method || "GET", headers });
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
