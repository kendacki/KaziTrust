const LIMIT = 30;
const KEY = "kazitrust.reads";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function store(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function quotaKey(userId?: string | null): string {
  return userId ? `${KEY}.${userId}` : KEY;
}

export function readQuota(userId?: string | null): { used: number; limit: number; remaining: number } {
  try {
    const raw = store()?.getItem(quotaKey(userId));
    const parsed = raw ? (JSON.parse(raw) as { date?: string; count?: number }) : {};
    const used = parsed.date === today() ? Number(parsed.count ?? 0) : 0;
    return { used, limit: LIMIT, remaining: Math.max(0, LIMIT - used) };
  } catch {
    return { used: 0, limit: LIMIT, remaining: LIMIT };
  }
}

export function consumeRead(userId?: string | null): { ok: boolean; remaining: number; limit: number } {
  const current = readQuota(userId);
  if (current.remaining <= 0) return { ok: false, remaining: 0, limit: LIMIT };
  const used = current.used + 1;
  store()?.setItem(quotaKey(userId), JSON.stringify({ date: today(), count: used }));
  try {
    if (userId) store()?.removeItem(KEY);
  } catch {
    /* Legacy shared quota key is best-effort to clear. */
  }
  return { ok: true, remaining: LIMIT - used, limit: LIMIT };
}
