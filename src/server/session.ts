let cachedKey = "";

export async function signedIn(appId: string, appSecret: string, token: string): Promise<boolean> {
  if (!token || token.length > 8000) return false;
  const key = cachedKey || (await verificationKey(appId, appSecret));
  cachedKey = key;
  return verify(token, key, appId);
}

async function verificationKey(appId: string, appSecret: string): Promise<string> {
  const response = await fetch(`https://auth.privy.io/api/v1/apps/${appId}`, {
    headers: {
      authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`,
      "privy-app-id": appId,
    },
  });
  if (!response.ok) throw new Error("Privy did not accept the app credentials.");
  const body = (await response.json()) as { verification_key?: string };
  if (!body.verification_key?.includes("BEGIN PUBLIC KEY")) throw new Error("Privy did not return a verification key.");
  return body.verification_key;
}

async function verify(token: string, pem: string, appId: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const header = json(parts[0]) as { alg?: string };
  const payload = json(parts[1]) as { iss?: string; aud?: string | string[]; exp?: number; sub?: string };
  if (header.alg !== "ES256") return false;
  if (payload.iss !== "privy.io") return false;
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(appId)) return false;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) return false;
  if (!payload.sub?.startsWith("did:privy:")) return false;
  const key = await crypto.subtle.importKey(
    "spki",
    copyBytes(pemBytes(pem)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, copyBytes(base64Url(parts[2])), data);
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function json(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64Url(part)));
}

function pemBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function base64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
