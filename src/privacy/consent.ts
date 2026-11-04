/** Consent for non-essential telemetry (NDPA GAID / GDPR). Necessary auth cookies stay on. */

export type ConsentChoice = {
  version: number;
  decidedAt: string | null;
  /** Product analytics and Vercel Analytics. Off until the visitor accepts. */
  analytics: boolean;
  /** Explicit CCPA/CPRA opt-out of sale/share (we do not sell; still honored). */
  doNotSellOrShare: boolean;
};

export const CONSENT_VERSION = 1;
const STORAGE_KEY = "kazitrust.consent.v1";

const DEFAULT: ConsentChoice = {
  version: CONSENT_VERSION,
  decidedAt: null,
  analytics: false,
  doNotSellOrShare: true,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeConsent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function gpcEnabled(): boolean {
  try {
    return Boolean((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl);
  } catch {
    return false;
  }
}

export function loadConsent(): ConsentChoice {
  if (typeof window === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return applyGpc({ ...DEFAULT });
    const parsed = JSON.parse(raw) as Partial<ConsentChoice>;
    const next: ConsentChoice = {
      version: CONSENT_VERSION,
      decidedAt: typeof parsed.decidedAt === "string" ? parsed.decidedAt : null,
      analytics: parsed.analytics === true,
      doNotSellOrShare: parsed.doNotSellOrShare !== false,
    };
    return applyGpc(next);
  } catch {
    return applyGpc({ ...DEFAULT });
  }
}

function applyGpc(choice: ConsentChoice): ConsentChoice {
  if (!gpcEnabled()) return choice;
  return {
    ...choice,
    analytics: false,
    doNotSellOrShare: true,
  };
}

export function saveConsent(partial: Partial<Pick<ConsentChoice, "analytics" | "doNotSellOrShare">>): ConsentChoice {
  const current = loadConsent();
  let next: ConsentChoice = {
    version: CONSENT_VERSION,
    decidedAt: new Date().toISOString(),
    analytics: partial.analytics ?? current.analytics,
    doNotSellOrShare: partial.doNotSellOrShare ?? current.doNotSellOrShare,
  };
  next = applyGpc(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked */
  }
  emit();
  return next;
}

export function acceptAllConsent(): ConsentChoice {
  return saveConsent({ analytics: !gpcEnabled(), doNotSellOrShare: gpcEnabled() });
}

export function rejectOptionalConsent(): ConsentChoice {
  return saveConsent({ analytics: false, doNotSellOrShare: true });
}

export function hasConsentDecision(): boolean {
  const choice = loadConsent();
  if (gpcEnabled()) return true;
  return Boolean(choice.decidedAt);
}

export function analyticsAllowed(): boolean {
  const choice = loadConsent();
  if (gpcEnabled()) return false;
  return choice.analytics === true && Boolean(choice.decidedAt);
}

export function privacyContact(): string {
  return "privacy@kazitrustai.fun";
}
