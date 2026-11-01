import binanceHack from "./lists/binance-hack-2026.json";
import kelsier from "./lists/kelsier.json";

export type WatchListId = "ofac" | "meteora-kelsier" | "binance-hack-2026";

export type WatchListHit = {
  address: string;
  name: string;
  list: WatchListId;
  programs: string[];
  detail: string;
};

const KELSIER_SOURCE = kelsier.source;
const KELSIER_URL = kelsier.url;
const KELSIER_AS_OF = kelsier.asOf;
const KELSIER = new Set(kelsier.addresses);

const BINANCE_SOURCE = binanceHack.source;
const BINANCE_URL = binanceHack.url;
const BINANCE_AS_OF = binanceHack.asOf;
const BINANCE = new Set(binanceHack.addresses);

export function isOfacList(list?: WatchListId): boolean {
  return list === "ofac";
}

export function isWatchList(list?: WatchListId): boolean {
  return list === "meteora-kelsier" || list === "binance-hack-2026";
}

export function kelsierMeta() {
  return {
    source: KELSIER_SOURCE,
    url: KELSIER_URL,
    asOf: KELSIER_AS_OF,
    count: KELSIER.size,
  };
}

export function binanceHackMeta() {
  return {
    source: BINANCE_SOURCE,
    url: BINANCE_URL,
    asOf: BINANCE_AS_OF,
    count: BINANCE.size,
  };
}

export function screenKelsier(addresses: string[]): WatchListHit[] {
  const hits: WatchListHit[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    if (!KELSIER.has(address) || seen.has(address)) continue;
    seen.add(address);
    hits.push({
      address,
      name: "Meteora Kelsier blacklist",
      list: "meteora-kelsier",
      programs: [],
      detail: `Published by Meteora Operations as associated with Kelsier Ventures. Source: ${KELSIER_URL}. As of ${KELSIER_AS_OF}.`,
    });
  }
  return hits;
}

export function screenBinanceHack(addresses: string[]): WatchListHit[] {
  const hits: WatchListHit[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    if (!BINANCE.has(address) || seen.has(address)) continue;
    seen.add(address);
    hits.push({
      address,
      name: "Binance hack 2026 Solana wallet",
      list: "binance-hack-2026",
      programs: [],
      detail: `Publicly linked to the October 29, 2026 Binance drain on Solana. Source: ${BINANCE_URL}. As of ${BINANCE_AS_OF}. Not an OFAC sanctions listing.`,
    });
  }
  return hits;
}

export function isKelsierListed(address: string): boolean {
  return KELSIER.has(address);
}

export function isBinanceHackListed(address: string): boolean {
  return BINANCE.has(address);
}
