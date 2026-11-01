const KEY_RE = /^kt_[A-Za-z0-9_]+$/;

export function normalizeApiKey(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  const stripped = raw.replace(/^Bearer\s+/i, "").trim();
  return KEY_RE.test(stripped) ? stripped : "";
}

export function keyFromHeaders(getHeader) {
  const auth = normalizeApiKey(getHeader("authorization"));
  if (auth) return auth;
  return (
    normalizeApiKey(getHeader("x-api-key")) ||
    normalizeApiKey(getHeader("x-auth-token")) ||
    normalizeApiKey(getHeader("api-key"))
  );
}

export function keyFromUrl(urlLike) {
  if (!urlLike) return "";
  try {
    const url = typeof urlLike === "string" ? new URL(urlLike, "https://www.kazitrustai.fun") : urlLike;
    const fromQuery =
      normalizeApiKey(url.searchParams.get("key") || "") ||
      normalizeApiKey(url.searchParams.get("api_key") || "") ||
      normalizeApiKey(url.searchParams.get("apiKey") || "");
    if (fromQuery) return fromQuery;

    const parts = url.pathname.split("/").filter(Boolean);
    const mcpIndex = parts.findIndex((part) => part === "mcp");
    if (mcpIndex >= 0) {
      for (let i = mcpIndex + 1; i < parts.length; i += 1) {
        const key = normalizeApiKey(decodeURIComponent(parts[i] || ""));
        if (key) return key;
      }
    }
  } catch {
    return "";
  }
  return "";
}

export function keyFromArgs(args) {
  if (!args || typeof args !== "object") return "";
  return (
    normalizeApiKey(args.api_key) ||
    normalizeApiKey(args.apiKey) ||
    normalizeApiKey(args.key)
  );
}

export function withApiKey(env, key) {
  const next = normalizeApiKey(key);
  if (!next) return env;
  return { ...env, KAZITRUST_API_KEY: next };
}

export function stripKeyArgs(args) {
  if (!args || typeof args !== "object") return {};
  const next = { ...args };
  delete next.api_key;
  delete next.apiKey;
  delete next.key;
  return next;
}

export function keyedMcpUrl(base = "https://www.kazitrustai.fun", key = "kt_your_key") {
  const origin = String(base || "https://www.kazitrustai.fun").replace(/\/$/, "");
  const token = normalizeApiKey(key) || "kt_your_key";
  return `${origin}/mcp/${token}`;
}
