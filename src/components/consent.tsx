import { useEffect, useState, type ReactNode } from "react";
import {
  acceptAllConsent,
  analyticsAllowed,
  gpcEnabled,
  hasConsentDecision,
  loadConsent,
  privacyContact,
  rejectOptionalConsent,
  saveConsent,
  subscribeConsent,
  type ConsentChoice,
} from "../privacy/consent";

export function ConsentRoot({ go }: { go: (to: string) => void }) {
  const [choice, setChoice] = useState<ConsentChoice>(() => loadConsent());
  const [open, setOpen] = useState(() => !hasConsentDecision());
  const [prefs, setPrefs] = useState(false);

  useEffect(() => {
    return subscribeConsent(() => {
      setChoice(loadConsent());
      setOpen(!hasConsentDecision());
    });
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setPrefs(true);
      setOpen(true);
    };
    window.addEventListener("kazitrust:open-consent", onOpen);
    return () => window.removeEventListener("kazitrust:open-consent", onOpen);
  }, []);

  if (!open) return null;

  const gpc = gpcEnabled();

  function finish(next: ConsentChoice) {
    setChoice(next);
    setPrefs(false);
    setOpen(false);
  }

  return (
    <div className="consent-layer" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-scrim" aria-hidden="true" />
      <div className="consent-panel">
        <p className="eyebrow">Privacy choices</p>
        <h2 id="consent-title">{prefs ? "Manage data preferences" : "How we use data on this site"}</h2>
        <p className="consent-copy">
          KaziTrust uses necessary cookies and local storage so sign-in and your API key session work. Optional product
          analytics help us see which pages and features fail. Analytics stay off until you accept. Public Solana
          addresses you look up are queried on-chain; we do not sell your personal information.
        </p>
        {gpc ? (
          <p className="consent-note">
            Your browser sent a Global Privacy Control signal. Optional analytics stay off, and we treat that as a Do
            Not Sell or Share request.
          </p>
        ) : null}

        {prefs ? (
          <div className="consent-prefs">
            <label className="consent-row">
              <span>
                <strong>Necessary</strong>
                <span className="quiet">Sign-in, security, and key-session cookies. Always on.</span>
              </span>
              <input type="checkbox" checked disabled readOnly aria-label="Necessary storage always on" />
            </label>
            <label className="consent-row">
              <span>
                <strong>Analytics</strong>
                <span className="quiet">Anonymous product events and Vercel Analytics. Requires your consent.</span>
              </span>
              <input
                type="checkbox"
                checked={choice.analytics && !gpc}
                disabled={gpc}
                onChange={(event) => setChoice((prev) => ({ ...prev, analytics: event.target.checked }))}
                aria-label="Allow analytics"
              />
            </label>
            <label className="consent-row">
              <span>
                <strong>Do Not Sell or Share</strong>
                <span className="quiet">California / CPRA opt-out. We do not sell data; this keeps sharing off.</span>
              </span>
              <input
                type="checkbox"
                checked={choice.doNotSellOrShare || gpc}
                disabled={gpc}
                onChange={(event) => setChoice((prev) => ({ ...prev, doNotSellOrShare: event.target.checked }))}
                aria-label="Do not sell or share"
              />
            </label>
          </div>
        ) : null}

        <div className="consent-actions">
          {prefs ? (
            <button
              type="button"
              className="btn"
              onClick={() =>
                finish(
                  saveConsent({
                    analytics: choice.analytics,
                    doNotSellOrShare: choice.doNotSellOrShare,
                  }),
                )
              }
            >
              Save choices
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => finish(acceptAllConsent())} disabled={gpc}>
                Accept optional analytics
              </button>
              <button type="button" className="btn ghost" onClick={() => finish(rejectOptionalConsent())}>
                Reject optional analytics
              </button>
            </>
          )}
          <button type="button" className="btn ghost" onClick={() => setPrefs((value) => !value)}>
            {prefs ? "Back" : "Manage choices"}
          </button>
        </div>
        <p className="consent-links">
          <button type="button" className="quiet-link" onClick={() => go("/privacy")}>
            Privacy policy
          </button>
          <span aria-hidden="true">·</span>
          <button type="button" className="quiet-link" onClick={() => go("/privacy#your-rights")}>
            Your rights
          </button>
          <span aria-hidden="true">·</span>
          <a className="quiet-link" href={`mailto:${privacyContact()}`}>
            {privacyContact()}
          </a>
        </p>
      </div>
    </div>
  );
}

export function openConsentPreferences() {
  window.dispatchEvent(new Event("kazitrust:open-consent"));
}

/** Renders children only after analytics consent. */
export function OptionalAnalytics({ children }: { children: (allowed: boolean) => ReactNode }) {
  const [allowed, setAllowed] = useState(() => analyticsAllowed());
  useEffect(() => subscribeConsent(() => setAllowed(analyticsAllowed())), []);
  return <>{children(allowed)}</>;
}
