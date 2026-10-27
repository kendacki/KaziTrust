import { extractAddresses } from "./address";

const OFF_TOPIC =
  /\b(poem|lyrics|song|joke|recipe|homework|essay|resume|cover letter|weather|forecast|translate|short story|story|novel|movie|celebrity|bitcoin price|stock price|python|javascript|typescript|write code|write an email|email draft|sql|html|css|exploit|malware|password|jailbreak|roleplay|girlfriend|boyfriend|medical|diagnosis|tax advice|legal advice|workout|diet|seo|tweet|haiku|rap|ignore (?:all |your |the |previous )*instructions|system prompt|developer mode)\b/i;

const WALLET_WORK =
  /\b(wallets?|solana|mints?|tokens?|programs?|contracts?|transactions?|signatures?|risk|scores?|scoring|findings?|delegates?|approvals?|funding|holders?|lamports?|spl|nfts?|cluster|watchlist|method|deployers?|jupiter|usdc|mainnet|balances?|freeze|counterpart(?:y|ies)|hops?|pubkey|public key|kazitrust)\b/i;

const PRODUCT =
  /\b(what can you do|how does this work|what do you read|how is the score built|scoring method|how do you score|illustrative|sample deployer)\b/i;

const CLARIFY = /^(why\b|explain\b|what does that mean|say more|go on|compare them)/i;

const OTHER_ADDRESS = /\b(email|e-mail|ip|home|mailing|street|postal) address(?:es)?\b/gi;

export const OUT_OF_SCOPE =
  "KaziTrust only reads Solana wallets, mints, and contracts, and explains those reads. Ask for one of those, or about how a score is built.";

export function mentionsWalletWork(text: string): boolean {
  const stripped = text.replace(OTHER_ADDRESS, " ");
  return WALLET_WORK.test(stripped) || /\baddresses?\b/i.test(stripped);
}

export function walletQuestionAllowed(text: string, hasContext: boolean): boolean {
  if (OFF_TOPIC.test(text) && extractAddresses(text).length === 0) return false;
  if (extractAddresses(text).length > 0) return true;
  if (PRODUCT.test(text) || mentionsWalletWork(text)) return true;
  return hasContext && text.length <= 240 && CLARIFY.test(text.trim());
}

export function wordingSpendAllowed(kind: string | undefined, question: string, facts: unknown, context = ""): boolean {
  if (OFF_TOPIC.test(question) || OFF_TOPIC.test(context)) return false;
  if (kind === "explain") return readFacts(facts);
  return walletQuestionAllowed(question, false);
}

function readFacts(facts: unknown): boolean {
  if (!facts || typeof facts !== "object") return false;
  const row = facts as Record<string, unknown>;
  const address = typeof row.address === "string" && row.address.trim().length >= 4;
  return address && "score" in row && "band" in row && Array.isArray(row.findings);
}

export function modelQuestion(text: string): string {
  if (OFF_TOPIC.test(text)) return "Explain this wallet read.";
  return text.slice(0, 500);
}
