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
};

export type WalletActivity = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

export type WalletPortfolio = {
  address: string;
  lamports: number;
  sol: number;
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
    },
    ...splRows.map((row) => {
      const face = faces.get(row.mint);
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
      };
    }),
  ];

  return {
    address,
    lamports,
    sol,
    holdings,
    activity: (signatures || []).map((item) => ({
      signature: item.signature,
      slot: item.slot,
      err: item.err ?? null,
      blockTime: item.blockTime ?? null,
    })),
    updatedAt: Date.now(),
  };
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
