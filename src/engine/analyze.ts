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
import { readTokenFaces } from "./tokenmeta";
import { bandFromScore, clamp, formatNow, formatNumber, formatRawUnits, formatSol, formatTime, severityWord, shortAddress } from "../format";
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
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  name?: string;
  symbol?: string;
  image?: string;
};

type Flow = {
  signature: string;
  slot: number;
  time: number | null;
  failed: boolean;
  programs: string[];
  signers: string[];
  burnClose: boolean;
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
  mintSymbol?: string;
  mintTitle?: string;
  freezeWatch?: { address: string; lamports: number; signatures: number };
  mintWatch?: { address: string; lamports: number; signatures: number };
  signatures: SignatureInfo[];
  tokens: TokenRow[];
  tokenWarning?: string;
  flows: Flow[];
  flowWarning?: string;
  historyComplete: boolean;
  ageReached: boolean;
  ageTargetDays: number;
  scanned: number;
  mode: "quick" | "deep";
  hop?: { address: string; lamports: number; signatures: number };
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
      "Version 0.3 scores only what this browser read. An unlabelled address starts at 22. A balance of 0 SOL does not remove the score. Thin history, bunched activity, failed transactions, a swept balance, open delegates, and a concentrated counterparty push the number up. Six months or a year of history, many active days, and a spread of contracts pull it down. Quick read aims at six months. Deep scan aims at one year. Neither walks the entire chain. Labelled contracts and mints are held to a fixed low score, because they are not personal wallets. The method page lists every rule. A general chat model can invent a hop. This one cannot: if a signature is not in the tool output, it is dropped before you see it.";
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
  const plan = scanPlan(mode);
  onStep(`${tag}Reading balance and account type`, "active");
  const [balance, account] = await Promise.all([
    rpc<ContextResult<number>>("getBalance", [address, { commitment: "confirmed" }], signal),
    rpc<ContextResult<AccountValue>>("getAccountInfo", [address, { encoding: "jsonParsed", commitment: "confirmed" }], signal),
  ]);
  onStep(`${tag}Reading balance and account type`, "done");
  onStep(`${tag}${mode === "deep" ? "Walking a wider transaction history" : "Reading recent transactions"}`, "active");
  const history = await loadSignatures(address, plan.cap, plan.days, signal);
  const signatures = history.items;
  onStep(`${tag}${mode === "deep" ? "Walking a wider transaction history" : "Reading recent transactions"}`, "done");

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
    if (tokens.length) {
      onStep(`${tag}Reading token names`, "active");
      try {
        await attachTokenFaces(tokens, signal);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      onStep(`${tag}Reading token names`, "done");
    }
    const unlabelled = tokens.some((token) => token.mint && lookupLabel(token.mint)?.category !== "mint");
    if (unlabelled) {
      onStep(`${tag}Reading authorities on held tokens`, "active");
      try {
        await attachHeldAuthorities(tokens, signal);
      } catch (error) {
        if (signal.aborted) throw error;
      }
      onStep(`${tag}Reading authorities on held tokens`, "done");
    }
  }

  const opened = spreadSignatures(signatures, accountType === "mint" && mode === "deep" ? 24 : plan.open);
  let flows: Flow[] = [];
  let flowWarning: string | undefined;
  if (opened.length) {
    onStep(`${tag}${accountType === "mint" ? "Opening transactions that touch this mint" : "Opening transactions across the window"}`, "active");
    try {
      flows = await loadFlows(address, opened, signal);
    } catch (error) {
      flowWarning = error instanceof RpcError ? error.message : "Some transactions could not be opened.";
    }
    onStep(`${tag}${accountType === "mint" ? "Opening transactions that touch this mint" : "Opening transactions across the window"}`, "done");
  }

  let hop: WalletFacts["hop"];
  let freezeWatch: WalletFacts["freezeWatch"];
  let mintWatch: WalletFacts["mintWatch"];
  if (mode === "deep" && accountType === "mint" && (mintInfo?.freezeAuthority || mintInfo?.mintAuthority)) {
    onStep(`${tag}Reading the token authorities`, "active");
    try {
      if (mintInfo?.freezeAuthority) freezeWatch = await readAuthorityWatch(mintInfo.freezeAuthority, signal);
      if (mintInfo?.mintAuthority && mintInfo.mintAuthority !== mintInfo.freezeAuthority) mintWatch = await readAuthorityWatch(mintInfo.mintAuthority, signal);
      else if (mintInfo?.mintAuthority) mintWatch = freezeWatch;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    onStep(`${tag}Reading the token authorities`, "done");
  } else if (mode === "deep" && signatures.length) {
    onStep(`${tag}Reading the oldest funding address`, "active");
    try {
      hop = (await readHop(address, flows, signal)) ?? undefined;
    } catch {
      hop = undefined;
    }
    onStep(`${tag}Reading the oldest funding address`, "done");
  }

  let mintSymbol: string | undefined;
  let mintTitle: string | undefined;
  if (accountType === "mint") {
    onStep(`${tag}Reading the published token name`, "active");
    try {
      const faces = await readTokenFaces([address], signal);
      const face = faces.get(address);
      if (face?.symbol) mintSymbol = face.symbol;
      if (face?.name) mintTitle = face.name;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    onStep(`${tag}Reading the published token name`, "done");
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
  if (hop) watched.push(hop.address);
  if (mintInfo?.freezeAuthority) watched.push(mintInfo.freezeAuthority);
  if (mintInfo?.mintAuthority) watched.push(mintInfo.mintAuthority);
  if (freezeWatch) watched.push(freezeWatch.address);
  if (mintWatch) watched.push(mintWatch.address);
  for (const token of tokens) {
    if (token.mintAuthority) watched.push(token.mintAuthority);
    if (token.freezeAuthority) watched.push(token.freezeAuthority);
  }
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
    mintSymbol,
    mintTitle,
    signatures,
    tokens,
    tokenWarning,
    flows,
    flowWarning,
    historyComplete: history.complete,
    ageReached: history.ageReached,
    ageTargetDays: plan.days,
    scanned: signatures.length,
    mode,
    hop,
    freezeWatch,
    mintWatch,
    solscan: solscan ?? undefined,
    solscanWarning: solscanWarning || undefined,
    rugcheck: rugcheck ?? undefined,
    rugcheckWarning: scanMint && !rugcheck ? "RugCheck did not return a token report for this mint." : undefined,
    restrictions,
    restrictionWarning: restrictions ? undefined : "The OFAC SDN list could not be checked, so this read does not claim the address is clear.",
  };
}

function readMint(info: Record<string, unknown>): WalletFacts["mintInfo"] {
  const supply = typeof info.supply === "string" && /^\d+$/.test(info.supply)
    ? info.supply
    : typeof info.supply === "number" && Number.isFinite(info.supply)
      ? String(Math.round(info.supply))
      : "0";
  const decimals = typeof info.decimals === "number" ? info.decimals : 0;
  const mintAuthority = typeof info.mintAuthority === "string" ? info.mintAuthority : null;
  const freezeAuthority = typeof info.freezeAuthority === "string" ? info.freezeAuthority : null;
  return { supply, decimals, mintAuthority, freezeAuthority };
}

function scanPlan(mode: "quick" | "deep"): { days: number; cap: number; open: number } {
  return mode === "deep" ? { days: 365, cap: 800, open: 16 } : { days: 183, cap: 300, open: 8 };
}

async function loadSignatures(
  address: string,
  cap: number,
  days: number,
  signal: AbortSignal,
): Promise<{ items: SignatureInfo[]; complete: boolean; ageReached: boolean }> {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const all: SignatureInfo[] = [];
  let before = "";
  let complete = false;
  let ageReached = false;
  while (all.length < cap) {
    const pageLimit = Math.min(100, cap - all.length);
    let page: SignatureInfo[];
    try {
      page = await rpc<SignatureInfo[]>(
        "getSignaturesForAddress",
        [address, { limit: pageLimit, commitment: "confirmed", ...(before ? { before } : {}) }],
        signal,
      );
    } catch (error) {
      if (!all.length || signal.aborted) throw error;
      break;
    }
    if (!Array.isArray(page) || !page.length) {
      complete = true;
      ageReached = true;
      break;
    }
    all.push(...page);
    const oldest = page[page.length - 1]?.blockTime;
    if (typeof oldest === "number" && oldest <= cutoff) {
      ageReached = true;
      break;
    }
    if (page.length < pageLimit) {
      complete = true;
      ageReached = true;
      break;
    }
    before = page[page.length - 1]?.signature ?? "";
    if (!before) break;
  }
  return { items: all.slice(0, cap), complete, ageReached };
}

function spreadSignatures(signatures: SignatureInfo[], count: number): SignatureInfo[] {
  if (signatures.length <= count) return signatures;
  const picked: SignatureInfo[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const at = Math.round((index * (signatures.length - 1)) / Math.max(1, count - 1));
    const item = signatures[at];
    if (!item || seen.has(item.signature)) continue;
    seen.add(item.signature);
    picked.push(item);
  }
  return picked;
}

async function readAuthorityWatch(address: string, signal: AbortSignal): Promise<{ address: string; lamports: number; signatures: number }> {
  const [balance, page] = await Promise.all([
    rpc<ContextResult<number>>("getBalance", [address, { commitment: "confirmed" }], signal),
    rpc<SignatureInfo[]>("getSignaturesForAddress", [address, { limit: 20, commitment: "confirmed" }], signal),
  ]);
  return { address, lamports: balance.value ?? 0, signatures: page.length };
}

async function attachHeldAuthorities(tokens: TokenRow[], signal: AbortSignal): Promise<void> {
  const seen = new Set<string>();
  const picked: TokenRow[] = [];
  for (const token of tokens) {
    if (!token.mint || seen.has(token.mint) || lookupLabel(token.mint)?.category === "mint") continue;
    seen.add(token.mint);
    picked.push(token);
    if (picked.length === 6) break;
  }
  const reads = await Promise.all(picked.map(async (token) => {
    try {
      const account = await rpc<ContextResult<AccountValue>>("getAccountInfo", [token.mint, { encoding: "jsonParsed", commitment: "confirmed" }], signal);
      const info = account.value && typeof account.value.data === "object" ? account.value.data.parsed?.info : undefined;
      return { mint: token.mint, info: info ? readMint(info) : undefined };
    } catch (error) {
      if (signal.aborted) throw error;
      return { mint: token.mint, info: undefined };
    }
  }));
  const byMint = new Map(reads.map((row) => [row.mint, row.info]));
  for (const token of tokens) {
    const info = byMint.get(token.mint);
    if (!info) continue;
    token.mintAuthority = info.mintAuthority;
    token.freezeAuthority = info.freezeAuthority;
  }
}

function heldAuthorityMints(facts: WalletFacts): TokenRow[] {
  const seen = new Set<string>();
  const rows: TokenRow[] = [];
  for (const token of facts.tokens) {
    if (!token.mint || seen.has(token.mint) || lookupLabel(token.mint)?.category === "mint") continue;
    if (!token.mintAuthority && !token.freezeAuthority) continue;
    seen.add(token.mint);
    rows.push(token);
  }
  return rows;
}

async function readHop(address: string, flows: Flow[], signal: AbortSignal): Promise<WalletFacts["hop"] | null> {
  const oldestFirst = [...flows].sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  const source = oldestFirst.flatMap((flow) => flow.inboundSol).find((row) => row.address !== address)?.address;
  if (!source || !isSolanaAddress(source)) return null;
  const [balance, page] = await Promise.all([
    rpc<ContextResult<number>>("getBalance", [source, { commitment: "confirmed" }], signal),
    rpc<SignatureInfo[]>("getSignaturesForAddress", [source, { limit: 20, commitment: "confirmed" }], signal),
  ]);
  return { address: source, lamports: balance.value ?? 0, signatures: page.length };
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
      const tokenAmount = info.tokenAmount as { amount?: string; decimals?: number; uiAmountString?: string } | undefined;
      const raw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
      if (/^0+$/.test(raw.replace("-", ""))) continue;
      const decimals = typeof tokenAmount?.decimals === "number" ? tokenAmount.decimals : 0;
      const printed = tokenAmount?.uiAmountString && !/^0+(?:\.0+)?$/.test(tokenAmount.uiAmountString)
        ? tokenAmount.uiAmountString
        : formatRawUnits(raw, decimals);
      const amount = Number(printed);
      const delegate = typeof info.delegate === "string" ? info.delegate : undefined;
      rows.push({
        pubkey: item.pubkey,
        mint: String(info.mint ?? ""),
        amount: amount > 0 ? amount : Number.MIN_VALUE,
        amountText: printed,
        delegate,
        frozen: info.state === "frozen",
      });
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

async function attachTokenFaces(tokens: TokenRow[], signal: AbortSignal): Promise<void> {
  const ranked = [...tokens].sort((a, b) => b.amount - a.amount);
  const picked = ranked.slice(0, 8);
  const smallest = ranked[ranked.length - 1];
  if (smallest && !picked.includes(smallest)) picked.push(smallest);
  for (const token of ranked) {
    if (picked.length >= 12) break;
    if ((token.frozen || token.delegate) && !picked.includes(token)) picked.push(token);
  }
  const faces = await readTokenFaces(picked.map((token) => token.mint), signal);
  for (const token of tokens) {
    const face = faces.get(token.mint);
    if (!face) continue;
    if (face.name) token.name = face.name;
    if (face.symbol) token.symbol = face.symbol;
    if (face.image) token.image = face.image;
  }
}

function cleanFace(value?: string): string {
  if (!value) return "";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 32) return "";
  return clean;
}

function tokenLabel(token: TokenRow): string {
  const known = lookupLabel(token.mint);
  if (known?.category === "mint") return known.name;
  return cleanFace(token.symbol) || cleanFace(token.name) || mintName(token.mint);
}

function labelForMint(facts: WalletFacts, mint: string): string {
  const token = facts.tokens.find((item) => item.mint === mint);
  return token ? tokenLabel(token) : mintName(mint);
}

function publishedName(token: TokenRow, label: string): string | undefined {
  const name = cleanFace(token.name);
  if (!name || name.toLowerCase() === label.toLowerCase()) return undefined;
  return name;
}

function holdingBits(label: string, token?: TokenRow): Pick<HoldingRow, "mark" | "logo" | "name"> {
  const name = token ? publishedName(token, label) : undefined;
  if (label === "SOL") return { mark: "sol", ...(name ? { name } : {}) };
  if (token?.image) return { logo: token.image, ...(name ? { name } : {}) };
  if (label === "Wrapped SOL") return { mark: "sol", ...(name ? { name } : {}) };
  return name ? { name } : {};
}

function matchToken(facts: WalletFacts, symbol: string): TokenRow | undefined {
  return facts.tokens.find((token) => tokenLabel(token) === symbol || cleanFace(token.symbol) === symbol || cleanFace(token.name) === symbol);
}

async function loadFlows(address: string, signatures: SignatureInfo[], signal: AbortSignal): Promise<Flow[]> {
  const transactions: { item: SignatureInfo; tx: ParsedTransaction | null }[] = [];
  for (let index = 0; index < signatures.length; index += 4) {
    const batch = signatures.slice(index, index + 4);
    const opened = await Promise.all(
      batch.map(async (item) => {
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
    transactions.push(...opened);
  }
  const flows = transactions.filter((entry) => entry.tx).map((entry) => parseFlow(address, entry.item, entry.tx as ParsedTransaction));
  if (!flows.length && signatures.length) throw new RpcError("The transactions could not be opened.");
  return flows;
}

type ParsedInstruction = {
  programId?: string;
  program?: string;
  parsed?: { type?: string; info?: { mint?: string } };
};

type ParsedTransaction = {
  slot?: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    fee?: number;
    logMessages?: string[];
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { instructions?: ParsedInstruction[] }[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: (string | { pubkey: string; signer?: boolean })[];
      instructions?: ParsedInstruction[];
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

  const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  const instructions = [...(tx.transaction?.message?.instructions ?? []), ...inner];
  const programs = [...new Set(instructions.map((instruction) => instruction.programId || "").filter(Boolean))];
  const signers = (tx.transaction?.message?.accountKeys ?? [])
    .filter((key): key is { pubkey: string; signer?: boolean } => typeof key !== "string" && Boolean(key.signer && key.pubkey))
    .map((key) => key.pubkey);

  return {
    signature: item.signature,
    slot: tx.slot ?? item.slot,
    time: tx.blockTime ?? item.blockTime,
    failed: Boolean(tx.meta?.err ?? item.err),
    programs,
    signers,
    burnClose: burnClose(address, tx, instructions),
    inboundSol,
    outboundSol,
    tokenIn,
    tokenOut,
  };
}

function burnClose(address: string, tx: ParsedTransaction, instructions: ParsedInstruction[]): boolean {
  const logs = tx.meta?.logMessages ?? [];
  if (logs.some((line) => /burnall|burn\s*all|begin_burn_close|burn_close|BurnAll/i.test(line))) return true;
  const burned = instructions.some((instruction) => {
    const type = instruction.parsed?.type;
    return (type === "burn" || type === "burnChecked") && instruction.parsed?.info?.mint === address;
  });
  const closed = instructions.some((instruction) => instruction.parsed?.type === "closeAccount");
  return burned && closed;
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
    facts.mode === "deep"
      ? facts.accountType === "mint"
        ? "Deep scan: signatures back toward one year, mint transactions opened, mint and freeze authorities read"
        : "Deep scan: signatures back toward one year, interactions sampled across the window, one funding hop"
      : "Quick read: signatures back toward six months, interactions sampled across the window",
    facts.restrictions ? "OFAC SDN list" : "OFAC SDN list unavailable",
  ];
  if (facts.solscan) tools.push("Solscan portfolio, metadata, and recent DeFi activity");
  if (facts.rugcheck) tools.push("RugCheck token report");
  if (facts.solscanWarning) warnings.push(facts.solscanWarning);
  if (facts.rugcheckWarning) warnings.push(facts.rugcheckWarning);
  if (facts.restrictionWarning) warnings.push(facts.restrictionWarning);

  if (!facts.signatures.length && !facts.executable && facts.accountType !== "mint") {
    return emptyWalletReport(facts, intent, warnings, tools);
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

  const oldestTime = times.length ? Math.min(...times) : 0;
  const age = oldestTime ? Math.floor(Date.now() / 1000) - oldestTime : 0;
  const activeDays = activeDayCount(times);
  if (facts.scanned > 0 && facts.scanned < 5) {
    score += 12;
    rules.push({ id: "thin", points: 12, detail: "Fewer than five signatures in the scan" });
  } else if (age >= 365 * 86400 && facts.scanned >= 20) {
    score -= 10;
    rules.push({ id: "year", points: -10, detail: "At least 20 signatures reaching back a year or more" });
  } else if (age >= 183 * 86400 && facts.scanned >= 12) {
    score -= 6;
    rules.push({ id: "half-year", points: -6, detail: "At least 12 signatures reaching back six months or more" });
  } else if (facts.scanned >= 20 && span >= 30 * 86400) {
    score -= 4;
    rules.push({ id: "long", points: -4, detail: "At least 20 signatures across 30 days, short of six months" });
  }
  if (age >= 183 * 86400 && activeDays > 0 && activeDays <= 3 && facts.scanned >= 8) {
    score += 10;
    rules.push({ id: "sleeper", points: 10, detail: "Six months or more of span, with activity on three days or fewer" });
  } else if (activeDays >= 30) {
    score -= 4;
    rules.push({ id: "many-days", points: -4, detail: "Activity spread across 30 or more days" });
  }
  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) {
    score += 26;
    rules.push({ id: "burst", points: 26, detail: "Fifteen or more signatures inside six hours" });
  } else if (facts.scanned >= 15 && span > 0 && span < 2 * 86400) {
    score += 14;
    rules.push({ id: "recent-burst", points: 14, detail: "Fifteen or more signatures inside two days" });
  }
  if (facts.lamports === 0 && facts.scanned >= 5) {
    score += 8;
    rules.push({ id: "swept", points: 8, detail: "Balance is 0 SOL after at least five signatures" });
  }

  const failedSigs = facts.signatures.filter((item) => item.err).length;
  const failed = facts.flows.filter((flow) => flow.failed).length;
  if (facts.scanned >= 10 && failedSigs / facts.scanned >= 0.35) {
    score += 8;
    rules.push({ id: "fail-window", points: 8, detail: "At least 35 percent of the scanned signatures failed" });
  } else if (facts.flows.length >= 4 && failed / facts.flows.length >= 0.5) {
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
  const heldMints = heldAuthorityMints(facts);
  const mintable = heldMints.filter((token) => token.mintAuthority);
  const freezable = heldMints.filter((token) => token.freezeAuthority);
  if (mintable.length) {
    score += 12;
    rules.push({ id: "held-mint-authority", points: 12, detail: `${mintable.length} unlabelled held token${mintable.length === 1 ? "" : "s"} still ha${mintable.length === 1 ? "s" : "ve"} a mint authority` });
  }
  if (freezable.length) {
    score += 8;
    rules.push({ id: "held-freeze-authority", points: 8, detail: `${freezable.length} unlabelled held token${freezable.length === 1 ? "" : "s"} still ha${freezable.length === 1 ? "s" : "ve"} a freeze authority` });
  }
  if (facts.tokenWarning) {
    score += 4;
    rules.push({ id: "token-gap", points: 4, detail: "Token accounts could not be read" });
  }

  const counterparties = counterpartyCounts(facts);
  const flowCount = [...counterparties.values()].reduce((sum, count) => sum + count, 0);
  const dominant = counterparties.size ? ([...counterparties.values()][0] ?? 0) / Math.max(1, flowCount) : 0;
  if (facts.flows.length >= 3 && counterparties.size === 1) {
    score += 10;
    rules.push({ id: "single", points: 10, detail: "Scanned flows name a single counterparty" });
  } else if (facts.flows.length >= 4 && counterparties.size > 1 && dominant >= 0.7) {
    score += 8;
    rules.push({ id: "dominant", points: 8, detail: "One counterparty is at least 70 percent of the opened flows" });
  } else if (counterparties.size >= 8) {
    score -= 4;
    rules.push({ id: "broad", points: -4, detail: "Eight or more counterparties in the opened transactions" });
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
  if (facts.accountType === "mint" && facts.mintInfo) return scoreMint(facts);
  return null;
}

function scoreMint(facts: WalletFacts): { score: number; rules: ScoreRule[]; findings: Finding[] } {
  const info = facts.mintInfo;
  if (!info) return { score: 16, rules: [], findings: [] };
  const name = lookupLabel(facts.address)?.name;
  const labelled = Boolean(name);
  const freeze = info.freezeAuthority;
  const mintAuth = info.mintAuthority;
  const supply = formatRawUnits(info.supply, info.decimals);
  const published = facts.mintTitle && facts.mintSymbol && facts.mintTitle !== facts.mintSymbol
    ? `${facts.mintTitle} (${facts.mintSymbol})`
    : facts.mintSymbol || facts.mintTitle || "";
  let score = labelled ? 10 : 16;
  const rules: ScoreRule[] = [{
    id: "mint",
    points: score,
    detail: labelled ? `${name} is a labelled mint` : "Unlabelled mint account",
  }];
  const findings: Finding[] = [];
  const burns = facts.flows.filter((flow) => flow.burnClose);
  if (burns.length) {
    const points = burns.length >= 2 ? 24 : 12;
    score += points;
    const signers = [...new Set(burns.flatMap((flow) => flow.signers).filter((item) => item && item !== facts.address))];
    const programs = [...new Set(burns.flatMap((flow) => flow.programs))].filter((program) => !quietProgram(program));
    const named = programs.slice(0, 2).map((program) => programName(program));
    const programLine = named.length ? ` The calls include ${named.join(" and ")}.` : "";
    const signerLine = signers.length ? ` They were signed by ${signers.length} different account${signers.length === 1 ? "" : "s"}.` : "";
    rules.push({
      id: "mint-burn-close",
      points,
      detail: burns.length >= 2
        ? `${burns.length} opened transactions burn the mint and close a holder account`
        : "One opened transaction burns the mint and closes a holder account",
    });
    findings.push(makeFinding(
      facts,
      "burn-close",
      `${burns.length} opened transaction${burns.length === 1 ? "" : "s"} burn this mint and close a holder account.`,
      "elevated",
      0.86,
      `If you hold this token or interact with it, a transaction in this pattern can burn the balance and close the holder account. That removes the tokens from the holder.${signerLine}${programLine} It is not, by itself, proof of who received the value.`,
      burns.slice(0, 3).map((flow) => ({ signature: flow.signature, slot: flow.slot, blockTime: flow.time })),
      signers.slice(0, 3),
    ));
  }
  if (mintAuth) {
    const watch = !labelled ? facts.mintWatch : undefined;
    const watchLine = watch
      ? ` A read of ${shortAddress(mintAuth)} shows ${formatSol(watch.lamports)} and ${watch.signatures} recent signature${watch.signatures === 1 ? "" : "s"}. That read does not add points by itself.`
      : "";
    if (!labelled) {
      score += 16;
      rules.push({ id: "mint-authority", points: 16, detail: `Mint authority is still ${shortAddress(mintAuth)}` });
    }
    findings.push(makeFinding(
      facts,
      "mint-authority",
      `Mint authority is still set to ${shortAddress(mintAuth)}.`,
      labelled ? "watch" : "elevated",
      0.92,
      `This address can create more of this token. New supply can dilute anyone who holds it.${watchLine}`,
      [],
      [mintAuth],
    ));
  } else {
    findings.push(makeFinding(
      facts,
      "mint-authority-clear",
      "Mint authority is cleared.",
      freeze ? "note" : "clean",
      0.9,
      freeze
        ? "No address can mint more of this token from the mint authority field. That does not protect a holder. Freeze authority is still set, so a holder account can still be frozen."
        : "No address can mint more of this token from the mint authority field. This check is only about that field.",
    ));
  }
  if (freeze) {
    const watch = !labelled ? facts.freezeWatch : undefined;
    const watchLine = watch
      ? ` A read of ${shortAddress(freeze)} shows ${formatSol(watch.lamports)} and ${watch.signatures} recent signature${watch.signatures === 1 ? "" : "s"}. That read does not add points by itself.`
      : "";
    if (!labelled) {
      score += 16;
      rules.push({ id: "mint-freeze", points: 16, detail: `Freeze authority is still ${shortAddress(freeze)}` });
    }
    findings.push(makeFinding(
      facts,
      "freeze",
      `Freeze authority is still set to ${shortAddress(freeze)}.`,
      labelled ? "watch" : "elevated",
      0.9,
      `If you hold this token, this address can freeze your token account. A frozen balance cannot be moved or sold.${watchLine}`,
      [],
      [freeze],
    ));
  } else {
    findings.push(makeFinding(
      facts,
      "freeze-clear",
      "Freeze authority is cleared.",
      "clean",
      0.9,
      "The mint account reports no freeze authority. That check is only about this mint, not about every wallet that holds it.",
    ));
  }
  const times = facts.signatures.map((item) => item.blockTime).filter((time): time is number => typeof time === "number");
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  if (!labelled && facts.scanned >= 8 && span > 0 && span < 2 * 86400) {
    const hours = Math.max(1, Math.round(span / 3600));
    score += 10;
    rules.push({ id: "mint-burst", points: 10, detail: `${facts.scanned} signatures span about ${hours} hours` });
    findings.push(makeFinding(
      facts,
      "mint-burst",
      `${facts.scanned} signatures span about ${hours} hours.`,
      "watch",
      0.84,
      "A new mint with a short public history has less behaviour to judge. The span is measured from the signatures in this scan.",
      facts.signatures.slice(0, 2),
    ));
  }
  const failed = facts.signatures.filter((item) => item.err).length;
  if (!labelled && facts.signatures.length >= 8 && failed / facts.signatures.length >= 0.35) {
    score += 8;
    rules.push({ id: "mint-failed", points: 8, detail: `${failed} of ${facts.signatures.length} signatures failed` });
    findings.push(makeFinding(
      facts,
      "mint-failed",
      `${failed} of ${facts.signatures.length} signatures failed.`,
      "watch",
      0.82,
      "A high failure rate on a mint means many attempts to interact did not complete. The count comes from the signature list in this scan.",
    ));
  }
  const who = published ? `Published metadata names it ${published}.` : name ? `The label list names it ${name}.` : "No published name was read for this mint.";
  findings.push(makeFinding(
    facts,
    "mint",
    name ? `This is the ${name} mint, not a spending wallet.` : published ? `This is the ${published} mint, not a spending wallet.` : "This is a token mint, not a spending wallet.",
    "note",
    name || published ? 0.9 : 0.84,
    `Supply is ${supply} tokens, with ${info.decimals} decimals. ${who} ${mintAuth ? `Mint authority is ${shortAddress(mintAuth)}.` : "Mint authority is cleared."} ${freeze ? `Freeze authority is ${shortAddress(freeze)}.` : "Freeze authority is cleared."}`,
    [],
    [freeze, mintAuth].filter((item): item is string => Boolean(item)),
  ));
  return { score: clamp(score, 0, 100), rules, findings };
}

function quietProgram(program: string): boolean {
  return program === TOKEN_PROGRAM
    || program === TOKEN_2022
    || program === "11111111111111111111111111111111"
    || program === "ComputeBudget111111111111111111111111111111"
    || program === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
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
  if (newest) {
    findings.push(
      makeFinding(
        facts,
        "history",
        windowTitle(facts, oldest),
        facts.scanned < 5 ? "watch" : "note",
        facts.ageReached || facts.historyComplete ? 0.84 : 0.68,
        windowDetail(facts, newest, oldest),
        [newest, oldest].filter((item): item is SignatureInfo => Boolean(item)),
      ),
    );
  }
  if (facts.lamports === 0) {
    findings.push(
      makeFinding(
        facts,
        "balance",
        facts.scanned ? "The balance is 0 SOL, and the score still uses the history." : "The balance is 0 SOL. The score does not wait for a balance.",
        facts.scanned >= 5 ? "watch" : "note",
        0.9,
        facts.scanned
          ? `${facts.scanned} signature${facts.scanned === 1 ? "" : "s"} were read. An empty balance can mean the wallet was swept. A delegate, or a token that can still be frozen or minted, can still affect what is left.`
          : "getBalance returned 0 lamports and the signature list was empty. The score is 46 until there is behaviour to judge.",
        [],
      ),
    );
  }

  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) {
    findings.push(
      makeFinding(facts, "burst", "Activity is bunched into less than six hours.", "elevated", 0.8, "Value can move through an address this quickly before you have time to react. The burst is a pattern in the signature list. It is not proof of intent.", facts.signatures.slice(0, 3)),
    );
  }

  if (delegates.length) {
    const first = delegates[0];
    findings.push(
      makeFinding(facts, "delegate", `${delegates.length} token account${delegates.length === 1 ? "" : "s"} ha${delegates.length === 1 ? "s" : "ve"} a delegate set.`, "elevated", 0.88, `The first is ${tokenLabel(first)} delegated to ${shortAddress(first.delegate ?? "")}. That address can move the tokens out of this wallet up to the approved amount, without a new signature from this wallet. KaziTrust does not build a revoke transaction.`, [], [first.delegate ?? "", first.mint, first.pubkey]),
    );
  } else if (!facts.tokenWarning) {
    findings.push(
      makeFinding(facts, "delegate-clear", "No open delegate on the token accounts that were read.", "clean", facts.tokens.length ? 0.82 : 0.58, facts.tokens.length ? `${facts.tokens.length} token account${facts.tokens.length === 1 ? "" : "s"} with a balance had no delegate field.` : "This address had no token account with a balance, so there was no delegate to find.", []),
    );
  }

  if (frozen.length) {
    findings.push(
      makeFinding(facts, "frozen", `${frozen.length} token account${frozen.length === 1 ? " is" : "s are"} frozen, so that balance is restricted.`, "elevated", 0.9, `Frozen: ${frozen.slice(0, 3).map((row) => tokenLabel(row)).join(", ")}. The freeze authority on that mint already froze this wallet. You cannot move or sell that balance while it stays frozen. Mint authority is a different field, and clearing it does not unfreeze the account.`, [], frozen.slice(0, 3).map((row) => row.mint)),
    );
  }

  if (facts.flows.length >= 4 && failed > 0) {
    findings.push(
      makeFinding(facts, "failed", `${failed} of ${facts.flows.length} opened transactions failed.`, failed / facts.flows.length >= 0.5 ? "elevated" : "watch", 0.77, "Failures are counted only in the transactions this read opened, not across the whole history.", facts.flows.filter((flow) => flow.failed).slice(0, 3).map((flow) => ({ signature: flow.signature, slot: flow.slot, err: true, blockTime: flow.time }))),
    );
  }

  if (counterparties.size > 1) {
    const top = [...counterparties.entries()][0];
    findings.push(
      makeFinding(
        facts,
        "interactions",
        `Opened transactions name ${counterparties.size} counterparties.`,
        "note",
        0.74,
        top ? `The most repeated is ${shortAddress(top[0])}, in ${top[1]} of the opened flows. The sample is spread across the signature window, not only the newest transactions.` : "The opened transactions did not name a counterparty.",
        facts.flows.slice(0, 2).map((flow) => ({ signature: flow.signature, slot: flow.slot, err: null, blockTime: flow.time })),
        top ? [top[0]] : [],
      ),
    );
  }

  if (counterparties.size === 1 && facts.flows.length >= 3) {
    const only = [...counterparties.keys()][0];
    findings.push(
      makeFinding(facts, "single", `Scanned flows point at one counterparty, ${shortAddress(only)}.`, "watch", 0.6, "Sending more to this address concentrates value with that one counterparty. The count is estimated from balance changes in the opened transactions. A token counterparty is often a token account or a pool, not a person.", facts.flows.slice(0, 2).map((flow) => ({ signature: flow.signature, slot: flow.slot, err: null, blockTime: flow.time })), [only]),
    );
  }

  if (!lookupLabel(facts.address) && !facts.solscan?.label) {
    findings.push(
      makeFinding(facts, "label", "No public label in the v0 list.", "note", 0.9, "The v0 list covers a short set of contracts and major mints. Absence is not a risk finding. It means this address is not one of those.", []),
    );
  }

  const held = heldAuthorityMints(facts);
  if (held.length) findings.unshift(heldAuthorityFinding(facts, held));
  if (facts.hop) findings.unshift(hopFinding(facts));
  return findings.slice(0, facts.mode === "deep" ? 7 : 6);
}

function heldAuthorityFinding(facts: WalletFacts, held: TokenRow[]): Finding {
  const mintable = held.filter((token) => token.mintAuthority);
  const names = held.slice(0, 3).map((token) => tokenLabel(token));
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const extra = held.length > 3 ? ` ${held.length - 3} more unlabelled token${held.length - 3 === 1 ? "" : "s"} in this wallet ${held.length - 3 === 1 ? "was" : "were"} not listed here.` : "";
  const effects = held.slice(0, 3).map((token) => {
    const name = tokenLabel(token);
    if (token.mintAuthority && token.freezeAuthority) return `${name}: mint authority ${shortAddress(token.mintAuthority)} can create more supply, and freeze authority ${shortAddress(token.freezeAuthority)} can freeze this wallet's balance.`;
    if (token.mintAuthority) return `${name}: mint authority ${shortAddress(token.mintAuthority)} can create more supply, which can dilute this holding.`;
    return `${name}: freeze authority ${shortAddress(token.freezeAuthority ?? "")} can freeze this wallet's balance so it cannot be moved or sold. A cleared mint authority would not remove that freeze.`;
  });
  return makeFinding(
    facts,
    "held-mint",
    mintable.length
      ? `${held.length} held token${held.length === 1 ? "" : "s"} still ha${held.length === 1 ? "s" : "ve"} a mint authority that can affect this wallet.`
      : `${held.length} held token${held.length === 1 ? "" : "s"} still ha${held.length === 1 ? "s" : "ve"} a freeze authority that can affect this wallet.`,
    mintable.length ? "elevated" : "watch",
    0.86,
    `${listed} ${held.length === 1 ? "is" : "are"} in this wallet. ${effects.join(" ")}${extra} Labelled mints such as USDC are not part of this check.`.replace(/\s+/g, " ").trim(),
    [],
    held.slice(0, 3).flatMap((token) => [token.mint, token.mintAuthority ?? "", token.freezeAuthority ?? ""]).filter(Boolean),
  );
}

function hopFinding(facts: WalletFacts): Finding {
  const hop = facts.hop;
  if (!hop) {
    return makeFinding(facts, "hop", "Deep scan found no inbound funding address in the opened transactions.", "note", 0.7, "Both ends of the window were opened. None of those transactions showed SOL arriving from another address.", []);
  }
  const name = lookupLabel(hop.address)?.name ?? shortAddress(hop.address);
  const oldest = facts.signatures[facts.signatures.length - 1];
  return makeFinding(
    facts,
    "hop",
    `Deep scan read the oldest funding address, ${name}.`,
    hop.lamports === 0 && hop.signatures === 0 ? "watch" : "note",
    0.8,
    `${name} holds ${formatSol(hop.lamports)}. A short read returned ${hop.signatures} signature${hop.signatures === 1 ? "" : "s"}. This is one hop, not the start of the wallet.`,
    oldest ? [oldest] : [],
    [hop.address],
  );
}

function activityFinding(facts: WalletFacts): Finding {
  return makeFinding(
    facts,
    "activity",
    facts.scanned ? `${facts.scanned} recent signatures were read.` : "No recent signatures came back.",
    "note",
    0.8,
    facts.historyComplete
      ? "Fewer signatures came back than the scan could request, so this is the visible history."
      : facts.mode === "deep"
        ? "Deep scan walks toward one year of signatures and samples interactions across that window. It still does not walk the entire chain."
        : "Quick read walks toward six months of signatures and samples interactions across that window.",
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
  const evidence: Evidence[] = [];
  for (const item of signatures.slice(0, 3)) {
    if (!item.signature) continue;
    evidence.push({
      kind: "transaction",
      signature: item.signature,
      slot: item.slot,
      time: item.blockTime ? formatTime(item.blockTime) : undefined,
      label: shortAddress(item.signature),
    });
  }
  for (const address of extraAddresses) {
    if (!isSolanaAddress(address) || evidence.some((item) => item.address === address)) continue;
    evidence.push({
      kind: "read",
      address,
      ...(facts.slot ? { slot: facts.slot } : {}),
      label: shortAddress(address),
    });
  }
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

function emptyWalletReport(
  facts: WalletFacts,
  intent: ReturnType<typeof detectIntent>,
  warnings: string[],
  tools: string[],
): Report {
  return finish({
    facts,
    score: 46,
    rules: [
      { id: "base", points: 22, detail: "Starting point for an unlabelled address" },
      { id: "no-history", points: 24, detail: "No signatures came back, so there is no behaviour to lower the score" },
    ],
    findings: [
      makeFinding(
        facts,
        "empty",
        "No transaction history in this scan. The score is 46.",
        "watch",
        0.9,
        `Balance is ${formatSol(facts.lamports)}. An empty balance does not remove the score. There are no signatures yet, so the number stays at 46 until there is behaviour to judge.`,
        [],
      ),
    ],
    intent,
    warnings,
    tools,
    span: 0,
  });
}

function windowTitle(facts: WalletFacts, oldest?: SignatureInfo): string {
  const aim = facts.mode === "deep" ? "one year" : "six months";
  if (facts.historyComplete && oldest?.blockTime) return `The visible history starts ${formatTime(oldest.blockTime)}.`;
  if (facts.ageReached && oldest?.blockTime) return `The oldest signature in this window is ${formatTime(oldest.blockTime)}, at least ${aim} back.`;
  return `This ${facts.mode === "deep" ? "deep scan" : "quick read"} covers ${facts.scanned} signatures and does not yet reach ${aim}.`;
}

function windowDetail(facts: WalletFacts, newest: SignatureInfo, oldest?: SignatureInfo): string {
  const aim = facts.mode === "deep" ? "one year" : "six months";
  const newestText = newest.blockTime ? `The newest is ${formatTime(newest.blockTime)}.` : "";
  const oldestText = oldest?.blockTime ? `The oldest in this window is ${formatTime(oldest.blockTime)}.` : "";
  const reach = facts.ageReached || facts.historyComplete
    ? `The scan reached its ${aim} aim, or the start of the visible history.`
    : `Activity is denser than this scan, so it stopped at ${facts.scanned} signatures. This is not the entire chain.`;
  const opened = facts.flows.length ? `${facts.flows.length} transactions were opened across the window to read interactions.` : "No transactions were opened.";
  return `${newestText} ${oldestText} Balance is ${formatSol(facts.lamports)}. ${reach} ${opened}`.replace(/\s+/g, " ").trim();
}

function activeDayCount(times: number[]): number {
  const days = new Set<string>();
  for (const time of times) days.add(new Date(time * 1000).toISOString().slice(0, 10));
  return days.size;
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
  const confidence = confidenceFor(facts, input.warnings.some((item) => item !== facts.rugcheckWarning));
  const typeGuess = guessType(facts, input.labelName, input.span);
  const summary = writtenSummary(facts, typeGuess, applied.score, band, findings[0]?.title);
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
  if (facts.hop) cited.add(facts.hop.address);
  for (const token of facts.solscan?.tokens ?? []) {
    if (token.address) cited.add(token.address);
  }
  return [...cited];
}

function leadFindings(facts: WalletFacts, findings: Finding[]): Finding[] {
  const lead = [restrictionFinding(facts), rugcheckFinding(facts), solscanFinding(facts)].filter((item): item is Finding => Boolean(item));
  const rank: Record<Severity, number> = { high: 0, elevated: 1, watch: 2, note: 3, clean: 4 };
  return [...lead, ...findings].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 9);
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
  if ((facts.historyComplete || facts.ageReached || facts.scanned >= 40) && span > 30 * 86400 && facts.flows.length >= 4) return "high";
  if (facts.executable && lookupLabel(facts.address)) return "high";
  return "medium";
}

function guessType(facts: WalletFacts, labelName: string | undefined, span: number): string {
  if (facts.restrictions?.self) return "Blocked address";
  if (labelName && facts.executable) return labelName;
  if (facts.executable) return "On-chain contract";
  if (facts.accountType === "mint") {
    const symbol = facts.mintSymbol || labelName;
    if (facts.mintTitle && symbol && facts.mintTitle !== symbol) return `${facts.mintTitle} (${symbol}) mint`;
    if (symbol) return `${symbol} mint`;
    return "Token mint";
  }
  if (labelName) return labelName;
  if (facts.scanned >= 15 && span > 0 && span < 6 * 3600) return "High-frequency address";
  if (facts.tokens.length >= 8) return "Active holder";
  if (!facts.scanned) return "Quiet address";
  if (facts.scanned < 5) return "New or quiet wallet";
  if (facts.ageReached && facts.ageTargetDays >= 365) return "Established wallet";
  if (facts.ageReached) return "Seasoned wallet";
  return "Active wallet";
}

function writtenSummary(facts: WalletFacts, typeGuess: string, score: number, band: Report["band"], lead?: string): string {
  if (facts.accountType === "mint" && facts.mintInfo) {
    const supply = formatRawUnits(facts.mintInfo.supply, facts.mintInfo.decimals);
    const burns = facts.flows.filter((flow) => flow.burnClose).length;
    const burnLine = burns
      ? `${burns} opened transaction${burns === 1 ? "" : "s"} can burn a holder balance and close the account.`
      : "None of the opened transactions burn the mint and close a holder account.";
    const authLine = facts.mintInfo.mintAuthority
      ? `Mint authority ${shortAddress(facts.mintInfo.mintAuthority)} can still create supply and dilute holders.`
      : facts.mintInfo.freezeAuthority
        ? "Mint authority is cleared, and that does not stop the freeze authority from freezing a holder."
        : "Mint authority and freeze authority are cleared.";
    return `${typeGuess}. Score ${score}, ${band}. Supply is ${supply} tokens. ${authLine} ${burnLine} ${lead ?? ""}`.replace(/\s+/g, " ").trim();
  }
  const held = heldAuthorityMints(facts);
  if (held.length) {
    const aim = facts.mode === "deep" ? "one year" : "six months";
    const reach = facts.historyComplete
      ? "The scan reached the start of the visible history."
      : facts.ageReached
        ? `The window reaches back at least ${aim}.`
        : facts.scanned
          ? `The window is ${facts.scanned} signatures, short of ${aim}, because activity is denser than the scan.`
          : "No signatures came back.";
    const names = held.slice(0, 2).map((token) => tokenLabel(token)).join(" and ");
    const effect = held.some((token) => token.mintAuthority)
      ? "A mint authority can still create more of that token and dilute the holding."
      : "A freeze authority can still freeze that balance so this wallet cannot move it.";
    return `${typeGuess}. Score ${score}, ${band}. ${reach} Balance is ${formatSol(facts.lamports)}. ${names} still ha${held.length === 1 ? "s" : "ve"} an authority that can affect this wallet. ${effect} ${lead ?? ""}`.replace(/\s+/g, " ").trim();
  }
  const aim = facts.mode === "deep" ? "one year" : "six months";
  const reach = facts.historyComplete
    ? "The scan reached the start of the visible history."
    : facts.ageReached
      ? `The window reaches back at least ${aim}.`
      : facts.scanned
        ? `The window is ${facts.scanned} signatures, short of ${aim}, because activity is denser than the scan.`
        : "No signatures came back.";
  const balance = `Balance is ${formatSol(facts.lamports)}, and that does not cancel the score.`;
  return `${typeGuess}. Score ${score}, ${band}. ${reach} ${balance} ${lead ?? ""}`.replace(/\s+/g, " ").trim();
}

function meaningFrom(findings: Finding[], band: Report["band"], facts: WalletFacts): string {
  const lead = findings[0]?.explanation ?? "";
  const opened = facts.accountType === "mint"
    ? facts.flows.length
      ? `${facts.flows.length} opened transactions are this mint's own history in the window.`
      : "No transaction was opened, so the mint's interactions are not in this read."
    : facts.flows.length
      ? `${facts.flows.length} opened transactions show who this address dealt with across the window.`
      : "No transaction was opened, so the interactions are not in this read.";
  return `The band is ${band}. ${lead} ${opened}`.replace(/\s+/g, " ").trim();
}

function nextStep(facts: WalletFacts, intent: ReturnType<typeof detectIntent>): string {
  if (facts.restrictions?.self) return "Treat the OFAC listing as the fact to act on. The behaviour score does not override it.";
  if (facts.accountType === "mint" && facts.mintInfo?.mintAuthority) return "The mint authority can still create supply. Do not add to this mint while that address can dilute holders.";
  if (facts.flows.some((flow) => flow.burnClose)) return facts.mintInfo?.freezeAuthority
    ? "Do not send value into this mint until you have read the burn-and-close transactions. Mint authority is cleared, and the freeze authority can still freeze a holder."
    : "Do not send value into this mint until you have read the burn-and-close transactions. Those transactions can remove a holder balance.";
  if (facts.accountType === "mint" && facts.mintInfo?.freezeAuthority) return "Mint authority is cleared. The freeze authority can still freeze a holder, so a cleared mint authority is not protection.";
  if (facts.rugcheck && facts.rugcheck.band !== "Good") return "Read the RugCheck risks before treating this mint as safe. That score is separate from the KaziTrust number.";
  if (heldAuthorityMints(facts).some((token) => token.mintAuthority)) return "A token in this wallet can still be minted. New supply can dilute that balance. Read that mint before you add to it.";
  if (heldAuthorityMints(facts).some((token) => token.freezeAuthority)) return "A token in this wallet can still be frozen. A freeze can stop this wallet from moving that balance, even if mint authority is cleared.";
  if (facts.tokens.some((token) => token.frozen)) return "A frozen token balance in this wallet cannot be moved until the freeze authority clears it.";
  if (facts.tokens.some((token) => token.delegate)) return "A delegate can move tokens out of this wallet without a new signature from this address. Match each delegate before you leave value there.";
  if (facts.restrictions?.counterparties.length) return "Open the matched address on its own before treating this wallet as unrelated to the listing.";
  if (facts.mode === "quick" && !facts.ageReached && !facts.historyComplete) return "Run a deep scan to push the window toward one year and read the oldest funding address.";
  if (facts.mode === "deep" && facts.hop) return "The deep scan checked one funding address. That hop is reported and does not add points by itself. A full index is still required to walk further back.";
  if (facts.mode === "deep" && !facts.historyComplete) return "This deep scan walked toward one year of signatures. It still does not walk the entire chain.";
  if (intent === "funding") return "Ask about the approvals or the contracts if you want the next layer of this read.";
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
  const list = [rugcheck, restrictions, ...ordered].filter((item): item is Visual => Boolean(item));
  if (facts.mode === "deep" && funding && !list.includes(funding)) list.unshift(funding);
  return list.slice(0, facts.mode === "deep" ? 4 : 3);
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
  if (report.mintAuthority) rows.push({ label: "Mint authority", state: "Set", detail: `${shortAddress(report.mintAuthority)} can create more supply. New tokens can dilute holders.` });
  else rows.push({ label: "Mint authority", state: "Cleared", detail: report.freezeAuthority ? "No mint authority is listed. That does not clear a freeze authority, and a holder can still be frozen." : "RugCheck reports no mint authority." });
  if (report.freezeAuthority) rows.push({ label: "Freeze authority", state: "Set", detail: `${shortAddress(report.freezeAuthority)} can freeze holder accounts. A frozen balance cannot be moved or sold.` });
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
        detail: other
          ? `${other.name} appears in the scanned flows, a delegate, or the funding address.`
          : screen
            ? "No listed counterparty in the opened window."
            : "Opened activity was not screened because the list could not be read.",
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
      ? labelForMint(facts, tokenSource.mint)
      : "No counterparty";
  const head = facts.historyComplete ? "First transaction" : "Oldest in scan";
  const hops = [
    ...(facts.hop
      ? [{ label: lookupLabel(facts.hop.address)?.name ?? shortAddress(facts.hop.address), detail: `${formatSol(facts.hop.lamports)}, ${facts.hop.signatures} signatures in the hop read` }]
      : []),
    { label: sourceLabel, detail: solSource || tokenSource ? "Inbound change" : "Not in this transaction" },
    { label: head, detail: oldestSig.blockTime ? formatTime(oldestSig.blockTime) : `Slot ${oldestSig.slot}` },
    { label: shortAddress(facts.address), detail: lookupLabel(facts.address)?.name ?? "Address under review" },
  ];
  return {
    type: "funding",
    caption: facts.hop
      ? "Deep scan sampled transactions across the window and read the oldest funding address. One hop only. The hop does not add points."
      : facts.historyComplete
        ? "The signature list ended before the cap, so this is the start of the visible history. One hop only."
        : "This is the oldest transaction inside the scanned window, not proof of the wallet's first funding.",
    hops,
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

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function isShortMint(label: string): boolean {
  return /^.{4}….{4}$/.test(label);
}

function holdingName(row: HoldingRow): string {
  if (row.name && row.name.toLowerCase() !== row.label.toLowerCase() && !isShortMint(row.label)) return `${row.label} (${row.name})`;
  return row.label;
}

function tokenPhrase(row: HoldingRow): string {
  if (isShortMint(row.label)) return `${row.amount} of ${row.label}`;
  return `${row.amount} ${holdingName(row)}`;
}

function holdingsCaption(rows: HoldingRow[], tokenCount: number): string {
  const native = rows.find((row) => row.label === "SOL");
  const tokens = rows.filter((row) => row.label !== "SOL");
  const priced = rows.filter((row) => row.amount.startsWith("$"));
  if (priced.length) {
    const units = rows.filter((row) => !row.amount.startsWith("$"));
    const money = `This address holds ${joinList(priced.map((row) => `${row.amount} of ${holdingName(row)}`))}.`;
    const biggest = priced.length > 1 ? ` ${holdingName(priced[0])} is the largest dollar value here.` : "";
    const extra = units.length ? ` Also on the address, in token units: ${joinList(units.map(tokenPhrase))}.` : "";
    return `${money}${biggest}${extra} The score still comes from the chain rules.`;
  }
  if (!tokens.length) return native ? `This address holds ${native.amount} and no token balance.` : "No balance was found on this address.";
  const lead = tokens.slice(0, 3).map(tokenPhrase);
  const other = tokenCount - lead.length;
  const parts: string[] = [];
  if (native) parts.push(native.amount);
  else parts.push("no SOL");
  parts.push(...lead);
  if (other === 1 && tokens[3]) parts.push(tokenPhrase(tokens[3]));
  else if (other > 0) parts.push(`${other} other token balance${other === 1 ? "" : "s"}`);
  const opening = `This address holds ${joinList(parts)}.`;
  const notes: string[] = [];
  if (tokens.length === 1) notes.push(`${holdingName(tokens[0])} is the only token balance, so its bar runs the full width. That length is the amount, not a dollar price.`);
  else {
    const longest = holdingName(tokens[0]);
    const shortest = holdingName(tokens[tokens.length - 1]);
    notes.push(longest === shortest ? "The bars compare these token amounts. Length is not a dollar price." : `${longest} has the longest bar. ${shortest} has the shortest. Length compares the amounts, not a dollar price.`);
  }
  const unnamed = tokens.filter((row) => isShortMint(row.label));
  if (unnamed.length === 1) notes.push(`${unnamed[0].label} has not published a name, so that row keeps the short mint.`);
  else if (unnamed.length > 1) notes.push(`${joinList(unnamed.slice(0, 3).map((row) => row.label))} have not published a name, so those rows keep the short mint.`);
  const frozen = tokens.filter((row) => row.flag === "Frozen");
  const delegated = tokens.filter((row) => row.flag === "Delegate set");
  if (frozen.length) notes.push(`${joinList(frozen.map((row) => holdingName(row)))} ${frozen.length === 1 ? "is" : "are"} frozen.`);
  if (delegated.length) notes.push(`A delegate is set on ${joinList(delegated.map((row) => holdingName(row)))}.`);
  const withLogo = tokens.filter((row) => row.logo);
  const missingLogo = tokens.some((row) => !row.logo);
  if (withLogo.length && missingLogo) notes.push(`${joinList(withLogo.slice(0, 3).map((row) => holdingName(row)))} ${withLogo.length === 1 ? "includes" : "include"} a published logo.`);
  return `${opening} ${notes.slice(0, 3).join(" ")}`.trim();
}

function holdingsVisual(facts: WalletFacts): Visual | null {
  const priced = facts.solscan;
  if (priced && (priced.tokens.length || priced.sol)) {
    const rows: HoldingRow[] = [];
    const pool = [...(priced.sol ? [priced.sol] : []), ...priced.tokens].sort((a, b) => b.value - a.value);
    const max = Math.max(...pool.map((row) => row.value), 0.0001);
    for (const token of pool.slice(0, 6)) {
      const chain = token.symbol === "SOL" ? undefined : matchToken(facts, token.symbol);
      rows.push({
        label: token.symbol,
        amount: `$${formatNumber(token.value, token.value >= 1000 ? 0 : 2)}`,
        pct: Math.max(8, Math.round((token.value / max) * 100)),
        ...holdingBits(token.symbol, chain),
      });
    }
    const seen = new Set(rows.map((row) => row.label));
    if (facts.lamports > 0 && !seen.has("SOL")) {
      rows.push({ label: "SOL", amount: formatSol(facts.lamports), pct: 8, mark: "sol" });
    }
    const extras = facts.tokens.filter((token) => {
      const label = tokenLabel(token);
      return !seen.has(label) && !seen.has(cleanFace(token.symbol)) && !seen.has(cleanFace(token.name));
    });
    const pick = extras.slice(0, 5);
    const smallest = extras[extras.length - 1];
    if (smallest && !pick.includes(smallest)) pick.push(smallest);
    for (const token of pick) {
      const label = tokenLabel(token);
      seen.add(label);
      rows.push({
        label,
        amount: token.amountText,
        pct: 8,
        ...holdingBits(label, token),
      });
    }
    return {
      type: "holdings",
      caption: holdingsCaption(rows, facts.tokens.length),
      rows,
    };
  }
  if (!facts.tokens.length && facts.lamports === 0) {
    return {
      type: "holdings",
      caption: "This address holds 0 SOL and no token balance. The score still uses the history that was read.",
      rows: [{ label: "SOL", amount: "0 SOL", pct: 8, mark: "sol" }],
    };
  }
  const rows: HoldingRow[] = [];
  if (facts.lamports > 0) rows.push({ label: "SOL", amount: formatSol(facts.lamports), pct: 100, mark: "sol" });
  const top = facts.tokens.slice(0, 6);
  const smallest = facts.tokens[facts.tokens.length - 1];
  if (smallest && !top.includes(smallest)) top.push(smallest);
  const max = Math.max(...top.map((row) => row.amount), 0.0001);
  for (const token of top) {
    const label = tokenLabel(token);
    rows.push({
      label,
      amount: token.amountText,
      pct: Math.max(8, Math.round((token.amount / max) * 100)),
      flag: token.delegate ? "Delegate set" : token.frozen ? "Frozen" : undefined,
      ...holdingBits(label, token),
    });
  }
  return {
    type: "holdings",
    caption: holdingsCaption(rows, facts.tokens.length),
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
      label: lookupLabel(address)?.name ?? (facts.tokens.some((token) => token.mint === address) ? labelForMint(facts, address) : shortAddress(address)),
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
      mint: tokenLabel(token),
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
          band: item.riskScore === null ? "Caution" : item.band ?? "Unscored",
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
