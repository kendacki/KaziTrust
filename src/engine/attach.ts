import { extractAddresses } from "./address";
import { mentionsWalletWork } from "./scope";

const LIMIT = 1_000_000;

export type AttachmentRead = { ok: true; addresses: string[] } | { ok: false; message: string };

export async function readAttachment(file: File): Promise<AttachmentRead> {
  if (file.size > LIMIT) {
    return { ok: false, message: "That file is too large to read here. Nothing was saved." };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sample = bytes.subarray(0, 8000);
  for (const byte of sample) {
    if (byte === 0) {
      return { ok: false, message: "Only text files can be read here, including CSV. Nothing was saved." };
    }
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const addresses = extractAddresses(text).slice(0, 5);
  if (addresses.length > 0) return { ok: true, addresses };
  if (!mentionsWalletWork(text)) {
    return {
      ok: false,
      message: "KaziTrust only reads files for wallet searches and findings. This file is outside that, so it was not used. Nothing was saved.",
    };
  }
  return {
    ok: false,
    message: "No Solana address was in that file. Attach a file that contains a wallet, mint, or contract. Nothing was saved.",
  };
}
