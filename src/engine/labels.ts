export type LabelCategory = "program" | "mint" | "system";

export type KnownLabel = {
  address: string;
  name: string;
  category: LabelCategory;
  note: string;
};

export const LABELS: KnownLabel[] = [
  {
    address: "11111111111111111111111111111111",
    name: "System contract",
    category: "program",
    note: "Solana system contract",
  },
  {
    address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    name: "SPL Token",
    category: "program",
    note: "SPL token contract",
  },
  {
    address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    name: "Token-2022",
    category: "program",
    note: "Token extensions contract",
  },
  {
    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    name: "Associated token account",
    category: "program",
    note: "Creates associated token accounts",
  },
  {
    address: "ComputeBudget111111111111111111111111111111",
    name: "Compute budget",
    category: "program",
    note: "Sets compute unit price and limit",
  },
  {
    address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    name: "Memo",
    category: "program",
    note: "Memo contract",
  },
  {
    address: "Stake11111111111111111111111111111111111111",
    name: "Stake",
    category: "program",
    note: "Native staking contract",
  },
  {
    address: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    name: "Jupiter v6",
    category: "program",
    note: "Jupiter aggregator contract",
  },
  {
    address: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    name: "Raydium AMM v4",
    category: "program",
    note: "Raydium liquidity pools",
  },
  {
    address: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
    name: "Orca Whirlpool",
    category: "program",
    note: "Orca concentrated liquidity",
  },
  {
    address: "So11111111111111111111111111111111111111112",
    name: "Wrapped SOL",
    category: "mint",
    note: "Native SOL wrapped as an SPL mint",
  },
  {
    address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    name: "USDC",
    category: "mint",
    note: "USD Coin mint on Solana",
  },
  {
    address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    name: "USDT",
    category: "mint",
    note: "Tether USD mint on Solana",
  },
];

const BY_ADDRESS = new Map(LABELS.map((label) => [label.address, label]));

export function lookupLabel(address: string): KnownLabel | undefined {
  return BY_ADDRESS.get(address);
}

export function programName(address: string): string {
  return BY_ADDRESS.get(address)?.name ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function mintName(address: string): string {
  return BY_ADDRESS.get(address)?.name ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export const EXAMPLE_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const EXAMPLE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export const SCORING_VERSION = "0.3.0";

export const RULE_CATALOG: { title: string; detail: string }[] = [
  {
    title: "Base",
    detail: "An unlabelled address starts at 22. The number moves only when a rule below fires.",
  },
  {
    title: "Thin history",
    detail: "One to four signatures in the scan adds 12. There is not much public behaviour to judge.",
  },
  {
    title: "Long history",
    detail: "Twelve or more signatures reaching back at least six months subtracts 6. Twenty or more reaching back at least a year subtracts 10. A shorter span of 30 days, with twenty signatures, subtracts 4.",
  },
  {
    title: "Empty balance",
    detail: "A balance of 0 SOL never removes the score. After five or more signatures it adds 8. With no signatures, the score is 46.",
  },
  {
    title: "Active days",
    detail: "Activity on 30 or more days subtracts 4. A span of at least six months that falls on three days or fewer adds 10.",
  },
  {
    title: "Failed signatures",
    detail: "If 10 or more signatures were scanned and at least 35 percent failed, add 8. Opened transactions still add 12 at half failed, or 6 at a quarter, when the wider rate did not fire.",
  },
  {
    title: "Bunched activity",
    detail: "Fifteen or more signatures inside six hours adds 26. Inside two days, it adds 14.",
  },
  {
    title: "Failed transactions",
    detail: "If at least four parsed transactions failed half the time, add 12. A quarter, add 6.",
  },
  {
    title: "Delegates",
    detail: "An open token delegate adds 14. A clean delegate check on a wallet subtracts 6.",
  },
  {
    title: "Frozen token account",
    detail: "A frozen token account adds 10.",
  },
  {
    title: "Single counterparty",
    detail: "Three or more scanned flows with one counterparty adds 10. If one address is at least 70 percent of a wider set, add 8.",
  },
  {
    title: "Broad counterparties",
    detail: "Eight or more counterparties in the opened transactions subtracts 4.",
  },
  {
    title: "Contract spread",
    detail: "Six or more distinct contracts in the parsed set subtracts 4.",
  },
  {
    title: "Known contract or mint",
    detail: "A labelled contract is held at 8. A labelled mint is held at 10. An unlabelled executable contract is held at 18.",
  },
  {
    title: "Unread token accounts",
    detail: "If token accounts cannot be fetched for a wallet, add 4 and lower confidence.",
  },
  {
    title: "Blocked address",
    detail: "If the address is on the current OFAC SDN list as a Solana digital currency address, the score is set to 96. The other behaviour rules do not dilute that listing.",
  },
  {
    title: "Blocked counterparty",
    detail: "If an opened transaction or a token delegate names a different SDN address, add 30. The wallet itself is not treated as listed.",
  },
];
