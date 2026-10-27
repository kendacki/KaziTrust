import { getAccessToken } from "@privy-io/react-auth";
import { rpc } from "./rpc";

export type TokenFace = {
  name: string;
  symbol: string;
  image?: string;
};

const META_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P = 2n ** 255n - 19n;

type ChainFace = { name: string; symbol: string; uri: string };

export async function readTokenFaces(mints: string[], signal: AbortSignal): Promise<Map<string, TokenFace>> {
  const unique = [...new Set(mints.filter(Boolean))].slice(0, 12);
  const faces = new Map<string, TokenFace>();
  const pending: { mint: string; uri: string }[] = [];
  for (let index = 0; index < unique.length; index += 4) {
    const batch = unique.slice(index, index + 4);
    await Promise.all(
      batch.map(async (mint) => {
        const chain = await readOnChain(mint, signal);
        if (!chain) return;
        const direct = imageExtension(chain.uri) ? chain.uri : "";
        faces.set(mint, {
          name: chain.name,
          symbol: chain.symbol,
          ...(direct ? { image: direct } : {}),
        });
        if (chain.uri && !direct) pending.push({ mint, uri: chain.uri });
      }),
    );
  }
  if (!pending.length) return faces;
  const extra = await readOffchain(
    pending.map((item) => item.uri),
    signal,
  );
  for (const item of pending) {
    const found = extra.get(item.uri);
    const face = faces.get(item.mint);
    if (!found || !face) continue;
    if (found.image) face.image = found.image;
    if (!face.name && found.name) face.name = found.name;
    if (!face.symbol && found.symbol) face.symbol = found.symbol;
  }
  return faces;
}

async function readOnChain(mint: string, signal: AbortSignal): Promise<ChainFace | null> {
  const pda = await metadataPda(mint);
  if (pda) {
    const data = await accountBytes(pda, signal);
    const parsed = data ? parseMetaplex(data) : null;
    if (parsed && (parsed.name || parsed.symbol)) return parsed;
  }
  const mintData = await accountBytes(mint, signal);
  const extended = mintData ? parseToken2022(mintData) : null;
  if (extended && (extended.name || extended.symbol)) return extended;
  return null;
}

async function accountBytes(address: string, signal: AbortSignal): Promise<Uint8Array | null> {
  try {
    const result = await rpc<{ value: { data?: [string, string] | object } | null }>(
      "getAccountInfo",
      [address, { encoding: "base64", commitment: "confirmed" }],
      signal,
    );
    const data = result.value?.data;
    if (!Array.isArray(data) || typeof data[0] !== "string") return null;
    const binary = atob(data[0]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

function parseMetaplex(bytes: Uint8Array): ChainFace | null {
  if (bytes[0] !== 4 || bytes.length < 1 + 32 + 32 + 4 + 32 + 4 + 10 + 4 + 200) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 1 + 32 + 32;
  const name = padded(view, bytes, cursor, 32);
  if (!name) return null;
  cursor = name.next;
  const symbol = padded(view, bytes, cursor, 10);
  if (!symbol) return null;
  cursor = symbol.next;
  const uri = padded(view, bytes, cursor, 200);
  if (!uri) return null;
  return { name: clip(name.value), symbol: clip(symbol.value), uri: publishedUrl(uri.value) };
}

function parseToken2022(bytes: Uint8Array): ChainFace | null {
  const starts: number[] = [];
  if (bytes.length > 170 && (bytes[165] === 1 || bytes[165] === 2)) starts.push(166);
  if (bytes.length > 86 && (bytes[82] === 1 || bytes[82] === 2)) starts.push(83);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const start of starts) {
    let offset = start;
    while (offset + 4 <= bytes.length) {
      const type = view.getUint16(offset, true);
      const length = view.getUint16(offset + 2, true);
      if (!type || !length || offset + 4 + length > bytes.length) break;
      if (type === 19) {
        const face = borshMeta(view, bytes, offset + 4 + 64, offset + 4 + length);
        if (face) return face;
      }
      offset += 4 + length;
    }
  }
  return null;
}

function borshMeta(view: DataView, bytes: Uint8Array, offset: number, end: number): ChainFace | null {
  const name = borsh(view, bytes, offset, end);
  if (!name) return null;
  const symbol = borsh(view, bytes, name.next, end);
  if (!symbol) return null;
  const uri = borsh(view, bytes, symbol.next, end);
  if (!uri) return null;
  const face = { name: clip(name.value), symbol: clip(symbol.value), uri: publishedUrl(uri.value) };
  if (!face.name && !face.symbol) return null;
  return face;
}

function padded(view: DataView, bytes: Uint8Array, offset: number, max: number): { value: string; next: number } | null {
  if (offset + 4 + max > bytes.length) return null;
  const length = Math.min(view.getUint32(offset, true), max);
  return { value: decodeText(bytes, offset + 4, length), next: offset + 4 + max };
}

function borsh(view: DataView, bytes: Uint8Array, offset: number, end: number): { value: string; next: number } | null {
  if (offset + 4 > end) return null;
  const length = view.getUint32(offset, true);
  if (length > 200 || offset + 4 + length > end) return null;
  return { value: decodeText(bytes, offset + 4, length), next: offset + 4 + length };
}

function decodeText(bytes: Uint8Array, offset: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(offset, offset + length)).replace(/\0/g, "").trim();
}

function clip(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 32) return "";
  return clean;
}

function publishedUrl(value: string): string {
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

function imageExtension(value: string): boolean {
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

type Offchain = { image?: string; name?: string; symbol?: string };

async function readOffchain(uris: string[], signal: AbortSignal): Promise<Map<string, Offchain>> {
  const found = new Map<string, Offchain>();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!import.meta.env.DEV) {
    const token = await getAccessToken();
    if (!token) return found;
    headers.authorization = `Bearer ${token}`;
  }
  for (let index = 0; index < uris.length; index += 8) {
    const slice = uris.slice(index, index + 8);
    try {
      const response = await fetch("/api/token-meta", {
        method: "POST",
        headers,
        body: JSON.stringify({ uris: slice }),
        signal,
      });
      if (!response.ok) continue;
      const body = (await response.json()) as { items?: { uri?: string; image?: string; name?: string; symbol?: string }[] };
      for (const item of body.items ?? []) {
        if (!item?.uri || !slice.includes(item.uri)) continue;
        const image = typeof item.image === "string" && item.image.startsWith("https://") ? item.image : "";
        const name = clip(typeof item.name === "string" ? item.name : "");
        const symbol = clip(typeof item.symbol === "string" ? item.symbol : "");
        if (image || name || symbol) found.set(item.uri, { ...(image ? { image } : {}), ...(name ? { name } : {}), ...(symbol ? { symbol } : {}) });
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return found;
}

async function metadataPda(mint: string): Promise<string> {
  const program = decode58(META_PROGRAM);
  const mintBytes = decode58(mint);
  if (!program || !mintBytes) return "";
  const seeds = [new TextEncoder().encode("metadata"), program, mintBytes];
  const marker = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump -= 1) {
    const hash = await sha256([...seeds, new Uint8Array([bump]), program, marker]);
    if (!onCurve(hash)) return encode58(hash);
  }
  return "";
}

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", merged));
}

function onCurve(bytes: Uint8Array): boolean {
  let y = 0n;
  for (let index = 0; index < 32; index += 1) y += BigInt(bytes[index]) << (8n * BigInt(index));
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return false;
  const d = (modPow(-121665n * modPow(121666n, P - 2n, P), 1n, P) + P) % P;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = ((d * y2) % P + 1n) % P;
  const x2 = (u * modPow(v, P - 2n, P)) % P;
  if (x2 === 0n) return sign === 0n;
  let root = modPow(x2, (P + 3n) / 8n, P);
  if ((root * root) % P !== x2) {
    root = (root * modPow(2n, (P - 1n) / 4n, P)) % P;
    if ((root * root) % P !== x2) return false;
  }
  return true;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let value = ((base % mod) + mod) % mod;
  let power = exp;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % mod;
    value = (value * value) % mod;
    power >>= 1n;
  }
  return result;
}

function decode58(value: string): Uint8Array | null {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return null;
  let zeros = 0;
  while (value[zeros] === "1") zeros += 1;
  let number = 0n;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    number = number * 58n + BigInt(index);
  }
  const body: number[] = [];
  while (number > 0n) {
    body.push(Number(number % 256n));
    number /= 256n;
  }
  body.reverse();
  if (zeros + body.length > 32) return null;
  const out = new Uint8Array(32);
  out.set(body, 32 - body.length);
  return out;
}

function encode58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let out = "";
  while (number > 0n) {
    out = ALPHABET[Number(number % 58n)] + out;
    number /= 58n;
  }
  return "1".repeat(zeros) + out;
}
