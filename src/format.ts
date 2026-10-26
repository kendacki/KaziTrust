export function shortAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (!Number.isFinite(sol)) return "0 SOL";
  if (sol === 0) return "0 SOL";
  if (sol < 0.0001) return `${sol.toFixed(6)} SOL`;
  if (sol < 1) return `${sol.toFixed(4)} SOL`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(sol)} SOL`;
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
