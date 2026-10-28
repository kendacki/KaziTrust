export const KEY_LIFETIMES = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 168, label: "7 days" },
  { hours: 720, label: "30 days" },
] as const;

export type KeyHours = (typeof KEY_LIFETIMES)[number]["hours"];

export function keyLifetime(hours: number): { hours: KeyHours; label: string; ms: number } | null {
  const match = KEY_LIFETIMES.find((item) => item.hours === hours);
  if (!match) return null;
  return { hours: match.hours, label: match.label, ms: match.hours * 60 * 60 * 1000 };
}

export function keyExpiry(createdAt: string, hours: number): string | null {
  const life = keyLifetime(hours);
  const start = Date.parse(createdAt);
  if (!life || !Number.isFinite(start)) return null;
  return new Date(start + life.ms).toISOString();
}

export function keyActive(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const ends = Date.parse(expiresAt);
  return Number.isFinite(ends) && ends > now;
}

export function formatKeyRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}
