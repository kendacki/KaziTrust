import { privacyContact } from "../privacy/consent";
import { openConsentPreferences } from "./consent";
import { Lockup } from "./mark";

const SITE = "https://www.kazitrustai.fun";
const UPDATED = "4 November 2026";

export function PrivacyPage({ go }: { go: (to: string) => void }) {
  return (
    <div className="privacy-page">
      <header className="site-header">
        <div className="nav frame">
          <button type="button" className="lockup-btn" onClick={() => go("/")}>
            <Lockup />
          </button>
          <div className="nav-actions">
            <button type="button" className="text-btn" onClick={() => go("/docs")}>
              Docs
            </button>
            <button type="button" className="btn" onClick={() => go("/app")}>
              Open app
            </button>
          </div>
        </div>
      </header>

      <article className="privacy-doc frame">
        <p className="eyebrow">Legal</p>
        <h1>Privacy policy</h1>
        <p className="lede">
          How KaziTrust collects, uses, stores, and shares information when you use {SITE}. Written for visitors and
          users in Nigeria, the European Economic Area / UK, and the United States (including California).
        </p>
        <p className="quiet">Last updated {UPDATED}. This is a product notice, not legal advice.</p>

        <nav className="privacy-toc" aria-label="Privacy sections">
          <a href="#who-we-are">Who we are</a>
          <a href="#what-we-collect">What we collect</a>
          <a href="#why">Why we process data</a>
          <a href="#cookies">Cookies and storage</a>
          <a href="#sharing">Sharing and processors</a>
          <a href="#retention">Retention</a>
          <a href="#security">Security</a>
          <a href="#your-rights">Your rights</a>
          <a href="#children">Children</a>
          <a href="#contact">Contact</a>
        </nav>

        <h2 id="who-we-are">Who we are</h2>
        <p>
          KaziTrust (“we”, “us”) operates the website and API at {SITE}. We provide tools that read public Solana chain
          data and explain those reads. For privacy requests email{" "}
          <a className="quiet-link" href={`mailto:${privacyContact()}`}>
            {privacyContact()}
          </a>
          .
        </p>

        <h2 id="what-we-collect">What we collect</h2>
        <ul>
          <li>
            <strong>Account sign-in. </strong>
            Email or Google login is handled by Privy. We receive a verified user id (did:privy:…) and session token to
            gate the app and API key issuance. We do not store your password.
          </li>
          <li>
            <strong>API keys. </strong>
            The full <span className="num">kt_</span> key is shown once and kept in your browser if you save it. The
            server stores a hash, expiry, purpose, daily read limit, and owner id. A host-only HttpOnly cookie binds that
            key session to your signed-in account.
          </li>
          <li>
            <strong>Wallet and mint queries. </strong>
            Addresses and mints you ask about are sent to our API and to public chain / risk tools. On-chain addresses are
            public blockchain data.
          </li>
          <li>
            <strong>Browser storage. </strong>
            Chats, watchlist, display name, daily read counter, and the full API key stay in local storage on your device
            unless you clear them.
          </li>
          <li>
            <strong>Optional analytics. </strong>
            Only after you accept: coarse product events (page route, feature used, success/fail, timing) and a random
            session id. We do not put your API key or wallet private keys in analytics.
          </li>
          <li>
            <strong>Technical logs. </strong>
            Hosting may process IP addresses and request metadata for security, rate limiting, and abuse prevention.
            Rate limits use a fingerprint, not a raw IP in application logs we control.
          </li>
        </ul>

        <h2 id="why">Why we process data</h2>
        <p>We process personal data to:</p>
        <ul>
          <li>Provide the service you request (wallet reads, API, MCP tools, wording).</li>
          <li>Authenticate you and issue or verify API keys.</li>
          <li>Protect the service (rate limits, fraud/abuse, security).</li>
          <li>Improve reliability when you consent to analytics.</li>
          <li>Meet legal obligations and respond to lawful requests.</li>
        </ul>
        <p>
          <strong>Nigeria (NDPA / GAID). </strong>
          Legal bases include consent (optional analytics and non-necessary cookies), performance of a contract /
          requested service, and legitimate interests in securing the service. Consent can be withdrawn as easily as it
          was given via Cookie choices.
        </p>
        <p>
          <strong>EEA / UK (GDPR / UK GDPR). </strong>
          Bases include Art. 6(1)(b) contract for the signed-in product, Art. 6(1)(f) legitimate interests for security
          and necessary technical storage, and Art. 6(1)(a) consent for optional analytics. You may object or withdraw
          consent at any time.
        </p>
        <p>
          <strong>United States / California (CCPA / CPRA). </strong>
          We collect the categories above for the business purposes listed. We do not sell personal information and we
          do not share it for cross-context behavioural advertising. You can still record a Do Not Sell or Share
          preference and use Global Privacy Control (GPC); we honour GPC as an opt-out.
        </p>

        <h2 id="cookies">Cookies, local storage, and consent</h2>
        <ul>
          <li>
            <strong>Necessary. </strong>
            Auth session (Privy), and our host-only <span className="num">__Host-kazitrust_key</span> cookie for the
            signed-in key view. Required for core security and account features. Consent is not required for these under
            NDPA GAID “necessary cookies” and GDPR strictly necessary storage.
          </li>
          <li>
            <strong>Optional analytics. </strong>
            Product events and Vercel Analytics run only after you accept. Reject keeps them off. Equal Accept / Reject
            controls appear in a centre panel on first visit (and anytime from Cookie choices).
          </li>
        </ul>
        <p>
          <button type="button" className="btn" onClick={() => openConsentPreferences()}>
            Open cookie choices
          </button>{" "}
          <button type="button" className="btn ghost" onClick={() => go("/privacy/choices")}>
            Do Not Sell or Share
          </button>
        </p>

        <h2 id="sharing">Sharing and processors</h2>
        <p>We use processors to run the product. They only receive what is needed for their role:</p>
        <ul>
          <li>Privy — authentication</li>
          <li>Vercel — hosting, serverless APIs, optional analytics (if consented)</li>
          <li>Upstash / Vercel KV — key hashes, quotas, analytics ring (if used)</li>
          <li>Groq — wording sentences from facts you already obtained</li>
          <li>Solscan, RugCheck, public Solana RPC, OFAC list sources — chain and risk lookups</li>
        </ul>
        <p>
          Data may be processed in the United States and other countries where these providers operate. Where required
          (for example EEA transfers), we rely on the providers’ appropriate safeguards and your consent or the necessity
          of providing the service you requested.
        </p>

        <h2 id="retention">Retention</h2>
        <ul>
          <li>API key records: until the key expires or you create a replacement key.</li>
          <li>Analytics events: short rolling store for operations; not a permanent profile archive.</li>
          <li>Browser local data: until you clear site data or we instruct a clear on expiry.</li>
          <li>Security logs: kept only as long as needed for abuse prevention and debugging.</li>
        </ul>

        <h2 id="security">Security</h2>
        <p>
          We use HTTPS, host-only Secure HttpOnly SameSite cookies for key sessions, hashed API keys, rate limits,
          origin checks on sensitive routes, and redaction of secrets in application logs. No method is perfect; report
          suspected incidents to {privacyContact()}.
        </p>

        <h2 id="your-rights">Your rights</h2>
        <p>Depending on where you live, you may have rights to:</p>
        <ul>
          <li>Access a copy of personal data we hold about you</li>
          <li>Correct inaccurate data</li>
          <li>Delete data (subject to legal retention needs)</li>
          <li>Withdraw consent for optional analytics</li>
          <li>Object to or restrict certain processing</li>
          <li>Data portability (GDPR)</li>
          <li>Opt out of sale/share (CCPA/CPRA) — we do not sell; preferences still apply</li>
          <li>Lodge a complaint with a supervisory authority (NDPC in Nigeria; your EU/UK DPA; California AG)</li>
        </ul>
        <p>
          To exercise rights, email {privacyContact()} from the address tied to your account when possible. We will
          verify the request and respond within the timelines required by applicable law.
        </p>

        <h2 id="children">Children</h2>
        <p>
          KaziTrust is not directed to children under 16 (or the higher age of digital consent in your region). We do
          not knowingly collect children’s data. If you believe a child provided data, contact us to delete it.
        </p>

        <h2 id="contact">Contact</h2>
        <p>
          Privacy requests:{" "}
          <a className="quiet-link" href={`mailto:${privacyContact()}`}>
            {privacyContact()}
          </a>
        </p>
        <p>
          Website:{" "}
          <a className="quiet-link" href={SITE}>
            {SITE}
          </a>
        </p>
        <p className="quiet">
          Supervisory references: Nigeria Data Protection Commission (NDPC) under the Nigeria Data Protection Act;
          EU/UK GDPR supervisory authorities; California Privacy Protection Agency / Attorney General for CCPA/CPRA.
        </p>

        <div className="privacy-foot">
          <button type="button" className="btn ghost" onClick={() => go("/")}>
            Home
          </button>
          <button type="button" className="btn ghost" onClick={() => go("/docs")}>
            Docs
          </button>
          <button type="button" className="btn" onClick={() => openConsentPreferences()}>
            Cookie choices
          </button>
        </div>
      </article>
    </div>
  );
}

export function PrivacyChoicesPage({ go }: { go: (to: string) => void }) {
  return (
    <div className="privacy-page">
      <header className="site-header">
        <div className="nav frame">
          <button type="button" className="lockup-btn" onClick={() => go("/")}>
            <Lockup />
          </button>
        </div>
      </header>
      <article className="privacy-doc frame">
        <p className="eyebrow">California · CCPA / CPRA</p>
        <h1>Do Not Sell or Share My Personal Information</h1>
        <p className="lede">
          KaziTrust does not sell personal information and does not share it for cross-context behavioural advertising.
          You can still record an opt-out preference. Browsers that send Global Privacy Control (GPC) are treated as
          opt-out automatically.
        </p>
        <ul>
          <li>Optional analytics stay off when you reject them or when GPC is present.</li>
          <li>Necessary cookies for sign-in and key sessions continue so the product can function.</li>
          <li>
            Full details are in the{" "}
            <button type="button" className="quiet-link" onClick={() => go("/privacy")}>
              privacy policy
            </button>
            .
          </li>
        </ul>
        <div className="privacy-foot">
          <button
            type="button"
            className="btn"
            onClick={() => {
              openConsentPreferences();
            }}
          >
            Record opt-out / manage choices
          </button>
          <button type="button" className="btn ghost" onClick={() => go("/privacy")}>
            Privacy policy
          </button>
        </div>
        <p className="quiet">
          Requests:{" "}
          <a className="quiet-link" href={`mailto:${privacyContact()}`}>
            {privacyContact()}
          </a>
        </p>
      </article>
    </div>
  );
}
