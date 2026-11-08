const METHODS = new Set([
  "getBalance",
  "getAccountInfo",
  "getSignaturesForAddress",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getMinimumBalanceForRentExemption",
  "getRecentPrioritizationFees",
]);

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const ADDRESS_METHODS = new Set([
  "getBalance",
  "getAccountInfo",
  "getSignaturesForAddress",
  "getTokenAccountsByOwner",
]);

/**
 * Validate and rebuild a Solana JSON-RPC request so only allowlisted methods
 * and safe params are forwarded to upstream nodes.
 * @returns {{ ok: true, payload: string, id: string|number } | { ok: false, message: string }}
 */
export function prepareRpcRequest(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "The chain request was not readable." };
  }
  if (!METHODS.has(parsed.method)) {
    return { ok: false, message: "That chain method is not used by a read." };
  }
  if (parsed.params != null && !Array.isArray(parsed.params)) {
    return { ok: false, message: "Chain params must be an array." };
  }
  if (Array.isArray(parsed.params) && parsed.params.length > 8) {
    return { ok: false, message: "That chain request is too large." };
  }
  const params = sanitizeParams(parsed.method, Array.isArray(parsed.params) ? parsed.params : []);
  if (params === null) {
    return { ok: false, message: "That chain request is not valid." };
  }
  const id = typeof parsed.id === "number" || typeof parsed.id === "string" ? parsed.id : 1;
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: parsed.method,
    params,
  });
  if (payload.length > 100_000) {
    return { ok: false, message: "That chain request is too large." };
  }
  return { ok: true, payload, id };
}

/**
 * Rebuild an upstream JSON-RPC response without leaking secrets or extra fields.
 * @param {unknown} body
 * @param {string|number} id
 * @param {string} failMessage
 */
export function prepareRpcResponse(body, id, failMessage) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return JSON.stringify({ jsonrpc: "2.0", id, error: { message: failMessage } });
  }
  const source = /** @type {{ result?: unknown, error?: { message?: unknown } }} */ (body);
  if (source.error) {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { message: String(source.error.message || failMessage).slice(0, 180) },
    });
  }
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: source.result,
  });
}

export function isAllowedRpcMethod(method) {
  return METHODS.has(method);
}

function sanitizeParams(method, params) {
  try {
    const copy = structuredClone(params).slice(0, 8);
    if (ADDRESS_METHODS.has(method)) {
      const address = copy[0];
      if (typeof address !== "string" || !ADDRESS_RE.test(address.trim())) return null;
      copy[0] = address.trim();
    }
    if (method === "getTransaction") {
      const signature = copy[0];
      if (typeof signature !== "string" || !SIG_RE.test(signature.trim())) return null;
      copy[0] = signature.trim();
    }
    if (method === "getSignatureStatuses") {
      const list = copy[0];
      if (!Array.isArray(list) || list.length === 0 || list.length > 24) return null;
      for (const item of list) {
        if (typeof item !== "string" || !SIG_RE.test(item.trim())) return null;
      }
      copy[0] = list.map((item) => item.trim());
    }
    if (method === "getRecentPrioritizationFees") {
      if (copy.length === 0) return [];
      if (copy.length > 1) return null;
      const conf = copy[0];
      if (conf == null) return [];
      if (Array.isArray(conf)) {
        if (conf.length > 16) return null;
        for (const item of conf) {
          if (typeof item !== "string" || !ADDRESS_RE.test(item.trim())) return null;
        }
        return [conf.map((item) => item.trim())];
      }
      if (typeof conf !== "object") return null;
      const locked = conf.lockedWritableAccounts;
      if (locked == null) return [];
      if (!Array.isArray(locked) || locked.length > 16) return null;
      for (const item of locked) {
        if (typeof item !== "string" || !ADDRESS_RE.test(item.trim())) return null;
      }
      return [{ lockedWritableAccounts: locked.map((item) => item.trim()) }];
    }
    if (method === "getMinimumBalanceForRentExemption") {
      const size = copy[0];
      if (typeof size !== "number" || !Number.isFinite(size) || size < 0 || size > 10_000_000) return null;
      copy[0] = Math.floor(size);
    }
    return copy;
  } catch {
    return null;
  }
}
