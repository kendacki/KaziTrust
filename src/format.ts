export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatSol(lamports: number): string {
  if (!Number.isFinite(lamports) || lamports === 0) return "0 SOL";
  const sign = lamports < 0 ? "-" : "";
  const abs = Math.abs(Math.round(lamports));
  const whole = Math.floor(abs / 1_000_000_000);
  const frac = String(abs % 1_000_000_000).padStart(9, "0").replace(/0+$/, "");
  return `${sign}${frac ? `${whole}.${frac}` : whole} SOL`;
}

export function formatRawUnits(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const digits = (negative ? raw.slice(1) : raw).replace(/\D/g, "") || "0";
  if (/^0+$/.test(digits)) return "0";
  if (decimals <= 0) return `${negative ? "-" : ""}${digits.replace(/^0+/, "") || "0"}`;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals).replace(/^0+/, "") || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${frac ? `${whole}.${frac}` : whole}`;
}

export function cautionLabel(kind: string, score: number | null, band: string | null): string {
  if (score === null && kind === "wallet") return "Caution";
  return band ?? "Unscored";
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

export function formatTime(unixSeconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

export function formatNow(): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function bandFromScore(score: number): "Low" | "Guarded" | "Elevated" | "High" {
  if (score <= 24) return "Low";
  if (score <= 49) return "Guarded";
  if (score <= 74) return "Elevated";
  return "High";
}

export function severityWord(severity: "clean" | "note" | "watch" | "elevated" | "high"): string {
  if (severity === "clean") return "Clean";
  if (severity === "note") return "Noted";
  if (severity === "watch") return "Watch";
  if (severity === "elevated") return "Elevated";
  return "High";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
