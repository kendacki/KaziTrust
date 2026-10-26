import { loadEnv, type Connect, type Plugin } from "vite";
import { permit } from "./apikey";

const ALLOWED = new Set(["account/portfolio", "account/metadata", "account/defi/activities"]);

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

export function solscanPlugin(): Plugin {
  let apiKey = "";
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/solscan", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, { apiKey, appId, appSecret, local }, next);
    });
  };
  return {
    name: "kazitrust-solscan",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      apiKey = env.SOLSCAN_API_KEY ?? "";
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
  const path = url.searchParams.get("path") ?? "";
  const address = url.searchParams.get("address") ?? "";
  if (!ALLOWED.has(path) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    send(res, 400, { error: "That Solscan read is not available." });
    return;
  }
  if (!auth.apiKey) {
    send(res, 503, { error: "Solscan is not configured." });
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
  const target = new URL(`https://pro-api.solscan.io/v2.0/${path}`);
  target.searchParams.set("address", address);
  if (path === "account/portfolio") target.searchParams.set("exclude_low_score_tokens", "true");
  if (path === "account/defi/activities") {
    target.searchParams.set("page", "1");
    target.searchParams.set("page_size", "10");
    target.searchParams.set("sort_by", "block_time");
    target.searchParams.set("sort_order", "desc");
  }
  try {
    const response = await fetch(target, { headers: { token: auth.apiKey } });
    const text = await response.text();
    res.statusCode = response.status;
    res.setHeader("content-type", "application/json");
    res.end(text.slice(0, 200_000));
  } catch {
    send(res, 502, { error: "Solscan did not answer." });
  }
}

function send(res: NodeResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
