import { getAccessToken } from "@privy-io/react-auth";

import type { WatchListId } from "./lists";

export type BlockedEntry = {
  address: string;
  name: string;
  programs: string[];
  list?: WatchListId;
  detail?: string;
};

export type RestrictionIndex = {
  source: string;
  fetchedAt: string;
  byAddress: Map<string, BlockedEntry>;
};

export type RestrictionFacts = {
  source: string;
  fetchedAt: string;
  self?: BlockedEntry;
  counterparties: BlockedEntry[];
};

let cached: { at: number; index: RestrictionIndex } | null = null;

export async function readRestrictions(signal: AbortSignal): Promise<RestrictionIndex | null> {
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.index;
  try {
    const headers: Record<string, string> = {};
    if (!import.meta.env.DEV) {
      const token = await getAccessToken();
      if (!token) return cached?.index ?? null;
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetch("/api/restrictions", { signal, headers });
    if (!response.ok) return cached?.index ?? null;
    const body = (await response.json()) as { source?: string; fetchedAt?: string; entries?: BlockedEntry[] };
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const byAddress = new Map<string, BlockedEntry>();
    for (const entry of entries) {
      if (!entry || typeof entry.address !== "string" || typeof entry.name !== "string") continue;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry.address)) continue;
      byAddress.set(entry.address, {
        address: entry.address,
        name: entry.name,
        programs: Array.isArray(entry.programs) ? entry.programs.filter((item): item is string => typeof item === "string").slice(0, 4) : [],
        list: entry.list === "meteora-kelsier" ? "meteora-kelsier" : "ofac",
        detail: typeof entry.detail === "string" ? entry.detail : undefined,
      });
    }
    if (!byAddress.size) return cached?.index ?? null;
    const index = {
      source: typeof body.source === "string" ? body.source : "OFAC SDN list",
      fetchedAt: typeof body.fetchedAt === "string" ? body.fetchedAt : "",
      byAddress,
    };
    cached = { at: Date.now(), index };
    return index;
  } catch {
    return cached?.index ?? null;
  }
}

export function screenAddresses(index: RestrictionIndex, addresses: string[]): BlockedEntry[] {
  const hits: BlockedEntry[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    const hit = index.byAddress.get(address);
    if (!hit || seen.has(hit.address)) continue;
    seen.add(hit.address);
    hits.push(hit);
  }
  return hits;
}
