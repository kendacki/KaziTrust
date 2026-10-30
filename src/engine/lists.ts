import kelsier from "./lists/kelsier.json";

export type WatchListId = "ofac" | "meteora-kelsier";

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

export function kelsierMeta() {
  return {
    source: KELSIER_SOURCE,
    url: KELSIER_URL,
    asOf: KELSIER_AS_OF,
    count: KELSIER.size,
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

export function isKelsierListed(address: string): boolean {
  return KELSIER.has(address);
}
