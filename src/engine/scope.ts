import { extractAddresses } from "./address";

const OFF_TOPIC =
  /\b(poem|lyrics|song|joke|recipe|homework|essay|resume|cover letter|weather|forecast|translate|short story|movie|celebrity|bitcoin price|stock price|python script|javascript function|write code|ignore (?:all |your |previous )*instructions)\b/i;

const WALLET_WORK =
  /\b(wallets?|solana|mints?|tokens?|programs?|contracts?|transactions?|signatures?|risk|scores?|scoring|findings?|delegates?|approvals?|funding|holders?|lamports?|spl|nfts?|cluster|watchlist|method|deployers?|jupiter|usdc|mainnet|balances?|freeze|counterpart(?:y|ies)|hops?|pubkey|public key|kazitrust)\b/i;

const PRODUCT =
  /\b(what can you do|how does this work|what do you read|how is the score built|scoring method|how do you score|illustrative|sample deployer)\b/i;

const CLARIFY = /^(why\b|explain\b|what does that mean|say more|go on|compare them)/i;

const OTHER_ADDRESS = /\b(email|e-mail|ip|home|mailing|street|postal) address(?:es)?\b/gi;

export const OUT_OF_SCOPE =
  "KaziTrust only answers wallet searches and findings. Ask about a Solana wallet, mint, or contract, or about how a score is built.";

export function mentionsWalletWork(text: string): boolean {
  const stripped = text.replace(OTHER_ADDRESS, " ");
  return WALLET_WORK.test(stripped) || /\baddresses?\b/i.test(stripped);
}

export function walletQuestionAllowed(text: string, hasContext: boolean): boolean {
  if (extractAddresses(text).length > 0) return true;
  if (OFF_TOPIC.test(text)) return false;
  if (PRODUCT.test(text) || mentionsWalletWork(text)) return true;
  return hasContext && text.length <= 240 && CLARIFY.test(text.trim());
}

export function modelQuestion(text: string): string {
  if (OFF_TOPIC.test(text)) return "Explain this wallet read.";
  return text.slice(0, 500);
}
