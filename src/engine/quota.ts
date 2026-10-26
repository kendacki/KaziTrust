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

export function readQuota(): { used: number; limit: number; remaining: number } {
  try {
    const raw = store()?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as { date?: string; count?: number }) : {};
    const used = parsed.date === today() ? Number(parsed.count ?? 0) : 0;
    return { used, limit: LIMIT, remaining: Math.max(0, LIMIT - used) };
  } catch {
    return { used: 0, limit: LIMIT, remaining: LIMIT };
  }
}

export function consumeRead(): { ok: boolean; remaining: number; limit: number } {
  const current = readQuota();
  if (current.remaining <= 0) return { ok: false, remaining: 0, limit: LIMIT };
  const used = current.used + 1;
  store()?.setItem(KEY, JSON.stringify({ date: today(), count: used }));
  return { ok: true, remaining: LIMIT - used, limit: LIMIT };
}
