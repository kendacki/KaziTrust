import { getAccessToken } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

const KEY = "kazitrust.apikey";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type Service = {
  id: string;
  method: "GET" | "POST";
  path: string;
  about: string;
  sample: (origin: string, key: string) => string;
};

const SERVICES: Service[] = [
  {
    id: "index",
    method: "GET",
    path: "/api/v1",
    about: "List every service this key opens.",
    sample: (origin, key) => `curl ${origin}/api/v1 \\\n  -H "Authorization: Bearer ${key}"`,
  },
  {
    id: "rpc",
    method: "POST",
    path: "/api/v1/rpc",
    about: "Solana JSON-RPC. Send the usual JSON-RPC body.",
    sample: (origin, key) =>
      `curl ${origin}/api/v1/rpc \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"getHealth\\"}"`,
  },
  {
    id: "rugcheck",
    method: "GET",
    path: "/api/v1/rugcheck?mint=",
    about: "Token risk report for one mint. This number stays separate from the KaziTrust score.",
    sample: (origin, key) => `curl "${origin}/api/v1/rugcheck?mint=${USDC}" \\\n  -H "Authorization: Bearer ${key}"`,
  },
  {
    id: "restrictions",
    method: "GET",
    path: "/api/v1/restrictions",
    about: "OFAC SDN Solana addresses.",
    sample: (origin, key) => `curl ${origin}/api/v1/restrictions \\\n  -H "Authorization: Bearer ${key}"`,
  },
  {
    id: "solscan",
    method: "GET",
    path: "/api/v1/solscan?path=&address=",
    about: "Label, portfolio, and recent DeFi activity. path is account/metadata, account/portfolio, or account/defi/activities.",
    sample: (origin, key) =>
      `curl "${origin}/api/v1/solscan?path=account/metadata&address=${USDC}" \\\n  -H "Authorization: Bearer ${key}"`,
  },
  {
    id: "wording",
    method: "POST",
    path: "/api/v1/wording",
    about: "Sentences for a read. The key does not change a score.",
    sample: (origin, key) =>
      `curl ${origin}/api/v1/wording \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d "{\\"kind\\":\\"chat\\",\\"question\\":\\"What does a low score mean?\\"}"`,
  },
];

export function ApiAccess({ go }: { go: (to: string) => void }) {
  const [secret, setSecret] = useState(() => localStorage.getItem(KEY) ?? "");
  const [prefix, setPrefix] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(SERVICES[0].id);
  const origin = window.location.origin;
  const service = SERVICES.find((item) => item.id === picked) ?? SERVICES[0];
  const placeholder = secret || "kt_your_key";

  useEffect(() => {
    void fetch("/api/keys")
      .then((response) => response.json())
      .then((body: { key?: { prefix?: string; createdAt?: string } | null }) => {
        setPrefix(body.key?.prefix ?? "");
        setCreatedAt(body.key?.createdAt ?? "");
      })
      .catch(() => setNotice("The key service did not answer."));
  }, []);

  const shown = secret || (prefix ? `${prefix}…` : "");
  const stale = Boolean(secret && prefix && !secret.startsWith(prefix));

  async function create() {
    setBusy(true);
    setNotice("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (!import.meta.env.DEV) {
        const token = await getAccessToken();
        if (!token) {
          setNotice("Sign in from the app, then create a key.");
          return;
        }
        headers.authorization = `Bearer ${token}`;
      }
      const response = await fetch("/api/keys", { method: "POST", headers });
      const body = (await response.json()) as { key?: string; prefix?: string; createdAt?: string; error?: string };
      if (!response.ok || !body.key) {
        setNotice(body.error || "The key could not be created.");
        return;
      }
      localStorage.setItem(KEY, body.key);
      setSecret(body.key);
      setPrefix(body.prefix ?? body.key.slice(0, 7));
      setCreatedAt(body.createdAt ?? "");
      setNotice("Copy the key now. A new key replaces the previous one.");
    } catch {
      setNotice("The key service did not answer.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice("The browser did not allow the copy.");
    }
  }

  return (
    <div className="api-page wrap">
      <header className="page-head">
        <p className="eyebrow">API</p>
        <h1>One key for every service</h1>
        <p className="lede">Create one key and send it with each request. The same key opens the chain read, token risk, the blocked list, labels, and wording.</p>
      </header>

      <ol className="api-steps">
        <li><span>1</span>Create a key. Only one key is active.</li>
        <li><span>2</span>Send it as Authorization: Bearer kt_...</li>
        <li><span>3</span>Call any path under {origin}/api/v1.</li>
      </ol>

      <div className="api-grid">
        <article className="api-card">
          <div className="api-meta">
            <h2>Your key</h2>
            <p className="quiet">{createdAt ? `Created ${createdAt.slice(0, 10)}` : "No key yet"}</p>
          </div>
          <p className="api-secret num">{shown || "Create a key to see it here."}</p>
          {stale ? <p className="quiet">This browser is holding a key the server no longer accepts.</p> : null}
          <div className="hero-actions">
            <button type="button" className="btn ink" onClick={() => void create()} disabled={busy}>
              {secret || prefix ? "Replace key" : "Create key"}
            </button>
            <button type="button" className="btn ghost" disabled={!secret} onClick={() => void copy(secret, "Key")}>
              Copy key
            </button>
          </div>
          <p className="quiet">The server stores a hash. The full key stays in this browser, and a replacement retires the old one.</p>
        </article>
        <article className="api-card">
          <div className="api-meta">
            <h2>Base URL</h2>
            <p className="quiet">Same host as the app</p>
          </div>
          <p className="api-secret num">{origin}/api/v1</p>
          <pre className="code">{`Authorization: Bearer kt_...`}</pre>
          <p className="quiet">A missing or retired key returns 401. The app itself does not need this key.</p>
        </article>
      </div>

      <section className="api-services" id="services">
        <div className="api-meta">
          <h2>Services</h2>
          <p className="quiet">Pick a row to fill the request.</p>
        </div>
        <ul>
          {SERVICES.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="api-row"
                aria-pressed={item.id === service.id}
                onClick={() => setPicked(item.id)}
              >
                <span className="api-method">{item.method}</span>
                <code>{item.path}</code>
                <span>{item.about}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="api-try" id="request">
        <div className="api-meta">
          <h2>Request</h2>
          <button type="button" className="btn ghost" onClick={() => void copy(service.sample(origin, placeholder), "Request")}>
            Copy request
          </button>
        </div>
        <pre className="code">{service.sample(origin, placeholder)}</pre>
      </section>

      {notice ? <p className="quiet api-notice">{notice}</p> : null}

      <footer className="page-foot">
        <button type="button" onClick={() => go("/docs")}>Read the docs</button>
        <button type="button" onClick={() => go("/method")}>Scoring method</button>
        <button type="button" onClick={() => go("/app")}>Open app</button>
      </footer>
    </div>
  );
}
