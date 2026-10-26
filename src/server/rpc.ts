import { loadEnv, type Connect, type Plugin } from "vite";

const PUBLIC_NODES = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://api.mainnet.solana.com"];

type NodeRequest = {
  method?: string;
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

export function rpcPlugin(): Plugin {
  let nodes = PUBLIC_NODES;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/rpc", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, nodes, next);
    });
  };
  return {
    name: "kazitrust-rpc",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      const flux = env.FLUX_RPC_URL?.trim();
      nodes = flux ? [flux, ...PUBLIC_NODES] : PUBLIC_NODES;
    },
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

async function handle(req: NodeRequest, res: NodeResponse, nodes: string[], next: Connect.NextFunction) {
  if (req.method !== "POST") {
    next();
    return;
  }
  let body = "";
  try {
    body = await readBody(req);
  } catch {
    send(res, 400, "The chain request was not readable.");
    return;
  }
  for (const url of nodes) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      let text = await response.text();
      if (!response.ok) continue;
      const secret = new URL(url).searchParams.get("key");
      if (secret) text = text.split(secret).join("");
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(text.slice(0, 2_000_000));
      return;
    } catch {
      continue;
    }
  }
  send(res, 502, "The public Solana nodes did not answer. Try the read again.");
}

function readBody(req: NodeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > 200_000) {
        reject(new Error("too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(new TextDecoder().decode(merged));
    });
    req.on("error", reject);
  });
}

function send(res: NodeResponse, status: number, message: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message } }));
}
