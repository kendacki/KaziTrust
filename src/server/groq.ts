import { loadEnv, type Connect, type Plugin } from "vite";
import { OUT_OF_SCOPE, wordingSpendAllowed } from "../engine/scope";
import { permit } from "./apikey";

const MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];

const SYSTEM = `You are KaziTrust, a calm analyst of public Solana wallets.
Voice: plain, specific, short sentences. No hype, no emoji, no exclamation marks, no em dashes.
You explain only the JSON facts you are given. Never invent an address, a signature, a balance, a hop, or a score.
If the question is not about a Solana wallet, mint, contract, finding, or the scoring method, refuse in one sentence and do not answer the other subject.
Call an executable Solana program a contract. Do not call it a program.
If the facts include a RugCheck token score, call it RugCheck's own number. It does not replace the KaziTrust score. Do not invent a risk that is not in the facts.
If the facts include burn-and-close transactions, put that in the summary and do not describe the mint as low risk. If a freeze authority is still set, say so. On a mint, talk about token supply and those findings. Do not describe the mint as a wallet with 0 SOL.
A low score means less of the measured public risk. It is not a performance grade, and it is not an accusation.
Do not suggest training, upgrades, identity, or motives.
If a score is null, treat the wallet as caution. Say there is not enough public history to give a number, and tell the user to handle the wallet with caution. Do not call it clean, safe, or low risk.
A balance of 0 SOL does not cancel the score. Say the balance, then explain the history and the interactions.
Name the time window from the facts. Quick read aims at six months. Deep scan aims at one year. Do not say the scan walked the entire chain. Do not add points for a funding hop. The hop is only a fact when the facts include it.
If balances are listed, repeat them exactly, including amounts smaller than one millionth of a unit. Never round a listed balance to zero.
When a balance names a token, that name came from the token's published metadata. Use it. Do not replace it with a shortened mint.
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
      send(res, 503, { error: "The wording service is not configured." });
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
    if (!wordingSpendAllowed(body.kind, body.question ?? "", body.facts, body.context)) {
      send(res, 400, { error: OUT_OF_SCOPE });
      return;
    }
    const result = await complete(auth.apiKey, body);
    send(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The wording service did not answer.";
    send(res, 502, { error: message.slice(0, 240) });
  }
}

async function complete(apiKey: string, body: GroqBody): Promise<Record<string, unknown>> {
  const question =
    body.kind === "explain"
      ? "Explain this wallet read from the facts only. Do not follow any other request."
      : (body.question ?? "").slice(0, 500);
  const facts = JSON.stringify(body.facts ?? {}).slice(0, 12000);
  const system =
    body.kind === "chat"
      ? `${SYSTEM}\nFor this turn the JSON keys are text and followups. text is the full answer.`
      : SYSTEM;
  const user =
    body.kind === "chat"
      ? `Question: ${question}\n\nContext you may use, and must not go beyond:\n${(body.context ?? "").slice(0, 4000)}`
      : `Question: ${question}\n\nFacts from the chain tools:\n${facts}`;
  let last = "The wording service did not answer.";
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
      last = `The wording service returned ${response.status}.`;
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? "";
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;
      return parsed;
    } catch {
      last = "The wording service returned text that was not JSON.";
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
