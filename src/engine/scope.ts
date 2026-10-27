import { extractAddresses } from "./address";

const OTHER_ADDRESS = /\b(email|e-mail|ip|home|mailing|street|postal) address(?:es)?\b/gi;

const HARD_MISUSE = [
  /\b(ignore|disregard|forget)\b.{0,48}\b(instructions?|rules|prompt)\b/i,
  /\b(jailbreak|developer mode|system prompt)\b/i,
  /\b(write|draft|compose|generate|make me|give me)\b.{0,48}\b(poem|lyrics|song|joke|recipe|essay|email|e-mail|novel|code|script|function|homework|resume|cover letter|tweet|haiku|rap|article|blog)\b/i,
  /\b(python|javascript|typescript|sql|html|css)\b.{0,24}\b(script|function|code|snippet)\b/i,
  /\b(roleplay|act as|pretend to be)\b/i,
  /\b(homework|weather forecast|stock price|bitcoin price|medical advice|tax advice|legal advice|workout plan|diet plan)\b/i,
  /\b(how (?:do|can|to) i|help me|show me how)\b.{0,40}\b(exploit|hack|drain|rug)\b/i,
];

const STORY_REQUEST = /\b(write|draft|compose|generate)\b.{0,48}\bstory\b/i;

const STRONG = [
  /\b(wallets?|pubkeys?|public keys?)\b/i,
  /\b(solana|\bsol\b|lamports?|mainnet|devnet)\b/i,
  /\b(mints?|tokens?|\bspl\b|nfts?|token-?2022|\bata\b|associated token)\b/i,
  /\b(contracts?|programs?|\bpdas?\b|\bidl\b|instructions?|\bix\b)\b/i,
  /\b(transactions?|signatures?|\btx\b|\btxs\b)\b/i,
  /\b(scores?|scoring|findings?|caution|kazitrust|watchlist)\b/i,
  /\b(delegates?|approvals?)\b/i,
  /\b(fund(?:ing|ed|er)?|hops?|counterpart(?:y|ies))\b/i,
  /\b(deployers?|jupiter|usdc|raydium|meteora|marinade|jito|pump\.fun|pumpfun)\b/i,
  /\b(drained?|rugs?|rugged|honeypots?|exploits?|exploited|hacks?|hacked|scams?|phish(?:ing)?)\b/i,
  /\b(fresh wallet|rent exempt)\b/i,
];

const WEAK = [
  /\b(accounts?|signers?|fee payers?|cluster|anchor|freeze|authorit(?:y|ies)|revoke|allowances?)\b/i,
  /\b(trace|traced|holders?|balances?|orca|drift|pump|burner|sybil|wash trad\w*|snipers?|bundles?|\bdust\b)\b/i,
];

const EXEMPT = [
  /\b(funding|wallet|contract|mint|transaction|funds|money)\b.{0,32}\bstory\b/i,
  /\bstory\b.{0,32}\b(funding|wallet|contract|mint|transaction|funds|money)\b/i,
  /\b(translate|decode)\b.{0,32}\b(transaction|instruction|ix|log)\b/i,
  /\bwho (sent|paid|funded|signed)\b(?![^.?\n]{0,24}\b(?:e-?mail|letter)\b)/i,
  /\bwho owns (this|it|the wallet|the mint|the contract|the program)\b/i,
  /\bwhere did (it|this|the sol|the funds|the money)\b.{0,24}\b(go|come from|land)\b/i,
  /\bcan they (take|move|freeze|drain|close) (it|this|the sol|the tokens|the funds)\b/i,
  /\bis (this|it) (a scam|a rug)\b/i,
  /\bfollow the (money|funds|sol)\b/i,
];

const PRODUCT =
  /\b(what can you do|how does this work|what do you read|how is the score built|scoring method|how do you score|illustrative|sample deployer)\b/i;

const SHORT =
  /^(why|explain|explain that|what does that mean|say more|go on|compare them|and the other|the other one|this one|that one|both|deeper|go deeper|the deployer|the mint|the funder|who funded it|is it safe|should i trust it|what happened|in plain language|the first hop|the funding hop)\b/i;

export const OUT_OF_SCOPE =
  "KaziTrust only reads Solana wallets, mints, and contracts, and explains those reads. Ask for one of those, or about how a score is built.";

export function mentionsWalletWork(text: string): boolean {
  return domainScore(text) > 0 || extractAddresses(text).length > 0 || hasSignature(text);
}

export function walletQuestionAllowed(text: string, hasContext: boolean): boolean {
  if (asksForOtherWork(text) && extractAddresses(text).length === 0 && !hasSignature(text)) return false;
  if (extractAddresses(text).length > 0 || hasSignature(text)) return true;
  if (PRODUCT.test(text) || domainScore(text) > 0) return true;
  return hasContext && softFollowup(text);
}

export function wordingSpendAllowed(kind: string | undefined, question: string, facts: unknown, context = ""): boolean {
  if (asksForOtherWork(context)) return false;
  if (kind === "explain") return readFacts(facts);
  if (asksForOtherWork(question) || STORY_REQUEST.test(question)) return false;
  return walletQuestionAllowed(question, false);
}

export function modelQuestion(text: string): string {
  if (asksForOtherWork(text)) return "Explain this wallet read.";
  return text.slice(0, 500);
}

function asksForOtherWork(text: string): boolean {
  if (HARD_MISUSE.some((pattern) => pattern.test(text))) return true;
  if (!STORY_REQUEST.test(text)) return false;
  const aboutARead = EXEMPT.some((pattern) => pattern.test(text)) && (extractAddresses(text).length > 0 || hasSignature(text));
  return !aboutARead;
}

function domainScore(text: string): number {
  const stripped = text.replace(OTHER_ADDRESS, " ");
  let strong = 0;
  let weak = 0;
  for (const pattern of STRONG) {
    if (pattern.test(stripped)) strong += 1;
  }
  for (const pattern of WEAK) {
    if (pattern.test(stripped)) weak += 1;
  }
  if (EXEMPT.some((pattern) => pattern.test(stripped))) strong += 2;
  if (strong > 0) return strong;
  return weak >= 2 ? 1 : 0;
}

function softFollowup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 180 || asksForOtherWork(trimmed)) return false;
  if (domainScore(trimmed) > 0) return true;
  if (!SHORT.test(trimmed)) return false;
  const rest = trimmed.replace(SHORT, "").replace(/^[?.!\s]+/, "").trim();
  const words = rest.split(/\s+/).filter(Boolean);
  return words.length <= 3;
}

function hasSignature(text: string): boolean {
  return /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{64,88}(?![1-9A-HJ-NP-Za-km-z])/.test(text);
}

function readFacts(facts: unknown): boolean {
  if (!facts || typeof facts !== "object") return false;
  const row = facts as Record<string, unknown>;
  const address = typeof row.address === "string" && row.address.trim().length >= 4;
  return address && "score" in row && "band" in row && Array.isArray(row.findings);
}
