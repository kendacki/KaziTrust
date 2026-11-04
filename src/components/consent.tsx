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
        <header className="consent-head">
          <h2 id="consent-title">{prefs ? "Data preferences" : "How we use data"}</h2>
        </header>

        {!prefs ? (
          <ul className="consent-points">
            <li>Sign-in, security, and API key session storage stay on. They are required for the product.</li>
            <li>Product analytics stay off until you accept.</li>
            <li>Wallet addresses you look up are public Solana data.</li>
            <li>We do not sell your personal information.</li>
          </ul>
        ) : (
          <div className="consent-prefs" role="group" aria-label="Data preferences">
            <label className="consent-row">
              <span className="consent-row-copy">
                <strong>Necessary</strong>
                <span>Sign-in and key-session cookies</span>
              </span>
              <span className="consent-state on">On</span>
              <input type="checkbox" checked disabled readOnly className="consent-check" aria-label="Necessary storage always on" />
            </label>
            <label className="consent-row">
              <span className="consent-row-copy">
                <strong>Analytics</strong>
                <span>Anonymous product events</span>
              </span>
              <span className={`consent-state ${choice.analytics && !gpc ? "on" : ""}`}>
                {choice.analytics && !gpc ? "On" : "Off"}
              </span>
              <input
                type="checkbox"
                className="consent-check"
                checked={choice.analytics && !gpc}
                disabled={gpc}
                onChange={(event) => setChoice((prev) => ({ ...prev, analytics: event.target.checked }))}
                aria-label="Allow analytics"
              />
            </label>
            <label className="consent-row">
              <span className="consent-row-copy">
                <strong>Do Not Sell or Share</strong>
                <span>California / CPRA preference</span>
              </span>
              <span className={`consent-state ${(choice.doNotSellOrShare || gpc) ? "on" : ""}`}>
                {choice.doNotSellOrShare || gpc ? "On" : "Off"}
              </span>
              <input
                type="checkbox"
                className="consent-check"
                checked={choice.doNotSellOrShare || gpc}
                disabled={gpc}
                onChange={(event) => setChoice((prev) => ({ ...prev, doNotSellOrShare: event.target.checked }))}
                aria-label="Do not sell or share"
              />
            </label>
          </div>
        )}

        {gpc ? (
          <p className="consent-note" role="status">
            Global Privacy Control detected — analytics stay off.
          </p>
        ) : null}

        <div className="consent-actions">
          {prefs ? (
            <>
              <button
                type="button"
                className="consent-btn primary"
                onClick={() =>
                  finish(
                    saveConsent({
                      analytics: choice.analytics,
                      doNotSellOrShare: choice.doNotSellOrShare,
                    }),
                  )
                }
              >
                Save
              </button>
              <button type="button" className="consent-btn" onClick={() => setPrefs(false)}>
                Back
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="consent-btn primary"
                onClick={() => finish(acceptAllConsent())}
                disabled={gpc}
              >
                Accept analytics
              </button>
              <button type="button" className="consent-btn" onClick={() => finish(rejectOptionalConsent())}>
                Reject analytics
              </button>
              <button type="button" className="consent-btn quiet" onClick={() => setPrefs(true)}>
                Manage
              </button>
            </>
          )}
        </div>

        <nav className="consent-links" aria-label="Privacy links">
          <button type="button" onClick={() => go("/privacy")}>
            Privacy policy
          </button>
          <button type="button" onClick={() => go("/privacy#your-rights")}>
            Your rights
          </button>
          <a href={`mailto:${privacyContact()}`}>{privacyContact()}</a>
        </nav>
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
