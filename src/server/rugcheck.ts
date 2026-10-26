import { loadEnv, type Connect, type Plugin } from "vite";
import { signedIn } from "./session";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type NodeRequest = {
  method?: string;
  url?: string;
  headers?: { authorization?: string | string[] };
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

export type RugcheckRisk = {
  name: string;
  description: string;
  score: number;
  level: "warn" | "danger";
};

export type RugcheckNetwork = {
  type: "trade" | "transfer";
  size: number;
};

export type RugcheckReport = {
  mint: string;
  name?: string;
  symbol?: string;
  score: number;
  scoreNormalised: number;
  band: "Good" | "Warning" | "Danger";
  mintAuthority: string | null;
  freezeAuthority: string | null;
  lpLockedPct?: number;
  insiderAccounts?: number;
  networks: RugcheckNetwork[];
  liquidity?: number;
  holders?: number;
  price?: number;
  risks: RugcheckRisk[];
};

export function rugcheckPlugin(): Plugin {
  let apiKey = "";
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/rugcheck", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, { apiKey, appId, appSecret, local }, next);
    });
  };
  return {
    name: "kazitrust-rugcheck",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      apiKey = env.RUGCHECK_API_KEY ?? "";
      appId = env.PRIVY_APP_ID ?? "";
      appSecret = env.PRIVY_APP_SECRET ?? "";
      local = config.mode === "development";
    },
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

async function handle(
  req: NodeRequest,
  res: NodeResponse,
  auth: { apiKey: string; appId: string; appSecret: string; local: boolean },
  next: Connect.NextFunction,
) {
  if (req.method !== "GET") {
    next();
    return;
  }
  const url = new URL(req.url ?? "", "http://127.0.0.1");
  const mint = url.searchParams.get("mint") ?? "";
  if (!MINT.test(mint)) {
    send(res, 400, { error: "That mint cannot be scanned." });
    return;
  }
  if (!auth.local) {
    if (!auth.appId || !auth.appSecret) {
      send(res, 503, { error: "Sign-in is not configured." });
      return;
    }
    const header = req.headers?.authorization;
    const token = (Array.isArray(header) ? header[0] : header)?.replace(/^Bearer\s+/i, "").trim() ?? "";
    if (!(await signedIn(auth.appId, auth.appSecret, token))) {
      send(res, 401, { error: "Sign in before a query." });
      return;
    }
  }
  try {
    const report = await loadReport(mint, auth.apiKey);
    if (!report) {
      send(res, 502, { error: "RugCheck did not return a token report." });
      return;
    }
    send(res, 200, report);
  } catch {
    send(res, 502, { error: "RugCheck did not return a token report." });
  }
}

async function loadReport(mint: string, apiKey: string): Promise<RugcheckReport | null> {
  const keyed = await pull(mint, apiKey);
  const body = keyed ?? (apiKey ? await pull(mint, "") : null);
  return body ? trimReport(mint, body) : null;
}

async function pull(mint: string, apiKey: string): Promise<unknown | null> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers["X-API-KEY"] = apiKey;
  const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { headers });
  if (!response.ok) return null;
  return response.json();
}

function trimReport(mint: string, body: unknown): RugcheckReport | null {
  const record = asRecord(body);
  if (!record) return null;
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
    mint: asText(record.mint) || mint,
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

function bandFor(score: number): RugcheckReport["band"] {
  if (score < 1000) return "Good";
  if (score <= 5000) return "Warning";
  return "Danger";
}

function readRisks(value: unknown): RugcheckRisk[] {
  if (!Array.isArray(value)) return [];
  const risks: RugcheckRisk[] = [];
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

function readNetworks(value: unknown): RugcheckNetwork[] {
  if (!Array.isArray(value)) return [];
  const networks: RugcheckNetwork[] = [];
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

function highestLock(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  let best: number | undefined;
  for (const item of value) {
    const row = asRecord(item);
    const pct = asNumber(row?.lpLockedPct);
    if (pct == null) continue;
    if (best == null || pct > best) best = pct;
  }
  return best;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function send(res: NodeResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
