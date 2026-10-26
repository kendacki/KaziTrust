import { extractAddresses, isSolanaAddress, ungroundedAddresses } from "./address";
import { EXAMPLE_MINT, EXAMPLE_PROGRAM, lookupLabel, mintName, programName, SCORING_VERSION, TOKEN_2022, TOKEN_PROGRAM } from "./labels";
import { consumeRead, readQuota } from "./quota";
import { rpc, RpcError } from "./rpc";
import { narrateReport, narrateText } from "./narrate";
import { modelQuestion, OUT_OF_SCOPE, walletQuestionAllowed } from "./scope";
import { sampleDeployerReport } from "./sample";
import { readRugcheck, type RugcheckReport } from "./rugcheck";
import { readSolscan, type SolscanBook } from "./solscan";
import { readRestrictions, screenAddresses, type RestrictionFacts, type RestrictionIndex } from "./restrictions";
import { bandFromScore, clamp, formatNow, formatNumber, formatSol, formatTime, severityWord, shortAddress } from "../format";
import type { Answer, ApprovalRow, Evidence, Finding, FlowRow, HoldingRow, ProgramSlice, Report, ScoreRule, Severity, TimelineEvent, Visual } from "../types";

type Stepper = (label: string, state: "active" | "done") => void;

type SignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

type AccountValue = {
  lamports: number;
  owner: string;
  executable: boolean;
  data:
    | string
    | {
        program?: string;
        parsed?: { type?: string; info?: Record<string, unknown> };
      };
} | null;

type ContextResult<T> = { context?: { slot?: number }; value: T };

type TokenRow = {
  pubkey: string;
  mint: string;
  amount: number;
  amountText: string;
  delegate?: string;
  frozen: boolean;
};

type Flow = {
  signature: string;
  slot: number;
  time: number | null;
  failed: boolean;
  programs: string[];
  inboundSol: { address: string; lamports: number }[];
  outboundSol: { address: string; lamports: number }[];
  tokenIn: { owner: string; mint: string; amount: number }[];
  tokenOut: { owner: string; mint: string; amount: number }[];
};

type WalletFacts = {
  address: string;
  lamports: number;
  slot: number;
  executable: boolean;
  accountType: string;
  ownerProgram: string;
  mintInfo?: { decimals: number; supply: string; mintAuthority: string | null; freezeAuthority: string | null };
  signatures: SignatureInfo[];
  tokens: TokenRow[];
  tokenWarning?: string;
  flows: Flow[];
  flowWarning?: string;
  historyComplete: boolean;
  scanned: number;
  solscan?: SolscanBook;
  solscanWarning?: string;
  rugcheck?: RugcheckReport;
  rugcheckWarning?: string;
  restrictions?: RestrictionFacts;
  restrictionWarning?: string;
};

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function confidenceWord(value: Report["confidence"]): string {
  if (value === "high") return "Confidence high";
  if (value === "medium") return "Confidence medium";
  return "Confidence low";
}

export async function investigate(options: {
  question: string;
  contextAddresses?: string[];
  mode: "quick" | "deep";
  signal: AbortSignal;
  onStep?: Stepper;
}): Promise<Answer> {
  const question = options.question.trim();
  const onStep = options.onStep ?? (() => undefined);
  if (!question) {
    return { kind: "text", text: "Ask about a wallet, or paste a Solana address.", followups: [] };
  }
  if (/illustrative|sample deployer/i.test(question)) {
    onStep("Preparing the sample read", "active");
    const report = sampleDeployerReport();
    onStep("Preparing the sample read", "done");
    return voiceReport(question, report, ["Read the Jupiter contract", "Read the USDC mint", "How is the score built?"], options.signal, onStep);
  }
  const context = (options.contextAddresses ?? []).filter(isSolanaAddress);
  if (!walletQuestionAllowed(question, context.length > 0)) {
    return { kind: "text", text: OUT_OF_SCOPE, followups: ["Show the illustrative deployer read", "How is the score built?"] };
  }
  if (/how is the score built|scoring method|how do you score/i.test(question) && extractAddresses(question).length === 0) {
    const fallback =
      "Version 0.1 scores only what this browser read. An unlabelled address starts at 22. Thin history, bunched activity, failed transactions, open delegates, and a single counterparty push the number up. A long history and a spread of contracts pull it down. Labelled contracts and mints are held to a fixed low score, because they are not personal wallets. The method page lists every rule. A general chat model can invent a hop. This one cannot: if a signature is not in the tool output, it is dropped before you see it.";
    return voiceText(question, fallback, ["Show the illustrative deployer read", "Read the Jupiter contract"], options.signal, onStep);
  }

  const fromQuestion = extractAddresses(question);
  if (/jupiter/i.test(question) && !fromQuestion.includes(EXAMPLE_PROGRAM)) fromQuestion.push(EXAMPLE_PROGRAM);
  if (/\busdc\b/i.test(question) && !fromQuestion.includes(EXAMPLE_MINT)) fromQuestion.push(EXAMPLE_MINT);
  let addresses = fromQuestion;
  if (/second wallet/i.test(question) && context[1]) addresses = [context[1]];
  else if (/first wallet/i.test(question) && context[0]) addresses = [context[0]];
  else if (addresses.length === 0 && /both|compare/i.test(question) && context.length >= 2) addresses = context.slice(0, 2);
  else if (addresses.length === 0 && context[0]) addresses = [context[0]];

  if (addresses.length === 0) {
    const fallback = "Paste a Solana address to start. A wallet, a token mint, and a contract all work. I will not guess an address from a name.";
    return voiceText(question, fallback, ["Show the illustrative deployer read", "Read the Jupiter contract", "Read the USDC mint"], options.signal, onStep);
  }

  const quota = consumeRead();
  if (!quota.ok) {
    return {
      kind: "text",
      text: `This browser has used its ${quota.limit} live reads for today. The sample deployer read still works, and the counter resets tomorrow.`,
      followups: ["Show the illustrative deployer read", "How is the score built?"],
    };
  }

  const intent = detectIntent(question);
  try {
    if (addresses.length > 2) {
      const reports: Report[] = [];
      for (const [index, address] of addresses.slice(0, 5).entries()) {
        onStep(`Reading address ${index + 1} of ${Math.min(5, addresses.length)}`, "active");
        const facts = await loadFacts(address, "quick", options.signal, onStep, `Address ${index + 1}`);
        reports.push(buildReport(facts, "general"));
        onStep(`Reading address ${index + 1} of ${Math.min(5, addresses.length)}`, "done");
      }
      const report = batchReport(reports);
      assertGrounded(report);
      return voiceReport(question, report, ["How is the score built?"], options.signal, onStep);
    }
    if (intent === "compare" || addresses.length >= 2) {
      const [left, right] = addresses;
      onStep("Reading the first address", "active");
      const a = await loadFacts(left, options.mode, options.signal, onStep, "First");
      onStep("Reading the first address", "done");
      onStep("Reading the second address", "active");
      const b = await loadFacts(right, options.mode, options.signal, onStep, "Second");
      onStep("Reading the second address", "done");
      onStep("Comparing the two reads", "active");
      const report = compareReports(buildReport(a, intent), buildReport(b, intent));
      onStep("Comparing the two reads", "done");
      assertGrounded(report);
      return voiceReport(question, report, followupsFor(report), options.signal, onStep);
    }
    onStep("Checking the address", "active");
    onStep("Checking the address", "done");
    const facts = await loadFacts(addresses[0], options.mode, options.signal, onStep, "");
    onStep("Scoring the public record", "active");
    const report = buildReport(facts, intent);
    if (quota.remaining <= 5) {
      report.warnings.push(`${quota.remaining} live reads left today on this browser.`);
    }
    onStep("Scoring the public record", "done");
    assertGrounded(report);
    return voiceReport(question, report, followupsFor(report), options.signal, onStep);
  } catch (error) {
    if (options.signal.aborted) {
      return { kind: "text", text: "Stopped. Nothing after this point was scored.", followups: [] };
    }
    const message = error instanceof RpcError ? error.message : "The read failed before a score could be made.";
    const remaining = readQuota();
    return {
      kind: "text",
      text: `${message} ${remaining.remaining} live reads are still available today.`,
      followups: ["Show the illustrative deployer read"],
    };
  }
}

async function voiceReport(
  question: string,
  report: Report,
  followups: string[],
  signal: AbortSignal,
  onStep: Stepper,
): Promise<Answer> {
  onStep("Writing the read", "active");
  const narrated = signal.aborted ? null : await narrateReport(modelQuestion(question), report, signal);
  onStep("Writing the read", "done");
  assertGrounded(report);
  if (!report.tools.some((tool) => tool.startsWith("Groq"))) {
    report.warnings.push("The language model did not answer, so this wording comes from the scoring rules.");
  }
  return { kind: "report", report, followups: narrated ?? followups };
}

async function voiceText(
  question: string,
  fallback: string,
  followups: string[],
  signal: AbortSignal,
  onStep: Stepper,
): Promise<Answer> {
  onStep("Writing the read", "active");
  const narrated = signal.aborted ? null : await narrateText(modelQuestion(question), fallback, signal);
  onStep("Writing the read", "done");
  return {
    kind: "text",
    text: narrated?.text ?? fallback,
    followups: narrated && narrated.followups.length > 0 ? narrated.followups : followups,
  };
}

function detectIntent(question: string): "funding" | "approvals" | "cluster" | "holdings" | "programs" | "activity" | "compare" | "general" {
  const q = question.toLowerCase();
  if (/compare|versus|\bvs\b/.test(q)) return "compare";
  if (/approv|delegate|permission|freeze/.test(q)) return "approvals";
  if (/fund|origin|where did|first sol|hop/.test(q)) return "funding";
  if (/cluster|linked|related wallet/.test(q)) return "cluster";
  if (/hold|balance|token/.test(q)) return "holdings";
  if (/program|contract|app does it use|what does it use/.test(q)) return "programs";
  if (/heatmap|when is it active|bot|timezone|hour/.test(q)) return "activity";
  return "general";
}

async function loadFacts(
  address: string,
  mode: "quick" | "deep",
  signal: AbortSignal,
  onStep: Stepper,
  prefix: string,
): Promise<WalletFacts> {
  const tag = prefix ? `${prefix}: ` : "";
  const limit = mode === "deep" ? 80 : 25;
  onStep(`${tag}Reading balance and account type`, "active");
  const [balance, account] = await Promise.all([
    rpc<ContextResult<number>>("getBalance", [address, { commitment: "confirmed" }], signal),
    rpc<ContextResult<AccountValue>>("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }], signal),
  ]);
  onStep(`${tag}Reading balance and account type`, "done");
  onStep(`${tag}Reading recent transactions`, "active");
  const signatures = await rpc<SignatureInfo[]>("getSignaturesForAddress", [address, { limit, commitment: "confirmed" }], signal);
  onStep(`${tag}Reading recent transactions`, "done");

  const value = account.value;
  const parsed = value && typeof value.data === "object" ? value.data.parsed : undefined;
  const accountType = parsed?.type ?? (value?.executable ? "program" : value ? "account" : "empty");
  const mintInfo = accountType === "mint" && parsed?.info ? readMint(parsed.info) : undefined;
  const executable = Boolean(value?.executable) || accountType === "program";
  const isWallet = !executable && accountType !== "mint";

  let tokens: TokenRow[] = [];
  let tokenWarning: string | undefined;
  if (isWallet) {
    onStep(`${tag}Reading token accounts`, "active");
    try {
      tokens = await loadTokens(address, signal);
    } catch (error) {
      tokenWarning = error instanceof RpcError ? error.message : "Token accounts could not be read.";
    }
    onStep(`${tag}Reading token accounts`, "done");
  }

  const parseCount = mode === "deep" ? 10 : 4;
  let flows: Flow[] = [];
  let flowWarning: string | undefined;
  if (signatures.length) {
    onStep(`${tag}Opening transactions for counterparties`, "active");
    try {
      flows = await loadFlows(address, signatures.slice(0, parseCount), signal);
    } catch (error) {
      flowWarning = error instanceof RpcError ? error.message : "Some transactions could not be opened.";
    }
    onStep(`${tag}Opening transactions for counterparties`, "done");
  }

  const scanMint = accountType === "mint";
  onStep(`${tag}Reading the Solscan portfolio and label`, "active");
  onStep(`${tag}Checking the OFAC blocked list`, "active");
  if (scanMint) onStep(`${tag}Reading the RugCheck token report`, "active");
  let solscan: SolscanBook | null = null;
  let solscanWarning = "";
  let rugcheck: RugcheckReport | null = null;
  let restrictionIndex: RestrictionIndex | null = null;
  try {
    const [read, index, tokenReport] = await Promise.all([
      readSolscan(address, signal).catch(() => null),
      readRestrictions(signal),
      scanMint ? readRugcheck(address, signal) : Promise.resolve(null),
    ]);
    solscan = read?.book ?? null;
    solscanWarning = read?.warning ?? "";
    restrictionIndex = index;
    rugcheck = tokenReport;
  } catch {
    solscan = null;
  }
  onStep(`${tag}Reading the Solscan portfolio and label`, "done");
  onStep(`${tag}Checking the OFAC blocked list`, "done");
  if (scanMint) onStep(`${tag}Reading the RugCheck token report`, "done");
  const watched = [address];
  for (const flow of flows) {
    for (const row of [...flow.inboundSol, ...flow.outboundSol]) watched.push(row.address);
  }
  for (const token of tokens) {
    if (token.delegate) watched.push(token.delegate);
  }
  if (solscan?.fundedBy) watched.push(solscan.fundedBy);
  const hits = restrictionIndex ? screenAddresses(restrictionIndex, watched) : [];
  const restrictions: RestrictionFacts | undefined = restrictionIndex
    ? {
        source: restrictionIndex.source,
        fetchedAt: restrictionIndex.fetchedAt,
        self: hits.find((hit) => hit.address === address),
        counterparties: hits.filter((hit) => hit.address !== address),
      }
    : undefined;

  return {
    address,
    lamports: balance.value ?? 0,
    slot: account.context?.slot ?? balance.context?.slot ?? 0,
    executable,
    accountType,
    ownerProgram: value?.owner ?? "",
    mintInfo,
    signatures,
    tokens,
    tokenWarning,
    flows,
    flowWarning,
    historyComplete: signatures.length < limit,
    scanned: signatures.length,
    solscan: solscan ?? undefined,
    solscanWarning: solscanWarning || undefined,
    rugcheck: rugcheck ?? undefined,
    rugcheckWarning: scanMint && !rugcheck ? "RugCheck did not return a token report for this mint." : undefined,
    restrictions,
    restrictionWarning: restrictions ? undefined : "The OFAC SDN list could not be checked, so this read does not claim the address is clear.",
  };
}

function readMint(info: Record<string, unknown>): WalletFacts["mintInfo"] {
  const supply = typeof info.supply === "string" ? info.supply : "0";
  const decimals = typeof info.decimals === "number" ? info.decimals : 0;
  const mintAuthority = typeof info.mintAuthority === "string" ? info.mintAuthority : null;
  const freezeAuthority = typeof info.freezeAuthority === "string" ? info.freezeAuthority : null;
  return { supply, decimals, mintAuthority, freezeAuthority };
}

async function loadTokens(address: string, signal: AbortSignal): Promise<TokenRow[]> {
  const programs = [TOKEN_PROGRAM, TOKEN_2022];
  const batches = await Promise.all(
    programs.map((programId) =>
      rpc<ContextResult<{ pubkey: string; account: { data?: { parsed?: { info?: Record<string, unknown> } } } }[]>>(
        "getTokenAccountsByOwner",
        [address, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
        signal,
      ),
    ),
  );
  const rows: TokenRow[] = [];
  for (const batch of batches) {
    for (const item of batch.value ?? []) {
      const info = item.account?.data?.parsed?.info;
      if (!info) continue;
      const tokenAmount = info.tokenAmount as { uiAmount?: number | null; uiAmountString?: string } | undefined;
      const amount = Number(tokenAmount?.uiAmount ?? 0);
      if (!amount) continue;
      const delegate = typeof info.delegate === "string" ? info.delegate : undefined;
      rows.push({
        pubkey: item.pubkey,
        mint: String(info.mint ?? ""),
        amount,
        amountText: tokenAmount?.uiAmountString ?? formatNumber(amount, 4),
        delegate,
        frozen: info.state === "frozen",
      });
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

async function loadFlows(address: string, signatures: SignatureInfo[], signal: AbortSignal): Promise<Flow[]> {
  const transactions = await Promise.all(
    signatures.map(async (item) => {
      try {
        const tx = await rpc<ParsedTransaction | null>(
          "getTransaction",
          [item.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }],
          signal,
        );
        return { item, tx };
      } catch {
        return { item, tx: null as ParsedTransaction | null };
      }
    }),
  );
  const flows = transactions.filter((entry) => entry.tx).map((entry) => parseFlow(address, entry.item, entry.tx as ParsedTransaction));
  if (!flows.length && signatures.length) throw new RpcError("The transactions could not be opened.");
  return flows;
}

type ParsedTransaction = {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: (string | { pubkey: string })[];
      instructions?: { programId?: string; program?: string }[];
    };
  };
};

type TokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null };
};

function keyAt(tx: ParsedTransaction, index: number): string {
  const key = tx.transaction?.message?.accountKeys?.[index];
  if (!key) return "";
  return typeof key === "string" ? key : key.pubkey;
}

function parseFlow(address: string, item: SignatureInfo, tx: ParsedTransaction): Flow {
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  const inboundSol: Flow["inboundSol"] = [];
  const outboundSol: Flow["outboundSol"] = [];
  let selfIndex = -1;
  for (let i = 0; i < Math.max(pre.length, post.length); i += 1) {
    const pubkey = keyAt(tx, i);
    if (pubkey === address) selfIndex = i;
  }
  if (selfIndex >= 0) {
    const delta = (post[selfIndex] ?? 0) - (pre[selfIndex] ?? 0);
    const others: { address: string; delta: number }[] = [];
    for (let i = 0; i < Math.max(pre.length, post.length); i += 1) {
      if (i === selfIndex) continue;
      const pubkey = keyAt(tx, i);
      if (!pubkey) continue;
      const other = (post[i] ?? 0) - (pre[i] ?? 0);
      if (Math.abs(other) >= 5_000) others.push({ address: pubkey, delta: other });
    }
    if (delta > 5_000) {
      const sources = others.filter((row) => row.delta < 0).sort((a, b) => a.delta - b.delta);
      if (sources[0]) inboundSol.push({ address: sources[0].address, lamports: Math.abs(sources[0].delta) });
    } else if (delta < -5_000) {
      const sinks = others.filter((row) => row.delta > 0).sort((a, b) => b.delta - a.delta);
      if (sinks[0]) outboundSol.push({ address: sinks[0].address, lamports: sinks[0].delta });
    }
  }

  const tokenIn: Flow["tokenIn"] = [];
  const tokenOut: Flow["tokenOut"] = [];
  const before = new Map<string, number>();
  for (const row of tx.meta?.preTokenBalances ?? []) {
    if (row.owner !== address) continue;
    before.set(`${row.owner}:${row.mint}`, Number(row.uiTokenAmount?.uiAmount ?? 0));
  }
  for (const row of tx.meta?.postTokenBalances ?? []) {
    if (row.owner !== address) continue;
    const id = `${row.owner}:${row.mint}`;
    const next = Number(row.uiTokenAmount?.uiAmount ?? 0);
    const prev = before.get(id) ?? 0;
    const change = next - prev;
    if (change > 0) tokenIn.push({ owner: address, mint: row.mint, amount: change });
    if (change < 0) tokenOut.push({ owner: address, mint: row.mint, amount: Math.abs(change) });
  }

  const programs = (tx.transaction?.message?.instructions ?? [])
    .map((instruction) => instruction.programId || "")
    .filter(Boolean);

  return {
    signature: item.signature,
    slot: tx.slot ?? item.slot,
    time: tx.blockTime ?? item.blockTime,
    failed: Boolean(tx.meta?.err ?? item.err),
    programs,
    inboundSol,
    outboundSol,
    tokenIn,
    tokenOut,
  };
}

function buildReport(facts: WalletFacts, intent: ReturnType<typeof detectIntent>): Report {
  const label = lookupLabel(facts.address);
  const times = facts.signatures.map((item) => item.blockTime).filter((time): time is number => typeof time === "number");
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  const warnings = [facts.tokenWarning, facts.flowWarning].filter((item): item is string => Boolean(item));
  const tools = [
    "getBalance",
    "getAccountInfo",
    `getSignaturesForAddress (${facts.scanned})`,
    facts.executable || facts.accountType === "mint" ? "token accounts skipped" : "getTokenAccountsByOwner",
    facts.flows.length ? `getTransaction (${facts.flows.length})` : "getTransaction not needed",
    facts.restrictions ? "OFAC SDN list" : "OFAC SDN list unavailable",
  ];
  if (facts.solscan) tools.push("Solscan portfolio, metadata, and recent DeFi activity");
  if (facts.rugcheck) tools.push("RugCheck token report");
  if (facts.solscanWarning) warnings.push(facts.solscanWarning);
  if (facts.rugcheckWarning) warnings.push(facts.rugcheckWarning);
  if (facts.restrictionWarning) warnings.push(facts.restrictionWarning);

  if (!facts.signatures.length && facts.lamports === 0 && !facts.executable && facts.accountType !== "mint" && !facts.restrictions?.self) {
    return emptyReport(facts, tools);
  }

  const rules: ScoreRule[] = [];
  let score = 22;
  rules.push({ id: "base", points: 22, detail: "Starting point for an unlabelled address" });

  const special = specialScore(facts, label?.category);
  if (special) {
    return finish({
      facts,
      labelName: label?.name,
      score: special.score,
      rules: special.rules,
      findings: special.findings,
      intent,
      warnings,
      tools,
      span,
    });
  }

  if (facts.scanned > 0 && facts.scanned < 5) {
    score += 12;
    rules.push({ id: "thin", points: 12, detail: "Fewer than five signatures in the scan" });
  } else if (facts.scanned >= 20 && span >= 30 * 86400) {
    score -= 8;
    rules.push({ id: "long", points: -8, detail: "At least 20 signatures across 30 days or more" });
  }
  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) {
    score += 26;
    rules.push({ id: "burst", points: 26, detail: "Fifteen or more signatures inside six hours" });
  } else if (facts.scanned >= 15 && span > 0 && span < 2 * 86400) {
    score += 14;
    rules.push({ id: "recent-burst", points: 14, detail: "Fifteen or more signatures inside two days" });
  }

  const failed = facts.flows.filter((flow) => flow.failed).length;
  if (facts.flows.length >= 4 && failed / facts.flows.length >= 0.5) {
    score += 12;
    rules.push({ id: "fail-high", points: 12, detail: "Half or more of the opened transactions failed" });
  } else if (facts.flows.length >= 4 && failed / facts.flows.length >= 0.25) {
    score += 6;
    rules.push({ id: "fail", points: 6, detail: "At least a quarter of the opened transactions failed" });
  }

  const delegates = facts.tokens.filter((token) => token.delegate);
  const frozen = facts.tokens.filter((token) => token.frozen);
  if (delegates.length) {
    score += 14;
    rules.push({ id: "delegate", points: 14, detail: "At least one token account has a delegate" });
  } else if (!facts.tokenWarning && facts.accountType !== "mint" && !facts.executable) {
    score -= 6;
    rules.push({ id: "no-delegate", points: -6, detail: "No delegate on the token accounts that were read" });
  }
  if (frozen.length) {
    score += 10;
    rules.push({ id: "frozen", points: 10, detail: "At least one token account is frozen" });
  }
  if (facts.tokenWarning) {
    score += 4;
    rules.push({ id: "token-gap", points: 4, detail: "Token accounts could not be read" });
  }

  const counterparties = counterpartyCounts(facts);
  if (facts.flows.length >= 3 && counterparties.size === 1) {
    score += 10;
    rules.push({ id: "single", points: 10, detail: "Scanned flows name a single counterparty" });
  }
  const programs = programCounts(facts);
  if (programs.size >= 6) {
    score -= 4;
    rules.push({ id: "spread", points: -4, detail: "Six or more contracts in the opened transactions" });
  }

  const capped = clamp(Math.round(score), 0, 100);
  if (capped !== Math.round(score)) {
    rules.push({ id: "cap", points: capped - Math.round(score), detail: "Score capped between 0 and 100" });
  }

  const findings = walletFindings(facts, delegates, frozen, failed, span, counterparties);
  return finish({
    facts,
    labelName: label?.name,
    score: capped,
    rules,
    findings,
    intent,
    warnings,
    tools,
    span,
  });
}

function specialScore(
  facts: WalletFacts,
  category?: string,
): { score: number; rules: ScoreRule[]; findings: Finding[] } | null {
  if (category === "program" || (facts.executable && lookupLabel(facts.address))) {
    const name = lookupLabel(facts.address)?.name ?? "Known contract";
    return {
      score: 8,
      rules: [{ id: "known-program", points: 8, detail: `${name} is a labelled contract, so the wallet score stays low` }],
      findings: [
        makeFinding(facts, "identity", `${name} is a contract, not a personal wallet.`, "clean", 0.94, `${lookupLabel(facts.address)?.note ?? "The label comes from the public contract list shipped with scoring version 0.1."} The low score means the identity is clear. It is not a safety rating for every trade routed through it.`, facts.signatures.slice(0, 2)),
        activityFinding(facts),
      ],
    };
  }
  if (facts.executable) {
    return {
      score: 18,
      rules: [{ id: "program", points: 18, detail: "Executable contract with no label in the v0 list" }],
      findings: [
        makeFinding(facts, "identity", "This address is an executable contract, and it is not in the v0 label list.", "note", 0.8, "Treat it as a contract until you know who deployed it. The score is held low because it is not a personal wallet, and the missing label keeps confidence from being high.", facts.signatures.slice(0, 2)),
        activityFinding(facts),
      ],
    };
  }
  if (facts.accountType === "mint" && facts.mintInfo) {
    const name = lookupLabel(facts.address)?.name;
    const freeze = facts.mintInfo.freezeAuthority;
    const mintAuth = facts.mintInfo.mintAuthority;
    const findings = [
      makeFinding(
        facts,
        "mint",
        name ? `This is the ${name} mint, not a spending wallet.` : "This is a token mint, not a spending wallet.",
        "note",
        name ? 0.95 : 0.84,
        `Supply is ${facts.mintInfo.supply} base units, with ${facts.mintInfo.decimals} decimals. ${mintAuth ? `Mint authority is ${shortAddress(mintAuth)}.` : "Mint authority is cleared."} ${freeze ? `Freeze authority is ${shortAddress(freeze)}.` : "Freeze authority is cleared."}`,
        [],
        freeze ? [freeze] : [],
      ),
    ];
    if (freeze) {
      findings.push(
        makeFinding(facts, "freeze", `Freeze authority is still set to ${shortAddress(freeze)}.`, "watch", 0.9, "A live freeze authority can freeze holder accounts for this mint. That is a property of the token, read from the mint account.", [], [freeze]),
      );
    } else {
      findings.push(
        makeFinding(facts, "freeze-clear", "Freeze authority is cleared.", "clean", 0.9, "The mint account reports no freeze authority. That check is only about this mint, not about every wallet that holds it.", []),
      );
    }
    return {
      score: name ? 10 : 16,
      rules: [{ id: "mint", points: name ? 10 : 16, detail: name ? `${name} is a labelled mint` : "Unlabelled mint account" }],
      findings,
    };
  }
  return null;
}

function walletFindings(
  facts: WalletFacts,
  delegates: TokenRow[],
  frozen: TokenRow[],
  failed: number,
  span: number,
  counterparties: Map<string, number>,
): Finding[] {
  const findings: Finding[] = [];
  const newest = facts.signatures[0];
  const oldest = facts.signatures[facts.signatures.length - 1];
  if (facts.historyComplete && oldest?.blockTime) {
    findings.push(
      makeFinding(facts, "history", `The full scanned history starts ${formatTime(oldest.blockTime)}.`, facts.scanned < 5 ? "watch" : "note", facts.scanned < 5 ? 0.7 : 0.86, `The scan asked for more signatures than this address has, so the oldest transaction in the response is the start of its visible history. ${facts.scanned} signature${facts.scanned === 1 ? "" : "s"} came back. Balance is ${formatSol(facts.lamports)}.`, oldest ? [oldest] : []),
    );
  } else if (newest) {
    findings.push(
      makeFinding(facts, "history", `The scan covers the latest ${facts.scanned} signatures, not the full history.`, "note", 0.64, `${newest.blockTime ? `The newest is ${formatTime(newest.blockTime)}.` : ""} ${oldest?.blockTime ? `The oldest in this window is ${formatTime(oldest.blockTime)}.` : ""} Balance is ${formatSol(facts.lamports)}. A deeper scan widens the window. It still may not reach the first funding transaction.`, [newest, oldest].filter((item): item is SignatureInfo => Boolean(item))),
    );
  }

  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) {
    findings.push(
      makeFinding(facts, "burst", "Activity is bunched into less than six hours.", "elevated", 0.8, "A tight burst is common for a script, a bot, or a one-off operational run. It is a pattern, not proof of intent.", facts.signatures.slice(0, 3)),
    );
  }

  if (delegates.length) {
    const first = delegates[0];
    findings.push(
      makeFinding(facts, "delegate", `${delegates.length} token account${delegates.length === 1 ? "" : "s"} ha${delegates.length === 1 ? "s" : "ve"} a delegate set.`, "watch", 0.88, `The first is ${mintName(first.mint)} delegated to ${shortAddress(first.delegate ?? "")}. A delegate can move that token account up to the approved amount. KaziTrust does not build a revoke transaction.`, [], [first.delegate ?? "", first.mint, first.pubkey]),
    );
  } else if (!facts.tokenWarning) {
    findings.push(
      makeFinding(facts, "delegate-clear", "No open delegate on the token accounts that were read.", "clean", facts.tokens.length ? 0.82 : 0.58, facts.tokens.length ? `${facts.tokens.length} token account${facts.tokens.length === 1 ? "" : "s"} with a balance had no delegate field.` : "This address had no token account with a balance, so there was no delegate to find.", []),
    );
  }

  if (frozen.length) {
    findings.push(
      makeFinding(facts, "frozen", `${frozen.length} token account${frozen.length === 1 ? " is" : "s are"} frozen, so that balance is restricted.`, "watch", 0.9, `Frozen: ${frozen.slice(0, 3).map((row) => mintName(row.mint)).join(", ")}. The freeze comes from the mint authority, not from this read.`, [], frozen.slice(0, 3).map((row) => row.mint)),
    );
  }

  if (facts.flows.length >= 4 && failed > 0) {
    findings.push(
      makeFinding(facts, "failed", `${failed} of ${facts.flows.length} opened transactions failed.`, failed / facts.flows.length >= 0.5 ? "elevated" : "watch", 0.77, "Failures are counted only in the transactions this read opened, not across the whole history.", facts.flows.filter((flow) => flow.failed).slice(0, 3).map((flow) => ({ signature: flow.signature, slot: flow.slot, err: true, blockTime: flow.time }))),
    );
  }

  if (counterparties.size === 1 && facts.flows.length >= 3) {
    const only = [...counterparties.keys()][0];
    findings.push(
      makeFinding(facts, "single", `Scanned flows point at one counterparty, ${shortAddress(only)}.`, "watch", 0.6, "This is estimated from balance changes in the opened transactions. A token counterparty is often a token account or a pool, not a person.", facts.flows.slice(0, 2).map((flow) => ({ signature: flow.signature, slot: flow.slot, err: null, blockTime: flow.time })), [only]),
    );
  }

  if (!lookupLabel(facts.address) && !facts.solscan?.label) {
    findings.push(
      makeFinding(facts, "label", "No public label in the v0 list.", "note", 0.9, "The v0 list covers a short set of contracts and major mints. Absence is not a risk finding. It means this address is not one of those.", []),
    );
  }

  return findings.slice(0, 5);
}

function activityFinding(facts: WalletFacts): Finding {
  return makeFinding(
    facts,
    "activity",
    facts.scanned ? `${facts.scanned} recent signatures were read.` : "No recent signatures came back.",
    "note",
    0.8,
    facts.historyComplete ? "Fewer signatures came back than the scan requested, so this is the visible history." : "The window is the most recent signatures, capped by the scan mode.",
    facts.signatures.slice(0, 2),
  );
}

function makeFinding(
  facts: WalletFacts,
  id: string,
  title: string,
  severity: Severity,
  confidence: number,
  explanation: string,
  signatures: { signature: string; slot: number; blockTime: number | null }[] = [],
  extraAddresses: string[] = [],
): Finding {
  const evidence: Evidence[] = signatures.slice(0, 3).map((item) => ({
    kind: "transaction",
    signature: item.signature,
    slot: item.slot,
    time: item.blockTime ? formatTime(item.blockTime) : undefined,
    label: shortAddress(item.signature),
  }));
  if (!evidence.length) {
    evidence.push({
      kind: "read",
      slot: facts.slot,
      label: `Account read at slot ${facts.slot || "unknown"}`,
    });
  }
  void extraAddresses;
  return {
    id,
    title,
    severity,
    severityWord: severityWord(severity),
    confidence,
    explanation,
    evidence,
  };
}

function emptyReport(facts: WalletFacts, tools: string[]): Report {
  return {
    kind: "wallet",
    wallet: facts.address,
    displayAddress: shortAddress(facts.address),
    typeGuess: "Empty address",
    riskScore: null,
    band: null,
    confidence: "low",
    confidenceLabel: "Confidence low",
    scoringVersion: SCORING_VERSION,
    dataAsOf: `Slot ${facts.slot || "unknown"}, read ${formatNow()}`,
    summary: "There is no balance and no transaction history on this address. A score would pretend to know more than the chain showed, so none is given.",
    meaning: "An unused address is not a clean bill of health. It is an address with nothing to measure yet.",
    nextStep: "Check the wallet that funded it, once it has a first transaction.",
    findings: leadFindings(facts, [
      makeFinding(facts, "empty", "No balance and no signatures.", "note", 0.95, "getBalance returned 0 lamports and getSignaturesForAddress returned an empty list.", []),
    ]),
    visuals: [],
    rules: [],
    tools,
    txCount: 0,
    warnings: [facts.solscanWarning, facts.restrictionWarning, "Not enough history for a score."].filter((item): item is string => Boolean(item)),
    illustrative: false,
    watchAddress: facts.address,
    cited: citedFrom(facts),
  };
}

function finish(input: {
  facts: WalletFacts;
  labelName?: string;
  score: number;
  rules: ScoreRule[];
  findings: Finding[];
  intent: ReturnType<typeof detectIntent>;
  warnings: string[];
  tools: string[];
  span: number;
}): Report {
  const { facts } = input;
  const applied = applyRestrictions(facts, input.score, input.rules);
  const findings = leadFindings(facts, input.findings);
  const band = bandFromScore(applied.score);
  const confidence = confidenceFor(facts, input.warnings.length > 0);
  const typeGuess = guessType(facts, input.labelName, input.span);
  const summary = `${typeGuess}. Score ${applied.score}, ${band}. ${findings[0]?.title ?? "The read completed."} ${confidenceWord(confidence)}.`;
  const meaning = meaningFrom(findings, band, facts);
  const visuals = pickVisuals(facts, input.intent);
  return {
    kind: "wallet",
    wallet: facts.address,
    displayAddress: shortAddress(facts.address),
    typeGuess,
    riskScore: applied.score,
    band,
    confidence,
    confidenceLabel: confidenceWord(confidence),
    scoringVersion: SCORING_VERSION,
    dataAsOf: `Slot ${facts.slot || "unknown"}, read ${formatNow()}`,
    summary,
    meaning,
    nextStep: nextStep(facts, input.intent),
    findings,
    visuals,
    rules: applied.rules,
    tools: input.tools,
    txCount: facts.scanned,
    warnings: input.warnings,
    illustrative: false,
    watchAddress: facts.address,
    cited: citedFrom(facts),
  };
}

function citedFrom(facts: WalletFacts): string[] {
  const cited = new Set<string>([facts.address]);
  if (facts.ownerProgram) cited.add(facts.ownerProgram);
  if (facts.mintInfo?.mintAuthority) cited.add(facts.mintInfo.mintAuthority);
  if (facts.mintInfo?.freezeAuthority) cited.add(facts.mintInfo.freezeAuthority);
  for (const token of facts.tokens) {
    cited.add(token.mint);
    cited.add(token.pubkey);
    if (token.delegate) cited.add(token.delegate);
  }
  for (const flow of facts.flows) {
    for (const row of [...flow.inboundSol, ...flow.outboundSol]) cited.add(row.address);
    for (const row of [...flow.tokenIn, ...flow.tokenOut]) cited.add(row.mint);
    for (const program of flow.programs) cited.add(program);
    cited.add(flow.signature);
  }
  for (const item of facts.signatures) cited.add(item.signature);
  if (facts.restrictions?.self) cited.add(facts.restrictions.self.address);
  for (const hit of facts.restrictions?.counterparties ?? []) cited.add(hit.address);
  if (facts.rugcheck?.mintAuthority) cited.add(facts.rugcheck.mintAuthority);
  if (facts.rugcheck?.freezeAuthority) cited.add(facts.rugcheck.freezeAuthority);
  if (facts.solscan?.fundedBy) cited.add(facts.solscan.fundedBy);
  for (const token of facts.solscan?.tokens ?? []) {
    if (token.address) cited.add(token.address);
  }
  return [...cited];
}

function leadFindings(facts: WalletFacts, findings: Finding[]): Finding[] {
  const lead = [restrictionFinding(facts), rugcheckFinding(facts), solscanFinding(facts)].filter((item): item is Finding => Boolean(item));
  return [...lead, ...findings].slice(0, 6);
}

function applyRestrictions(facts: WalletFacts, score: number, rules: ScoreRule[]): { score: number; rules: ScoreRule[] } {
  const screen = facts.restrictions;
  if (!screen) return { score, rules };
  if (screen.self) {
    const name = screen.self.name || "an SDN entry";
    return {
      score: 96,
      rules: [{ id: "blocked", points: 96, detail: `${name} is on the OFAC SDN list, so the score is set to 96` }],
    };
  }
  if (screen.counterparties.length) {
    const next = clamp(score + 30, 0, 100);
    return {
      score: next,
      rules: [...rules, { id: "blocked-counterparty", points: next - score, detail: "An opened flow or a delegate names an OFAC SDN address" }],
    };
  }
  return { score, rules };
}

function restrictionFinding(facts: WalletFacts): Finding | null {
  const screen = facts.restrictions;
  if (!screen) return null;
  if (screen.self) {
    const programs = screen.self.programs.length ? ` Sanctions codes: ${screen.self.programs.join(", ")}.` : "";
    return makeFinding(
      facts,
      "blocked",
      `${screen.self.name} is on the OFAC SDN blocked list.`,
      "high",
      0.98,
      `OFAC publishes this Solana address on the Specially Designated Nationals list.${programs} A blocked listing is a public sanctions fact. It is not inferred from transaction patterns.`,
      [],
      [screen.self.address],
    );
  }
  const other = screen.counterparties[0];
  if (other) {
    return makeFinding(
      facts,
      "blocked-counterparty",
      `A scanned flow names ${other.name}, which is on the OFAC SDN blocked list.`,
      "high",
      0.9,
      "The wallet itself is not on the list. The match comes from an opened transaction, a token delegate, or the Solscan funding address. Addresses outside this window are not covered.",
      [],
      [other.address],
    );
  }
  const frozen = facts.tokens.some((token) => token.frozen);
  if (frozen) return null;
  return makeFinding(
    facts,
    "blocked-clear",
    "This address is not on the OFAC SDN blocked list.",
    "clean",
    0.9,
    "The check is an exact match against the Solana addresses in the current SDN file. It does not cover every sanctions list, and it does not read a private blacklist.",
  );
}

function rugcheckFinding(facts: WalletFacts): Finding | null {
  const report = facts.rugcheck;
  if (!report) return null;
  const named = report.name ? `RugCheck names it ${report.name}${report.symbol ? ` (${report.symbol})` : ""}.` : "";
  const top = report.risks[0];
  const riskLine = top ? `${top.name}: ${top.description}` : "RugCheck did not list a separate risk on this report.";
  const liquidity = typeof report.liquidity === "number" ? ` Pool liquidity is about $${formatNumber(report.liquidity, report.liquidity >= 1000 ? 0 : 2)} USDC.` : "";
  const lock = typeof report.lpLockedPct === "number" ? ` The highest listed pool lock is ${formatNumber(report.lpLockedPct, 1)}%.` : "";
  const insiders = typeof report.insiderAccounts === "number" ? ` RugCheck counts ${formatNumber(report.insiderAccounts, 0)} insider accounts.` : "";
  const band = report.band === "Good" ? "its good band" : report.band === "Warning" ? "its warning band" : "its danger band";
  const severity: Severity = report.band === "Good" ? "clean" : report.band === "Warning" ? "watch" : "elevated";
  return makeFinding(
    facts,
    "rugcheck",
    `RugCheck's normalised score is ${Math.round(report.scoreNormalised)}, in ${band}.`,
    severity,
    0.9,
    `${named} ${riskLine} This is RugCheck's token score. It does not change the KaziTrust score.${liquidity}${lock}${insiders}`.replace(/\s+/g, " ").trim(),
    [],
    [report.mintAuthority, report.freezeAuthority].filter((item): item is string => Boolean(item)),
  );
}

function solscanFinding(facts: WalletFacts): Finding | null {
  const book = facts.solscan;
  if (!book) return null;
  const parts: string[] = [];
  if (book.label) parts.push(`Solscan labels this address as ${book.label}.`);
  else if (book.domain) parts.push(`Solscan names the domain ${book.domain}.`);
  if (book.tags.length) parts.push(`Tags: ${book.tags.join(", ")}.`);
  if (typeof book.totalValue === "number") parts.push(`The priced portfolio is about $${formatNumber(book.totalValue, book.totalValue >= 1000 ? 0 : 2)}.`);
  if (book.tokens[0]) parts.push(`The largest named holding is ${book.tokens[0].symbol}.`);
  if (book.positions) parts.push(`${book.positions} liquidity position${book.positions === 1 ? "" : "s"} ${book.positions === 1 ? "is" : "are"} open.`);
  if (typeof book.activeAge === "number") parts.push(`Solscan counts ${book.activeAge} days since first funding.`);
  const latest = book.activities[0];
  if (latest) parts.push(`The latest indexed DeFi activity is a ${latest.type}.`);
  if (!parts.length) return null;
  return makeFinding(facts, "solscan", parts[0], "note", 0.84, parts.join(" "), [], [book.fundedBy ?? "", ...book.tokens.map((token) => token.address)].filter(Boolean));
}

function confidenceFor(facts: WalletFacts, degraded: boolean): Report["confidence"] {
  if (facts.restrictions?.self) return "high";
  if (degraded || facts.scanned < 8) return "low";
  const times = facts.signatures.map((item) => item.blockTime).filter((time): time is number => typeof time === "number");
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  if ((facts.historyComplete || facts.scanned >= 40) && span > 7 * 86400 && facts.flows.length >= 4) return "high";
  if (facts.executable && lookupLabel(facts.address)) return "high";
  return "medium";
}

function guessType(facts: WalletFacts, labelName: string | undefined, span: number): string {
  if (facts.restrictions?.self) return "Blocked address";
  if (labelName && facts.executable) return labelName;
  if (facts.executable) return "On-chain contract";
  if (facts.accountType === "mint") return labelName ? `${labelName} mint` : "Token mint";
  if (labelName) return labelName;
  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) return "High-frequency address";
  if (facts.tokens.length >= 8) return "Active holder";
  if (facts.scanned < 5) return "New or quiet wallet";
  return "Active wallet";
}

function meaningFrom(findings: Finding[], band: Report["band"], facts: WalletFacts): string {
  const lead = findings[0]?.explanation ?? "";
  const second = findings[1]?.title ?? "";
  if (!facts.signatures.length) return lead;
  return `The band is ${band}. ${lead} ${second ? `Alongside that: ${second}` : ""}`.trim();
}

function nextStep(facts: WalletFacts, intent: ReturnType<typeof detectIntent>): string {
  if (facts.restrictions?.self) return "Treat the OFAC listing as the fact to act on. The behaviour score does not override it.";
  if (facts.rugcheck && facts.rugcheck.band !== "Good") return "Read the RugCheck risks before treating this mint as safe. That score is separate from the KaziTrust number.";
  if (facts.restrictions?.counterparties.length) return "Open the matched address on its own before treating this wallet as unrelated to the listing.";
  if (!facts.historyComplete && intent !== "funding") return "Run a deep scan if you need a wider window than the latest signatures.";
  if (facts.tokens.some((token) => token.delegate)) return "Open the approvals panel and match each delegate to a contract you recognise.";
  if (intent === "funding" && !facts.historyComplete) return "This window may not include the first funding transaction. A full index is required to walk further back than the scan.";
  return "Ask a follow-up about funding, approvals, or the contracts it uses.";
}

function pickVisuals(facts: WalletFacts, intent: ReturnType<typeof detectIntent>): Visual[] {
  const restrictions = restrictionVisual(facts);
  const rugcheck = rugcheckVisual(facts);
  const funding = fundingVisual(facts);
  const cluster = clusterVisual(facts);
  const heatmap = heatmapVisual(facts);
  const timeline = timelineVisual(facts);
  const holdings = holdingsVisual(facts);
  const counterparties = counterpartyVisual(facts);
  const approvals = approvalsVisual(facts);
  const programs = programVisual(facts);
  const ordered =
    intent === "funding"
      ? [funding, counterparties, timeline]
      : intent === "approvals"
        ? [approvals, holdings, timeline]
        : intent === "cluster"
          ? [cluster, counterparties, funding]
          : intent === "holdings"
            ? [holdings, programs, timeline]
            : intent === "programs"
              ? [programs, counterparties, timeline]
              : intent === "activity"
                ? [heatmap, timeline, programs]
                : [heatmap ?? timeline, holdings ?? programs, counterparties ?? funding];
  return [rugcheck, restrictions, ...ordered].filter((item): item is Visual => Boolean(item)).slice(0, 3);
}

function rugcheckVisual(facts: WalletFacts): Visual | null {
  const report = facts.rugcheck;
  if (!report) return null;
  const rows: { label: string; state: string; detail: string }[] = [
    {
      label: "RugCheck score",
      state: report.band,
      detail: `Normalised ${Math.round(report.scoreNormalised)} of 100. Raw score ${formatNumber(report.score, 0)}. Lower is safer on this scale.`,
    },
  ];
  if (report.mintAuthority) rows.push({ label: "Mint authority", state: "Set", detail: shortAddress(report.mintAuthority) });
  else rows.push({ label: "Mint authority", state: "Cleared", detail: "RugCheck reports no mint authority." });
  if (report.freezeAuthority) rows.push({ label: "Freeze authority", state: "Set", detail: shortAddress(report.freezeAuthority) });
  else rows.push({ label: "Freeze authority", state: "Cleared", detail: "RugCheck reports no freeze authority." });
  if (typeof report.lpLockedPct === "number") {
    rows.push({ label: "Pool lock", state: `${formatNumber(report.lpLockedPct, 1)}%`, detail: "Highest LP lock RugCheck lists for a pool of this mint." });
  }
  if (typeof report.insiderAccounts === "number") {
    const kinds = report.networks.map((network) => (network.type === "trade" ? "wash trading" : "fake holders")).join(", ");
    rows.push({
      label: "Insider networks",
      state: report.insiderAccounts > 0 ? "Detected" : "None",
      detail: report.insiderAccounts > 0 ? `${formatNumber(report.insiderAccounts, 0)} accounts${kinds ? `, including ${kinds}` : ""}.` : "RugCheck reports no insider accounts on this mint.",
    });
  }
  for (const risk of report.risks.slice(0, 3)) {
    rows.push({
      label: risk.name,
      state: risk.level === "danger" ? "Danger" : "Warning",
      detail: risk.description,
    });
  }
  return {
    type: "rugcheck",
    caption: "RugCheck publishes this token score from its own report. Good is a raw score under 1,000. Warning is 1,000 to 5,000. Danger is above 5,000. It does not change the KaziTrust score.",
    rows,
  };
}

function restrictionVisual(facts: WalletFacts): Visual {
  const screen = facts.restrictions;
  const frozen = facts.tokens.filter((token) => token.frozen);
  const blocked = screen?.self;
  const other = screen?.counterparties[0];
  return {
    type: "restrictions",
    caption: "Blocked means the address is on the current OFAC SDN list. Restricted means a token account is frozen on chain. A clear row means that check found nothing.",
    rows: [
      {
        label: "OFAC SDN list",
        state: screen ? (blocked ? "Blocked" : "Clear") : "Not checked",
        detail: blocked ? blocked.name : screen ? "No exact Solana match in the current file." : "The list could not be read.",
      },
      {
        label: "Opened activity",
        state: screen ? (other ? "Blocked" : "Clear") : "Not checked",
        detail: other ? `${other.name} appears in the scanned flows, a delegate, or the funding address.` : "No listed counterparty in the opened window.",
      },
      {
        label: "Token accounts",
        state: facts.tokenWarning ? "Not read" : frozen.length ? "Restricted" : "Clear",
        detail: frozen.length ? `${frozen.length} frozen token account${frozen.length === 1 ? "" : "s"}.` : facts.tokenWarning ? "Token accounts could not be read." : "No frozen token account in this read.",
      },
    ],
  };
}

function fundingVisual(facts: WalletFacts): Visual | null {
  if (!facts.signatures.length) return null;
  const oldestSig = facts.signatures[facts.signatures.length - 1];
  const oldestFlow = facts.flows.find((flow) => flow.signature === oldestSig.signature) ?? facts.flows[facts.flows.length - 1];
  const solSource = oldestFlow?.inboundSol[0];
  const tokenSource = oldestFlow?.tokenIn[0];
  const sourceLabel = solSource
    ? lookupLabel(solSource.address)?.name ?? shortAddress(solSource.address)
    : tokenSource
      ? mintName(tokenSource.mint)
      : "No counterparty";
  const head = facts.historyComplete ? "First transaction" : "Oldest in scan";
  return {
    type: "funding",
    caption: facts.historyComplete
      ? "The signature list was shorter than the request, so this is the start of the visible history. One hop only."
      : "This is the oldest transaction inside the scanned window, not proof of the wallet's first funding.",
    hops: [
      { label: sourceLabel, detail: solSource || tokenSource ? "Inbound change" : "Not in this transaction" },
      { label: head, detail: oldestSig.blockTime ? formatTime(oldestSig.blockTime) : `Slot ${oldestSig.slot}` },
      { label: shortAddress(facts.address), detail: lookupLabel(facts.address)?.name ?? "Address under review" },
    ],
  };
}

function clusterVisual(facts: WalletFacts): Visual | null {
  const counts = counterpartyCounts(facts);
  if (!counts.size) return null;
  const nodes = [{ id: facts.address, label: shortAddress(facts.address), volume: facts.flows.length }];
  const edges: { a: string; b: string; volume: number }[] = [];
  for (const [address, volume] of [...counts.entries()].slice(0, 6)) {
    nodes.push({ id: address, label: lookupLabel(address)?.name ?? shortAddress(address), volume });
    edges.push({ a: facts.address, b: address, volume });
  }
  return {
    type: "cluster",
    caption: "Accounts that moved against this address in the opened transactions. This is not a claim that one person controls them.",
    center: facts.address,
    nodes,
    edges,
  };
}

function heatmapVisual(facts: WalletFacts): Visual | null {
  const cells = Array.from({ length: 7 * 24 }, () => 0);
  for (const item of facts.signatures) {
    if (!item.blockTime) continue;
    const date = new Date(item.blockTime * 1000);
    cells[date.getDay() * 24 + date.getHours()] += 1;
  }
  const peak = Math.max(...cells);
  if (!peak) return null;
  const index = cells.indexOf(peak);
  return {
    type: "heatmap",
    caption: "Count of scanned signatures by local weekday and hour. A bright column can mean a script, or simply a person in that timezone.",
    cells,
    peak: `${DAY[Math.floor(index / 24)]} ${String(index % 24).padStart(2, "0")}:00`,
  };
}

function timelineVisual(facts: WalletFacts): Visual | null {
  if (!facts.signatures.length) return null;
  const events: TimelineEvent[] = [];
  const oldest = facts.signatures[facts.signatures.length - 1];
  const newest = facts.signatures[0];
  if (oldest.blockTime) {
    events.push({
      time: formatTime(oldest.blockTime),
      title: facts.historyComplete ? "First observed transaction" : "Oldest in this scan",
      detail: shortAddress(oldest.signature),
    });
  }
  const failed = facts.flows.find((flow) => flow.failed);
  if (failed?.time) events.push({ time: formatTime(failed.time), title: "Failed transaction", detail: shortAddress(failed.signature) });
  const inbound = facts.flows.find((flow) => flow.inboundSol[0] || flow.tokenIn[0]);
  if (inbound?.time) events.push({ time: formatTime(inbound.time), title: "Inbound movement", detail: shortAddress(inbound.signature) });
  if (newest.blockTime && newest.signature !== oldest.signature) {
    events.push({ time: formatTime(newest.blockTime), title: "Latest transaction", detail: shortAddress(newest.signature) });
  }
  if (!events.length) return null;
  return { type: "timeline", caption: "Events taken from the scanned signatures and the opened transactions.", events };
}

function holdingsVisual(facts: WalletFacts): Visual | null {
  const priced = facts.solscan;
  if (priced && (priced.tokens.length || priced.sol)) {
    const rows: HoldingRow[] = [];
    const pool = [...(priced.sol ? [priced.sol] : []), ...priced.tokens].sort((a, b) => b.value - a.value);
    const max = Math.max(...pool.map((row) => row.value), 0.0001);
    for (const token of pool.slice(0, 6)) {
      rows.push({
        label: token.symbol,
        amount: `$${formatNumber(token.value, token.value >= 1000 ? 0 : 2)}`,
        pct: Math.max(8, Math.round((token.value / max) * 100)),
      });
    }
    return {
      type: "holdings",
      caption: "Bars follow Solscan dollar value. The score still comes from the chain rules.",
      rows,
    };
  }
  if (!facts.tokens.length && facts.lamports === 0) return null;
  const rows: HoldingRow[] = [];
  if (facts.lamports > 0) rows.push({ label: "SOL", amount: formatSol(facts.lamports), pct: 100 });
  const top = facts.tokens.slice(0, 6);
  const max = Math.max(...top.map((row) => row.amount), 0.0001);
  for (const token of top) {
    rows.push({
      label: mintName(token.mint),
      amount: token.amountText,
      pct: Math.max(8, Math.round((token.amount / max) * 100)),
      flag: token.delegate ? "Delegate set" : token.frozen ? "Frozen" : undefined,
    });
  }
  return {
    type: "holdings",
    caption: "SOL is the native balance. Token bars are scaled within the tokens shown, not by dollar value. Only named mints are labelled.",
    rows,
  };
}

function counterpartyVisual(facts: WalletFacts): Visual | null {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  for (const flow of facts.flows) {
    for (const row of flow.inboundSol) inbound.set(row.address, (inbound.get(row.address) ?? 0) + row.lamports);
    for (const row of flow.outboundSol) outbound.set(row.address, (outbound.get(row.address) ?? 0) + row.lamports);
    for (const row of flow.tokenIn) inbound.set(row.mint, (inbound.get(row.mint) ?? 0) + 1);
    for (const row of flow.tokenOut) outbound.set(row.mint, (outbound.get(row.mint) ?? 0) + 1);
  }
  if (!inbound.size && !outbound.size) return null;
  const toRows = (map: Map<string, number>, sol: boolean): FlowRow[] =>
    [...map.entries()].slice(0, 4).map(([address, amount]) => ({
      address,
      label: lookupLabel(address)?.name ?? shortAddress(address),
      amount: sol && amount > 1000 ? formatSol(amount) : formatNumber(amount, 2),
    }));
  return {
    type: "counterparties",
    caption: "Estimated from balance changes in the opened transactions. SOL amounts are lamports converted to SOL. Token rows are counts of movements, not prices.",
    inbound: toRows(inbound, true),
    outbound: toRows(outbound, true),
  };
}

function approvalsVisual(facts: WalletFacts): Visual | null {
  if (facts.executable || facts.accountType === "mint") return null;
  const rows: ApprovalRow[] = facts.tokens
    .filter((token) => token.delegate)
    .slice(0, 6)
    .map((token) => ({
      mint: mintName(token.mint),
      delegate: lookupLabel(token.delegate ?? "")?.name ?? shortAddress(token.delegate ?? ""),
      amount: token.amountText,
      address: token.delegate,
    }));
  return {
    type: "approvals",
    caption: rows.length
      ? "Delegates reported by the token accounts. KaziTrust never builds the revoke transaction."
      : "No delegate field was set on token accounts with a balance.",
    rows,
  };
}

function programVisual(facts: WalletFacts): Visual | null {
  const counts = programCounts(facts);
  if (!counts.size) return null;
  const slices: ProgramSlice[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([address, value]) => ({ label: programName(address), value }));
  return {
    type: "programs",
    caption: "Contracts named on the outer instructions of the opened transactions.",
    slices,
  };
}

function counterpartyCounts(facts: WalletFacts): Map<string, number> {
  const counts = new Map<string, number>();
  for (const flow of facts.flows) {
    for (const row of [...flow.inboundSol, ...flow.outboundSol]) {
      counts.set(row.address, (counts.get(row.address) ?? 0) + 1);
    }
  }
  return new Map([...counts.entries()].sort((a, b) => b[1] - a[1]));
}

function programCounts(facts: WalletFacts): Map<string, number> {
  const counts = new Map<string, number>();
  for (const flow of facts.flows) {
    for (const program of new Set(flow.programs)) {
      counts.set(program, (counts.get(program) ?? 0) + 1);
    }
  }
  return counts;
}

function compareReports(left: Report, right: Report): Report {
  const score = (value: number | null) => (value === null ? "no score" : String(value));
  return {
    kind: "compare",
    wallet: `${left.wallet} ${right.wallet}`,
    displayAddress: `${left.displayAddress} and ${right.displayAddress}`,
    typeGuess: "Comparison",
    riskScore: null,
    band: null,
    confidence: left.confidence === "low" || right.confidence === "low" ? "low" : "medium",
    confidenceLabel: "Confidence follows the weaker read",
    scoringVersion: SCORING_VERSION,
    dataAsOf: left.dataAsOf,
    summary: `${left.displayAddress} is ${left.typeGuess}, score ${score(left.riskScore)}. ${right.displayAddress} is ${right.typeGuess}, score ${score(right.riskScore)}.`,
    meaning: "Read the two bands side by side. A higher number is the riskier public record under version 0.1. It is not a verdict about a person.",
    nextStep: "Ask about either address on its own to open the full findings.",
    findings: [
      ...left.findings.slice(0, 2).map((finding) => ({ ...finding, id: `l-${finding.id}`, title: `${left.displayAddress}: ${finding.title}` })),
      ...right.findings.slice(0, 2).map((finding) => ({ ...finding, id: `r-${finding.id}`, title: `${right.displayAddress}: ${finding.title}` })),
    ],
    visuals: [
      {
        type: "compare",
        caption: "Both scores use the same rules. Missing history stays missing on each side.",
        left: { address: left.wallet, title: left.typeGuess, score: left.riskScore, band: left.band, line: left.findings[0]?.title ?? left.summary },
        right: { address: right.wallet, title: right.typeGuess, score: right.riskScore, band: right.band, line: right.findings[0]?.title ?? right.summary },
      },
    ],
    rules: [],
    tools: [...left.tools, ...right.tools],
    txCount: left.txCount + right.txCount,
    warnings: [...left.warnings, ...right.warnings],
    illustrative: false,
    cited: [...new Set([...left.cited, ...right.cited])],
  };
}

function batchReport(reports: Report[]): Report {
  return {
    kind: "batch",
    wallet: reports.map((item) => item.wallet).join(" "),
    displayAddress: `${reports.length} addresses`,
    typeGuess: "Batch read",
    riskScore: null,
    band: null,
    confidence: "medium",
    confidenceLabel: "Each row has its own confidence",
    scoringVersion: SCORING_VERSION,
    dataAsOf: reports[0]?.dataAsOf ?? formatNow(),
    summary: `Quick reads for ${reports.length} addresses. Open any row in a new question for the full findings.`,
    meaning: "A batch is a set of quick reads. It uses the same rules as a single wallet, on a shorter scan.",
    nextStep: "Ask about the address with the highest score first.",
    findings: reports.slice(0, 5).map((item) => ({
      id: item.wallet,
      title: `${item.displayAddress} · ${item.riskScore ?? "no score"} · ${item.band ?? "unscored"}`,
      severity: "note" as const,
      severityWord: "Noted",
      confidence: item.confidence === "high" ? 0.8 : item.confidence === "medium" ? 0.6 : 0.4,
      explanation: item.summary,
      evidence: item.findings[0]?.evidence ?? [],
    })),
    visuals: [
      {
        type: "batch",
        caption: "Capped at five addresses in this browser version.",
        rows: reports.map((item) => ({
          address: item.wallet,
          score: item.riskScore,
          band: item.band ?? "Unscored",
          line: item.typeGuess,
        })),
      },
    ],
    rules: [],
    tools: reports.flatMap((item) => item.tools),
    txCount: reports.reduce((sum, item) => sum + item.txCount, 0),
    warnings: reports.flatMap((item) => item.warnings),
    illustrative: false,
    cited: [...new Set(reports.flatMap((item) => item.cited))],
  };
}

function followupsFor(report: Report): string[] {
  if (report.illustrative) return ["Read the Jupiter contract", "Read the USDC mint", "How is the score built?"];
  if (report.kind === "compare") return ["Trace where the first wallet was funded", "Check approvals on the second wallet"];
  const items = ["Trace where it was funded", "Find risky approvals", "Which contracts does it use?"];
  if (report.watchAddress) items.push("Add to watchlist");
  return items.slice(0, 3);
}

function assertGrounded(report: Report): void {
  if (report.illustrative) return;
  const allowed = new Set(report.cited.filter((value) => isSolanaAddress(value) || value.length > 40));
  for (const value of report.cited) allowed.add(value);
  const bad = ungroundedAddresses(JSON.stringify(report), allowed);
  if (!bad.length) return;
  report.warnings.push("A line was removed because it named an address the tools did not return.");
  for (const address of bad) {
    report.summary = report.summary.split(address).join("an address outside the tool output");
    report.meaning = report.meaning.split(address).join("an address outside the tool output");
    report.nextStep = report.nextStep.split(address).join("an address outside the tool output");
  }
  report.findings = report.findings.filter((finding) => !bad.some((address) => JSON.stringify(finding).includes(address)));
  report.visuals = report.visuals.filter((visual) => !bad.some((address) => JSON.stringify(visual).includes(address)));
}
