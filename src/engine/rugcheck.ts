import { getAccessToken } from "@privy-io/react-auth";

export type RugcheckRisk = {
  name: string;
  description: string;
  score: number;
  level: "warn" | "danger";
};

export type RugcheckNetwork = {
  type: "trade" | "transfer";
  size: number;
};

export type RugcheckReport = {
  mint: string;
  name?: string;
  symbol?: string;
  score: number;
  scoreNormalised: number;
  band: "Good" | "Warning" | "Danger";
  mintAuthority: string | null;
  freezeAuthority: string | null;
  lpLockedPct?: number;
  insiderAccounts?: number;
  networks: RugcheckNetwork[];
  liquidity?: number;
  holders?: number;
  price?: number;
  risks: RugcheckRisk[];
};

export async function readRugcheck(mint: string, signal: AbortSignal): Promise<RugcheckReport | null> {
  try {
    const headers: Record<string, string> = {};
    if (!import.meta.env.DEV) {
      const token = await getAccessToken();
      if (!token) return null;
      headers.authorization = `Bearer ${token}`;
    }
    const response = await fetch(`/api/rugcheck?mint=${encodeURIComponent(mint)}`, { signal, headers });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<RugcheckReport>;
    if (typeof body.mint === "string" && body.mint !== mint) return null;
    if (typeof body.score !== "number" || typeof body.scoreNormalised !== "number") return null;
    if (body.band !== "Good" && body.band !== "Warning" && body.band !== "Danger") return null;
    return {
      mint: typeof body.mint === "string" ? body.mint : mint,
      ...(typeof body.name === "string" && body.name ? { name: body.name } : {}),
      ...(typeof body.symbol === "string" && body.symbol ? { symbol: body.symbol } : {}),
      score: body.score,
      scoreNormalised: body.scoreNormalised,
      band: body.band,
      mintAuthority: typeof body.mintAuthority === "string" ? body.mintAuthority : null,
      freezeAuthority: typeof body.freezeAuthority === "string" ? body.freezeAuthority : null,
      ...(typeof body.lpLockedPct === "number" ? { lpLockedPct: body.lpLockedPct } : {}),
      ...(typeof body.insiderAccounts === "number" ? { insiderAccounts: body.insiderAccounts } : {}),
      networks: Array.isArray(body.networks) ? body.networks.filter(isNetwork).slice(0, 4) : [],
      ...(typeof body.liquidity === "number" ? { liquidity: body.liquidity } : {}),
      ...(typeof body.holders === "number" ? { holders: body.holders } : {}),
      ...(typeof body.price === "number" ? { price: body.price } : {}),
      risks: Array.isArray(body.risks) ? body.risks.filter(isRisk).slice(0, 6) : [],
    };
  } catch {
    return null;
  }
}

function isRisk(value: RugcheckRisk | undefined): value is RugcheckRisk {
  return Boolean(value && (value.level === "warn" || value.level === "danger") && value.name && value.description && typeof value.score === "number");
}

function isNetwork(value: RugcheckNetwork | undefined): value is RugcheckNetwork {
  return Boolean(value && (value.type === "trade" || value.type === "transfer") && typeof value.size === "number");
}
