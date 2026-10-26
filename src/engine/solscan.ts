import { getAccessToken } from "@privy-io/react-auth";

export type SolscanToken = {
  address: string;
  symbol: string;
  balance: number;
  value: number;
};

export type SolscanBook = {
  label?: string;
  tags: string[];
  domain?: string;
  activeAge?: number;
  fundedBy?: string;
  totalValue?: number;
  sol?: SolscanToken;
  tokens: SolscanToken[];
  positions: number;
  activities: { type: string; time?: number }[];
};

const ACTIVITY: Record<string, string> = {
  ACTIVITY_TOKEN_SWAP: "a swap",
  ACTIVITY_AGG_TOKEN_SWAP: "a swap",
  ACTIVITY_TOKEN_ADD_LIQ: "a liquidity add",
  ACTIVITY_TOKEN_REMOVE_LIQ: "a liquidity removal",
  ACTIVITY_POOL_CREATE: "a pool creation",
  ACTIVITY_SPL_TOKEN_STAKE: "a stake",
  ACTIVITY_LST_STAKE: "a stake",
  ACTIVITY_SPL_TOKEN_UNSTAKE: "an unstake",
  ACTIVITY_LST_UNSTAKE: "an unstake",
  ACTIVITY_TOKEN_DEPOSIT_VAULT: "a vault deposit",
  ACTIVITY_TOKEN_WITHDRAW_VAULT: "a vault withdrawal",
  ACTIVITY_SPL_INIT_MINT: "a mint creation",
  ACTIVITY_ORDERBOOK_ORDER_PLACE: "an order",
  ACTIVITY_BORROWING: "a borrow",
  ACTIVITY_REPAY_BORROWING: "a repayment",
  ACTIVITY_LIQUIDATE_BORROWING: "a liquidation",
  ACTIVITY_BRIDGE_ORDER_IN: "a bridge in",
  ACTIVITY_BRIDGE_ORDER_OUT: "a bridge out",
};

export type SolscanRead = {
  book: SolscanBook | null;
  warning?: string;
};

export async function readSolscan(address: string, signal: AbortSignal): Promise<SolscanRead> {
  const [portfolio, metadata, activities] = await Promise.all([
    get("account/portfolio", address, signal),
    get("account/metadata", address, signal),
    get("account/defi/activities", address, signal),
  ]);
  const calls = [portfolio, metadata, activities];
  if (calls.every((item) => item.data == null)) return { book: null };
  const book: SolscanBook = { tags: [], tokens: [], positions: 0, activities: [] };
  if (portfolio.data) readPortfolio(portfolio.data, book);
  if (metadata.data) readMetadata(metadata.data, book);
  if (activities.data) readActivities(activities.data, book);
  return { book };
}

async function get(path: string, address: string, signal: AbortSignal): Promise<{ data: unknown; message: string }> {
  try {
    const headers: Record<string, string> = {};
    if (!import.meta.env.DEV) {
      const token = await getAccessToken();
      if (!token) return { data: null, message: "Sign in before a query." };
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetch(`/api/solscan?path=${encodeURIComponent(path)}&address=${encodeURIComponent(address)}`, { signal, headers });
    const body = (await response.json()) as { success?: boolean; data?: unknown; errors?: { message?: string }; error?: string };
    const message = body.errors?.message || body.error || "";
    if (!response.ok || !body.success || body.data == null) return { data: null, message };
    return { data: body.data, message: "" };
  } catch {
    return { data: null, message: "Solscan did not answer." };
  }
}

function readPortfolio(data: unknown, book: SolscanBook) {
  const record = asRecord(data);
  if (!record) return;
  if (typeof record.total_value === "number") book.totalValue = record.total_value;
  const native = asRecord(record.native_balance);
  const sol = native ? tokenFrom(native, "So11111111111111111111111111111111111111112") : null;
  if (sol) book.sol = sol;
  const tokens = Array.isArray(record.tokens) ? record.tokens : [];
  book.tokens = tokens
    .map((item) => {
      const row = asRecord(item);
      return row ? tokenFrom(row, typeof row.token_address === "string" ? row.token_address : "") : null;
    })
    .filter((item): item is SolscanToken => Boolean(item?.address))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  book.positions = Array.isArray(record.positions) ? record.positions.length : 0;
}

function readMetadata(data: unknown, book: SolscanBook) {
  const record = asRecord(data);
  if (!record) return;
  if (typeof record.account_label === "string" && record.account_label.trim()) book.label = record.account_label.trim();
  if (Array.isArray(record.account_tags)) book.tags = record.account_tags.filter((item): item is string => typeof item === "string").slice(0, 4);
  else if (typeof record.account_tags === "string" && record.account_tags) book.tags = [record.account_tags];
  if (typeof record.account_domain === "string" && record.account_domain) book.domain = record.account_domain;
  if (typeof record.active_age === "number") book.activeAge = record.active_age;
  const funded = asRecord(record.funded_by);
  if (funded && typeof funded.funded_by === "string") book.fundedBy = funded.funded_by;
}

function readActivities(data: unknown, book: SolscanBook) {
  const rows = Array.isArray(data) ? data : [];
  book.activities = rows.slice(0, 10).flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.activity_type !== "string") return [];
    const type = ACTIVITY[row.activity_type] ?? "a DeFi activity";
    return [{ type, time: typeof row.block_time === "number" ? row.block_time : undefined }];
  });
}

function tokenFrom(row: Record<string, unknown>, address: string): SolscanToken | null {
  const symbol = typeof row.token_symbol === "string" ? row.token_symbol : "";
  const balance = typeof row.balance === "number" ? row.balance : 0;
  const value = typeof row.value === "number" ? row.value : 0;
  if (!address && !symbol) return null;
  return { address, symbol: symbol || "Token", balance, value };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
