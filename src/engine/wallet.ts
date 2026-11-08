import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { TOKEN_2022, TOKEN_PROGRAM } from "./labels";
import { rpc, RpcError } from "./rpc";
import { readTokenFaces, type TokenFace } from "./tokenmeta";
import { formatRawUnits, shortAddress } from "../format";

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const FEE_BUFFER_LAMPORTS = 10_000;
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export type WalletHolding = {
  id: string;
  kind: "sol" | "spl";
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  amountText: string;
  decimals: number;
  raw: string;
  tokenAccount?: string;
  programId: string;
  image?: string;
  solValue?: number;
  solValueText?: string;
};

export type WalletActivity = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
  failed: boolean;
  direction: "in" | "out" | "unknown";
  title: string;
  detail: string;
  amountText?: string;
  symbol?: string;
  image?: string;
};

export type WalletPortfolio = {
  address: string;
  lamports: number;
  sol: number;
  totalSolValue: number;
  totalSolValueText: string;
  holdings: WalletHolding[];
  activity: WalletActivity[];
  updatedAt: number;
};

export type SendDraft = {
  mint: string;
  kind: "sol" | "spl";
  to: string;
  amount: string;
  decimals: number;
  symbol: string;
  tokenAccount?: string;
  programId: string;
};

export function isSolanaAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

export function explainWalletError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The wallet action did not complete.";
  const text = raw.toLowerCase();

  if (/user rejected|user denied|rejected the request|cancelled|canceled|exited/i.test(raw)) {
    return "You cancelled the signature. Nothing was sent.";
  }
  if (/insufficient (funds|lamports)|Attempt to debit an account but found no record of a prior credit/i.test(raw)) {
    return "Not enough SOL to cover the amount and network fee. Add SOL, then try again.";
  }
  if (/blockhash not found|block height exceeded|expired/i.test(text)) {
    return "The network fee window expired. Refresh and send again.";
  }
  if (/invalid public key|invalid address|non-base58/i.test(text)) {
    return "That destination address is not a valid Solana address.";
  }
  if (/could not find account|account does not exist|invalid account data/i.test(text)) {
    return "A required token account is missing or unreadable. Try again, or receive that token first.";
  }
  if (/simulation failed|Transaction simulation failed/i.test(raw)) {
    return "The network rejected a preview of this transfer. Check the amount, destination, and SOL for fees.";
  }
  if (/429|rate|too many/i.test(text)) {
    return "The Solana node is busy. Wait a moment and try again.";
  }
  if (/offline|failed to fetch|networkerror|did not answer/i.test(text)) {
    return "The chain connection dropped. Check your network and refresh the wallet.";
  }
  if (/no wallet|wallet not found|not authenticated/i.test(text)) {
    return "Your Solana wallet is not ready yet. Sign in again, then wait for the embedded wallet to finish creating.";
  }
  if (error instanceof RpcError) return error.message;
  return raw.slice(0, 180) || "The wallet action did not complete.";
}

export async function loadWalletPortfolio(address: string, signal: AbortSignal): Promise<WalletPortfolio> {
  if (!isSolanaAddress(address)) throw new Error("Wallet address is not valid.");

  const [balance, tokenLegacy, token2022, signatures] = await Promise.all([
    rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }], signal),
    rpcTokenAccounts(address, TOKEN_PROGRAM, signal),
    rpcTokenAccounts(address, TOKEN_2022, signal),
    rpc<
      { signature: string; slot: number; err: unknown; blockTime: number | null }[]
    >("getSignaturesForAddress", [address, { limit: 12, commitment: "confirmed" }], signal),
  ]);

  const lamports = balance.value ?? 0;
  const sol = lamports / 1e9;
  const splRows = [...parseTokenRows(tokenLegacy, TOKEN_PROGRAM), ...parseTokenRows(token2022, TOKEN_2022)];
  const faces = await readTokenFaces(
    splRows.map((row) => row.mint),
    signal,
  ).catch(() => new Map<string, TokenFace>());

  const priceMints = splRows.map((row) => row.mint);
  const usdPrices = await readUsdPrices(priceMints, signal).catch(() => new Map<string, number>());
  const solUsd = usdPrices.get(WSOL_MINT) || 0;

  const holdings: WalletHolding[] = [
    {
      id: "sol",
      kind: "sol",
      mint: "SOL",
      symbol: "SOL",
      name: "Solana",
      amount: sol,
      amountText: formatAmount(sol, 9),
      decimals: 9,
      raw: String(lamports),
      programId: SystemProgram.programId.toBase58(),
      image: "/logos/solana.svg",
      solValue: sol,
      solValueText: formatSolValue(sol),
    },
    ...splRows.map((row) => {
      const face = faces.get(row.mint);
      const tokenUsd = usdPrices.get(row.mint);
      const solValue = tokenUsd && solUsd > 0 ? (row.amount * tokenUsd) / solUsd : undefined;
      return {
        id: row.tokenAccount,
        kind: "spl" as const,
        mint: row.mint,
        symbol: face?.symbol || shortAddress(row.mint),
        name: face?.name || "Token",
        amount: row.amount,
        amountText: row.amountText,
        decimals: row.decimals,
        raw: row.raw,
        tokenAccount: row.tokenAccount,
        programId: row.programId,
        image: face?.image,
        ...(solValue != null
          ? { solValue, solValueText: formatSolValue(solValue) }
          : {}),
      };
    }),
  ];

  const totalSolValue = holdings.reduce((sum, holding) => sum + (holding.solValue ?? 0), 0);
  const activity = await readWalletActivity(address, signatures || [], faces, signal).catch(() =>
    (signatures || []).map((item) => bareActivity(item)),
  );

  return {
    address,
    lamports,
    sol,
    totalSolValue,
    totalSolValueText: formatSolValue(totalSolValue),
    holdings,
    activity,
    updatedAt: Date.now(),
  };
}

export function applyOptimisticSend(portfolio: WalletPortfolio, draft: SendDraft): WalletPortfolio {
  const amount = Number(draft.amount.trim().replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return portfolio;
  const holdings = portfolio.holdings.map((holding) => {
    const match =
      draft.kind === "sol"
        ? holding.kind === "sol"
        : holding.kind === "spl" && (holding.mint === draft.mint || holding.tokenAccount === draft.tokenAccount);
    if (!match) return holding;
    const nextAmount = Math.max(0, holding.amount - amount);
    const ratio = holding.amount > 0 && holding.solValue != null ? holding.solValue / holding.amount : undefined;
    const solValue = ratio == null ? holding.solValue : nextAmount * ratio;
    return {
      ...holding,
      amount: nextAmount,
      amountText: formatAmount(nextAmount, holding.decimals),
      ...(solValue != null ? { solValue, solValueText: formatSolValue(solValue) } : {}),
    };
  });
  const totalSolValue = holdings.reduce((sum, holding) => sum + (holding.solValue ?? 0), 0);
  const solHolding = holdings.find((holding) => holding.kind === "sol");
  return {
    ...portfolio,
    holdings,
    sol: solHolding?.amount ?? portfolio.sol,
    lamports: Math.max(0, Math.round((solHolding?.amount ?? portfolio.sol) * 1e9)),
    totalSolValue,
    totalSolValueText: formatSolValue(totalSolValue),
    updatedAt: Date.now(),
  };
}

async function readUsdPrices(mints: string[], signal: AbortSignal): Promise<Map<string, number>> {
  const ids = [...new Set([WSOL_MINT, ...mints.filter(Boolean)])].slice(0, 40);
  const prices = new Map<string, number>();
  if (!ids.length) return prices;
  const response = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids.map(encodeURIComponent).join(",")}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) return prices;
  const body = (await response.json()) as Record<string, { usdPrice?: number } | null>;
  for (const [mint, row] of Object.entries(body || {})) {
    if (typeof row?.usdPrice === "number" && Number.isFinite(row.usdPrice) && row.usdPrice > 0) {
      prices.set(mint, row.usdPrice);
    }
  }
  return prices;
}

function formatSolValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.0001) return "<0.0001";
  if (value < 1) return value.toFixed(4).replace(/\.?0+$/, "");
  if (value < 1000) return value.toFixed(3).replace(/\.?0+$/, "");
  return formatAmount(value, 2);
}

type SignatureRow = { signature: string; slot: number; err: unknown; blockTime: number | null };

function bareActivity(item: SignatureRow): WalletActivity {
  return {
    signature: item.signature,
    slot: item.slot,
    err: item.err ?? null,
    blockTime: item.blockTime ?? null,
    failed: Boolean(item.err),
    direction: "unknown",
    title: item.err ? "Failed transaction" : "Transaction",
    detail: shortAddress(item.signature),
  };
}

async function readWalletActivity(
  address: string,
  signatures: SignatureRow[],
  faces: Map<string, TokenFace>,
  signal: AbortSignal,
): Promise<WalletActivity[]> {
  const rows = signatures.slice(0, 10);
  const parsed = await Promise.all(
    rows.map(async (item) => {
      try {
        const tx = await rpc<ParsedTx | null>(
          "getTransaction",
          [item.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
          signal,
        );
        if (!tx) return bareActivity(item);
        return describeActivity(address, item, tx, faces);
      } catch (error) {
        if (signal.aborted) throw error;
        return bareActivity(item);
      }
    }),
  );
  return parsed;
}

type ParsedTx = {
  meta?: {
    err?: unknown;
    fee?: number;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
  } | null;
  transaction?: {
    message?: {
      accountKeys?: (string | { pubkey: string; signer?: boolean })[];
    };
  };
};

function accountKey(tx: ParsedTx, index: number): string {
  const key = tx.transaction?.message?.accountKeys?.[index];
  if (!key) return "";
  return typeof key === "string" ? key : key.pubkey;
}

function describeActivity(address: string, item: SignatureRow, tx: ParsedTx, faces: Map<string, TokenFace>): WalletActivity {
  const failed = Boolean(tx.meta?.err ?? item.err);
  const pre = tx.meta?.preBalances ?? [];
  const post = tx.meta?.postBalances ?? [];
  let selfIndex = -1;
  for (let i = 0; i < Math.max(pre.length, post.length); i += 1) {
    if (accountKey(tx, i) === address) selfIndex = i;
  }

  const tokenDelta = new Map<string, number>();
  const before = new Map<string, number>();
  for (const row of tx.meta?.preTokenBalances ?? []) {
    if (row.owner !== address) continue;
    before.set(row.mint, Number(row.uiTokenAmount?.uiAmount ?? 0));
  }
  for (const row of tx.meta?.postTokenBalances ?? []) {
    if (row.owner !== address) continue;
    const next = Number(row.uiTokenAmount?.uiAmount ?? 0);
    const prev = before.get(row.mint) ?? 0;
    const change = next - prev;
    if (Math.abs(change) > 0) tokenDelta.set(row.mint, (tokenDelta.get(row.mint) ?? 0) + change);
  }
  for (const [mint, prev] of before) {
    if (!tokenDelta.has(mint) && !(tx.meta?.postTokenBalances ?? []).some((row) => row.owner === address && row.mint === mint)) {
      tokenDelta.set(mint, -prev);
    }
  }

  const tokenMoves = [...tokenDelta.entries()]
    .map(([mint, change]) => ({ mint, change }))
    .filter((row) => Math.abs(row.change) > 0)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  let solDelta = 0;
  if (selfIndex >= 0) solDelta = ((post[selfIndex] ?? 0) - (pre[selfIndex] ?? 0)) / 1e9;

  const base = bareActivity(item);
  base.failed = failed;
  if (failed) {
    base.title = "Failed transfer";
    base.detail = "This transaction did not land";
    return base;
  }

  if (tokenMoves[0]) {
    const move = tokenMoves[0];
    const face = faces.get(move.mint);
    const symbol = face?.symbol || shortAddress(move.mint);
    const inbound = move.change > 0;
    base.direction = inbound ? "in" : "out";
    base.symbol = symbol;
    base.image = face?.image;
    base.amountText = `${inbound ? "+" : "−"}${formatAmount(Math.abs(move.change), 6)} ${symbol}`;
    base.title = inbound ? `Received ${symbol}` : `Sent ${symbol}`;
    base.detail = inbound ? "Token credited to this wallet" : "Token left this wallet";
    return base;
  }

  if (Math.abs(solDelta) >= 0.000005) {
    const inbound = solDelta > 0;
    base.direction = inbound ? "in" : "out";
    base.symbol = "SOL";
    base.image = "/logos/solana.svg";
    base.amountText = `${inbound ? "+" : "−"}${formatAmount(Math.abs(solDelta), 9)} SOL`;
    base.title = inbound ? "Received SOL" : "Sent SOL";
    base.detail = inbound ? "SOL credited to this wallet" : "SOL left this wallet";
    return base;
  }

  base.title = "Wallet activity";
  base.detail = "Confirmed on Solana";
  return base;
}

type TokenParse = {
  mint: string;
  tokenAccount: string;
  amount: number;
  amountText: string;
  decimals: number;
  raw: string;
  programId: string;
};

async function rpcTokenAccounts(owner: string, programId: string, signal: AbortSignal) {
  return rpc<{
    value: { pubkey: string; account: { data?: { parsed?: { info?: Record<string, unknown> } } } }[];
  }>("getTokenAccountsByOwner", [owner, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }], signal);
}

function parseTokenRows(
  batch: { value: { pubkey: string; account: { data?: { parsed?: { info?: Record<string, unknown> } } } }[] },
  programId: string,
): TokenParse[] {
  const rows: TokenParse[] = [];
  for (const item of batch.value ?? []) {
    const info = item.account?.data?.parsed?.info;
    if (!info) continue;
    const tokenAmount = info.tokenAmount as { amount?: string; decimals?: number; uiAmountString?: string } | undefined;
    const raw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
    if (/^0+$/.test(raw.replace("-", ""))) continue;
    const decimals = typeof tokenAmount?.decimals === "number" ? tokenAmount.decimals : 0;
    const amountText =
      tokenAmount?.uiAmountString && !/^0+(?:\.0+)?$/.test(tokenAmount.uiAmountString)
        ? tokenAmount.uiAmountString
        : formatRawUnits(raw, decimals);
    rows.push({
      mint: String(info.mint ?? ""),
      tokenAccount: item.pubkey,
      amount: Number(amountText) || 0,
      amountText,
      decimals,
      raw,
      programId,
    });
  }
  return rows;
}

function formatAmount(value: number, max = 6): string {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";
  if (value > 0 && value < 1e-6) return value.toExponential(2);
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: max }).format(value);
}

export function parseSendAmount(amount: string, decimals: number): bigint {
  const clean = amount.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("Enter a valid amount.");
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > decimals) throw new Error(`Use at most ${decimals} decimal places.`);
  const padded = `${whole}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "") || "0";
  const value = BigInt(padded);
  if (value <= 0n) throw new Error("Enter an amount greater than zero.");
  return value;
}

export async function buildTransferTransaction(input: {
  from: string;
  draft: SendDraft;
  availableLamports: number;
}): Promise<{ transaction: Uint8Array; summary: string }> {
  const from = new PublicKey(input.from);
  const toRaw = input.draft.to.trim();
  if (!isSolanaAddress(toRaw)) throw new Error("That destination address is not a valid Solana address.");
  if (toRaw === input.from) throw new Error("Choose a different destination than your own wallet.");

  const to = new PublicKey(toRaw);
  const amount = parseSendAmount(input.draft.amount, input.draft.decimals);
  const { blockhash } = await latestBlockhash();
  const ixs: TransactionInstruction[] = [];

  if (input.draft.kind === "sol") {
    if (amount + BigInt(FEE_BUFFER_LAMPORTS) > BigInt(input.availableLamports)) {
      throw new Error("Not enough SOL to cover the amount and network fee. Add SOL, then try again.");
    }
    ixs.push(
      SystemProgram.transfer({
        fromPubkey: from,
        toPubkey: to,
        lamports: Number(amount),
      }),
    );
  } else {
    const mint = new PublicKey(input.draft.mint);
    const programId = new PublicKey(input.draft.programId || TOKEN_PROGRAM_ID.toBase58());
    if (programId.equals(TOKEN_PROGRAM_ID) === false && programId.equals(TOKEN_2022_PROGRAM_ID) === false) {
      throw new Error("That token program is not supported for sends yet.");
    }
    const sourceAta =
      input.draft.tokenAccount ||
      getAssociatedTokenAddressSync(mint, from, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID).toBase58();
    const destAta = getAssociatedTokenAddressSync(mint, to, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(from, destAta, to, mint, programId, ASSOCIATED_TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(new PublicKey(sourceAta), mint, destAta, from, amount, input.draft.decimals, [], programId),
    );
    if (input.availableLamports < FEE_BUFFER_LAMPORTS) {
      throw new Error("Not enough SOL to pay the network fee for this token transfer.");
    }
  }

  const tx = new Transaction();
  tx.feePayer = from;
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const summary =
    input.draft.kind === "sol"
      ? `Send ${input.draft.amount} SOL to ${shortAddress(toRaw)}`
      : `Send ${input.draft.amount} ${input.draft.symbol} to ${shortAddress(toRaw)}`;
  return { transaction, summary };
}

export function signatureFromBytes(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

export async function waitForSignature(signature: string, signal: AbortSignal, tries = 16): Promise<"confirmed" | "failed" | "pending"> {
  for (let i = 0; i < tries; i += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await rpc<{
      value: ({ confirmationStatus?: string | null; err: unknown } | null)[];
    }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }], signal);
    const status = result.value?.[0];
    if (status?.err) return "failed";
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
    await sleep(900);
  }
  return "pending";
}

async function latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const result = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    AbortSignal.timeout(12000),
  );
  if (!result.value?.blockhash) throw new RpcError("The public Solana nodes did not answer. Try the read again.");
  return result.value;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function explorerTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function explorerAddress(address: string): string {
  return `https://solscan.io/account/${address}`;
}
