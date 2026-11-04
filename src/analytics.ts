import { analyticsAllowed } from "./privacy/consent";

type TrackInput = {
  name: string;
  ok?: boolean;
  ms?: number;
  error?: string;
  meta?: Record<string, string | number | boolean | undefined | null>;
};

const queue: TrackInput[] = [];
let flushTimer: number | null = null;
let session = "";

function sessionId() {
  if (session) return session;
  try {
    const key = "kazitrust.analytics.session";
    const existing = sessionStorage.getItem(key);
    if (existing) {
      session = existing;
      return session;
    }
    session = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, session);
  } catch {
    session = `s_${Date.now().toString(36)}`;
  }
  return session;
}

export function track(input: TrackInput) {
  if (typeof window === "undefined") return;
  // NDPA / GDPR: no optional product analytics until the visitor consents.
  if (!analyticsAllowed()) return;
  queue.push({
    ...input,
    meta: {
      ...(input.meta || {}),
      session: sessionId(),
      path: window.location.pathname,
    },
  });
  if (queue.length >= 8) {
    void flush();
    return;
  }
  if (flushTimer != null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 1200);
}

export async function flush() {
  if (!queue.length || typeof window === "undefined") return;
  if (!analyticsAllowed()) {
    queue.splice(0, queue.length);
    return;
  }
  const events = queue.splice(0, queue.length).map((item) => ({
    name: item.name,
    ok: item.ok !== false,
    ms: item.ms,
    error: item.error,
    meta: item.meta,
    source: "ui",
    ts: new Date().toISOString(),
  }));
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    // Best-effort; drop on failure so the UI never blocks.
  }
}

export function trackPage(path: string) {
  track({ name: "page_view", meta: { route: path } });
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void flush();
  });
  window.addEventListener("error", (event) => {
    track({
      name: "client_error",
      ok: false,
      error: String(event.message || "error").slice(0, 200),
      meta: { route: window.location.pathname },
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason || "rejection");
    track({
      name: "client_error",
      ok: false,
      error: reason.slice(0, 200),
      meta: { route: window.location.pathname },
    });
  });
}
