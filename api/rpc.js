const PUBLIC_NODES = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://api.mainnet.solana.com"];

const METHODS = new Set([
  "getBalance",
  "getAccountInfo",
  "getSignaturesForAddress",
  "getTokenAccountsByOwner",
  "getTransaction",
]);

const FAIL = "The public Solana nodes did not answer. Try the read again.";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const result = await run(req);
    return write(res, result.status, result.body);
  } catch {
    return write(res, 502, envelope(FAIL));
  }
}

async function run(req) {
  if ((req?.method || "GET") !== "POST") return { status: 405, body: envelope("Use POST.") };
  const raw = await bodyOf(req);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 400, body: envelope("The chain request was not readable.") };
  }
  if (!METHODS.has(parsed?.method)) return { status: 400, body: envelope("That chain method is not used by a read.") };
  const flux = (globalThis.process?.env?.FLUX_RPC_URL || "").trim();
  const nodes = flux.startsWith("https://") ? [flux, ...PUBLIC_NODES] : PUBLIC_NODES;
  for (const url of nodes) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: raw,
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) continue;
      let text = await response.text();
      if (!text || text.length > 1_500_000) continue;
      const secret = new URL(url).searchParams.get("key");
      if (secret) text = text.split(secret).join("");
      const body = JSON.parse(text);
      if (body?.error && /rate|limit|429|congested|too many/i.test(String(body.error.message || ""))) continue;
      return { status: 200, body: text };
    } catch {
      continue;
    }
  }
  return { status: 502, body: envelope(FAIL) };
}

function envelope(message) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message } });
}

async function bodyOf(req) {
  if (req && typeof req.text === "function" && req.headers && typeof req.headers.get === "function") {
    const text = await req.text();
    if (text.length > 100_000) throw new Error("too large");
    return text;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.length;
    if (size > 100_000) throw new Error("too large");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function write(res, status, body) {
  if (res && typeof res.end === "function") {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(body);
    return;
  }
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}
