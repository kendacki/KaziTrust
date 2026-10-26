import { loadEnv, type Connect, type Plugin } from "vite";
import { signedIn } from "./session";

const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

const SYSTEM = `You are KaziTrust, a calm analyst of public Solana wallets.
Voice: plain, specific, short sentences. No hype, no emoji, no exclamation marks, no em dashes.
You explain only the JSON facts you are given. Never invent an address, a signature, a balance, a hop, or a score.
If the question is not about a Solana wallet, mint, contract, finding, or the scoring method, refuse in one sentence and do not answer the other subject.
Call an executable Solana program a contract. Do not call it a program.
If the facts include a RugCheck token score, call it RugCheck's own number. It does not replace the KaziTrust score. Do not invent a risk that is not in the facts.
A low score means less of the measured public risk. It is not a performance grade, and it is not an accusation.
Do not suggest training, upgrades, identity, or motives.
If a score is null, say there is not enough history to score it.
Return JSON with keys summary, meaning, nextStep, followups.
summary: two sentences a person could read aloud.
meaning: two sentences on what to do with the read.
nextStep: one sentence.
followups: exactly three short questions the user could ask next, with no new addresses.`;

type GroqBody = {
  kind?: "explain" | "chat";
  question?: string;
  facts?: unknown;
  context?: string;
};

type NodeRequest = {
  method?: string;
  headers?: { authorization?: string | string[] };
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

type NodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

export function groqPlugin(): Plugin {
  let apiKey = "";
  let appId = "";
  let appSecret = "";
  let local = false;
  const attach = (middlewares: Connect.Server) => {
    middlewares.use("/api/groq", (req, res, next) => {
      void handle(req as NodeRequest, res as NodeResponse, { apiKey, appId, appSecret, local }, next);
    });
  };
  return {
    name: "kazitrust-groq",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "");
      apiKey = env.GROQ_API_KEY ?? "";
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
  if (req.method !== "POST") {
    next();
    return;
  }
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw) as GroqBody;
    if (!auth.apiKey) {
      send(res, 503, { error: "Groq is not configured." });
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
    const result = await complete(auth.apiKey, body);
    send(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Groq did not answer.";
    send(res, 502, { error: message.slice(0, 240) });
  }
}

async function complete(apiKey: string, body: GroqBody): Promise<Record<string, unknown>> {
  const question = (body.question ?? "").slice(0, 2000);
  const facts = JSON.stringify(body.facts ?? {}).slice(0, 12000);
  const system =
    body.kind === "chat"
      ? `${SYSTEM}\nFor this turn the JSON keys are text and followups. text is the full answer.`
      : SYSTEM;
  const user =
    body.kind === "chat"
      ? `Question: ${question}\n\nContext you may use, and must not go beyond:\n${(body.context ?? "").slice(0, 4000)}`
      : `Question: ${question}\n\nFacts from the chain tools:\n${facts}`;
  let last = "Groq did not answer.";
  for (const model of MODELS) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) {
      last = `Groq returned ${response.status}.`;
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return { ...parsed, model };
    } catch {
      last = "Groq returned text that was not JSON.";
    }
  }
  throw new Error(last);
}

function readBody(req: NodeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.byteLength;
      if (size > 200_000) {
        reject(new Error("The question was too large."));
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

function send(res: NodeResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
