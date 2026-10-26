import { inflateRawSync } from "node:zlib";
import { loadEnv, type Connect, type Plugin } from "vite";
import { permit } from "./apikey";

const SDN_ZIP = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN_ADVANCED.ZIP";
const TTL = 6 * 60 * 60 * 1000;

type BlockedEntry = {
  address: string;
  name: string;
  programs: string[];
};

type Cache = {
  fetchedAt: number;
  entries: BlockedEntry[];
};

type NodeRequest = {
  method?: string;
  headers?: { authorization?: string | string[] };
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

let cache: Cache | null = null;

export function restrictionsPlugin(): Plugin {
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/restrictions", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, { appId, appSecret, local }, next);
    });
  };
  return {
    name: "kazitrust-restrictions",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
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
  auth: { appId: string; appSecret: string; local: boolean },
  next: Connect.NextFunction,
) {
  if (req.method !== "GET") {
    next();
    return;
  }
  const gate = await permit(req.headers?.authorization, auth.local, auth.appId, auth.appSecret);
  if (gate === "unconfigured") {
    send(res, 503, { error: "Sign-in is not configured." });
    return;
  }
  if (gate === "denied") {
    send(res, 401, { error: "Sign in before a query." });
    return;
  }
  try {
    const list = await loadList();
    send(res, 200, {
      source: "OFAC SDN list",
      fetchedAt: new Date(list.fetchedAt).toISOString(),
      entries: list.entries,
    });
  } catch {
    send(res, 503, { error: "The OFAC SDN list could not be read." });
  }
}

async function loadList(): Promise<Cache> {
  if (cache && Date.now() - cache.fetchedAt < TTL) return cache;
  try {
    const response = await fetch(SDN_ZIP, { headers: { "user-agent": "KaziTrust wallet screening" } });
    if (!response.ok) throw new Error(String(response.status));
    const entries = parseAdvanced(new Uint8Array(await response.arrayBuffer()));
    if (!entries.length) throw new Error("empty");
    cache = { fetchedAt: Date.now(), entries };
    return cache;
  } catch (error) {
    if (cache) return cache;
    throw error;
  }
}

function parseAdvanced(zip: Uint8Array): BlockedEntry[] {
  const xml = unzip(zip);
  const typeIds = [...solTypeIds(xml)];
  if (!typeIds.length) return [];
  const names = identityNames(xml);
  const feature = new RegExp(`<Feature\\b[^>]*\\bFeatureTypeID="(?:${typeIds.join("|")})"[^>]*>([\\s\\S]*?)</Feature>`, "g");
  const entries: BlockedEntry[] = [];
  const seen = new Set<string>();
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

function solTypeIds(xml: string): Set<string> {
  const ids = new Set<string>();
  for (const match of xml.matchAll(/<FeatureType\b[^>]*\bID="(\d+)"[^>]*>\s*Digital Currency Address - SOL\s*</g)) {
    ids.add(match[1]);
  }
  return ids;
}

function identityNames(xml: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const chunk of xml.split("<Identity ")) {
    const id = chunk.match(/^ID="(\d+)"/)?.[1];
    if (!id || names.has(id)) continue;
    const alias = chunk.split("</Alias>")[0] ?? "";
    const parts = [...alias.matchAll(/<NamePartValue\b[^>]*>([^<]+)<\/NamePartValue>/g)]
      .map((item) => item[1].trim())
      .filter(Boolean);
    if (parts.length) names.set(id, parts.slice(0, 3).join(" "));
  }
  return names;
}

function unzip(zip: Uint8Array): string {
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

function send(res: NodeResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
