import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { formatKeyRemaining, KEY_LIFETIMES, keyActive, keyLifetime } from "../engine/keylife";
import { clearApiKey, loadApiKey, saveApiKey } from "../storage";
import { Chrome } from "./site";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const appId = import.meta.env.VITE_PRIVY_APP_ID ?? "";

type Service = {
  id: string;
  method: "GET" | "POST";
  path: string;
  title: string;
  returns: string;
  send: string;
  back: string;
  limit: string;
  sample: (origin: string) => string;
};

type KeyRecord = {
  prefix: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
};

const SERVICES: Service[] = [
  {
    id: "index",
    method: "GET",
    path: "/api/v1",
    title: "Service list",
    returns: "Name, base path, and each service",
    send: "The Authorization header only.",
    back: "JSON with name, base, and a services array. Each item has a method, a path, and a short description.",
    limit: "This call does not read a wallet and does not change a score.",
    sample: (origin) => `curl ${origin}/api/v1 \\\n  -H "Authorization: Bearer kt_your_key"`,
  },
  {
    id: "rpc",
    method: "POST",
    path: "/api/v1/rpc",
    title: "Chain read",
    returns: "The Solana node result",
    send: "A JSON-RPC body with jsonrpc, id, method, and params when the method needs them.",
    back: "The node result. If the first node does not answer, the request tries the public nodes.",
    limit: "Outside callers use this path. The open /rpc path is for the app.",
    sample: (origin) =>
      `curl ${origin}/api/v1/rpc \\\n  -H "Authorization: Bearer kt_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"getHealth\\"}"`,
  },
  {
    id: "rugcheck",
    method: "GET",
    path: "/api/v1/rugcheck?mint=",
    title: "Token risk",
    returns: "Score, band, authorities, and risks",
    send: "mint, a Solana mint address.",
    back: "Mint, name, symbol, RugCheck score, normalised score, band, authorities, and any risks that were present. Good is a raw score under 1000. Warning runs through 5000. Above that is Danger.",
    limit: "This number stays separate from the KaziTrust score. Executable contracts are not sent here.",
    sample: (origin) => `curl "${origin}/api/v1/rugcheck?mint=${USDC}" \\\n  -H "Authorization: Bearer kt_your_key"`,
  },
  {
    id: "restrictions",
    method: "GET",
    path: "/api/v1/restrictions",
    title: "Blocked list",
    returns: "Published Solana SDN addresses",
    send: "The Authorization header only.",
    back: "A source name, the fetch time, and entries of address and name.",
    limit: "This is the OFAC SDN list currently published. It is not a finding about a person.",
    sample: (origin) => `curl ${origin}/api/v1/restrictions \\\n  -H "Authorization: Bearer kt_your_key"`,
  },
  {
    id: "solscan",
    method: "GET",
    path: "/api/v1/solscan?path=&address=",
    title: "Labels and activity",
    returns: "A label, a portfolio, or recent activity",
    send: "address, plus path set to account/metadata, account/portfolio, or account/defi/activities.",
    back: "The selected account read for that address.",
    limit: "Any other path is rejected.",
    sample: (origin) =>
      `curl "${origin}/api/v1/solscan?path=account/metadata&address=${USDC}" \\\n  -H "Authorization: Bearer kt_your_key"`,
  },
  {
    id: "wording",
    method: "POST",
    path: "/api/v1/wording",
    title: "Wording",
    returns: "Sentences for a read",
    send: "JSON. Use kind chat with a question, or kind explain with a question and a facts object.",
    back: "A chat answer comes back as text and followups. An explain answer comes back as summary, meaning, nextStep, and followups.",
    limit: "The key does not change a score.",
    sample: (origin) =>
      `curl ${origin}/api/v1/wording \\\n  -H "Authorization: Bearer kt_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d "{\\"kind\\":\\"chat\\",\\"question\\":\\"What does a low score mean?\\"}"`,
  },
];

const CODES = [
  ["401", "The key is missing, retired, or not in the Authorization header."],
  ["404", "The path is not a service on this key, or the method does not match."],
  ["405", "The key endpoint was called with a method other than GET or POST."],
  ["502", "The service did not answer, or the chain nodes did not answer."],
  ["503", "Labels, wording, token risk, or the blocked list is not configured on this server."],
];

export function ApiDesk() {
  const { authenticated, getAccessToken } = usePrivy();
  return <ApiKeys getAccessToken={authenticated ? getAccessToken : undefined} />;
}

export function ApiEntry({ go }: { go: (to: string) => void }) {
  if (!appId) {
    if (import.meta.env.DEV) return <LeaveForKey go={go} />;
    return (
      <Chrome path="/api" go={go}>
        <ApiPublic />
      </Chrome>
    );
  }
  return <ApiEntrySession go={go} />;
}

function LeaveForKey({ go }: { go: (to: string) => void }) {
  useEffect(() => {
    go("/app/api");
  }, [go]);
  return (
    <div className="api-page wrap">
      <p className="quiet">Opening your key.</p>
    </div>
  );
}

function ApiEntrySession({ go }: { go: (to: string) => void }) {
  const { ready, authenticated, user } = usePrivy();
  const signedIn = authenticated || Boolean(user);
  const openKey = import.meta.env.DEV || (ready && signedIn);
  useEffect(() => {
    if (openKey) go("/app/api");
  }, [openKey, go]);
  if (openKey || !ready) {
    return (
      <div className="api-page wrap">
        <p className="quiet">{openKey ? "Opening your key." : "Checking your session."}</p>
      </div>
    );
  }
  return (
    <Chrome path="/api" go={go}>
      <ApiPublic />
    </Chrome>
  );
}

function ApiPublic() {
  const [picked, setPicked] = useState(SERVICES[0].id);
  const [notice, setNotice] = useState("");
  const origin = window.location.origin;
  const service = SERVICES.find((item) => item.id === picked) ?? SERVICES[0];

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Request copied.");
    } catch {
      setNotice("The browser did not allow the copy.");
    }
  }

  return (
    <div className="api-page wrap">
      <header className="page-head">
        <p className="eyebrow">API</p>
        <h1>One key for every service</h1>
        <p className="lede">Send your key with each request. Choose a service to see the path, what to send, and what comes back.</p>
      </header>

      <section className="api-board" aria-label="How to call">
        <dl className="api-facts">
          <div>
            <dt>Base URL</dt>
            <dd className="num">{origin}/api/v1</dd>
          </div>
          <div>
            <dt>Authorization</dt>
            <dd className="num">Bearer kt_...</dd>
          </div>
          <div>
            <dt>Session</dt>
            <dd>Not used on these calls</dd>
          </div>
        </dl>
        <ol className="api-steps">
          <li><span>1</span>Send the key as Authorization: Bearer kt_...</li>
          <li><span>2</span>Call a path under {origin}/api/v1.</li>
          <li><span>3</span>Read the status code and the JSON body.</li>
        </ol>
      </section>

      <div className="api-work">
        <section className="api-services" id="services" aria-label="Services">
          <div className="api-meta">
            <h2>Services</h2>
          </div>
          <div className="api-table">
            <div className="api-head" aria-hidden="true">
              <span>Method</span>
              <span>Path</span>
              <span>Returns</span>
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
                    <span>{item.returns}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="api-try" id="request" aria-label={service.title}>
          <div className="api-meta">
            <h2>{service.title}</h2>
            <button type="button" className="btn ghost" onClick={() => void copy(service.sample(origin))}>
              Copy request
            </button>
          </div>
          <dl className="api-spec">
            <div>
              <dt>Method</dt>
              <dd>{service.method}</dd>
            </div>
            <div>
              <dt>Path</dt>
              <dd className="num">{service.path}</dd>
            </div>
            <div>
              <dt>Send</dt>
              <dd>{service.send}</dd>
            </div>
            <div>
              <dt>Returns</dt>
              <dd>{service.back}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{service.limit}</dd>
            </div>
          </dl>
          <pre className="code">{service.sample(origin)}</pre>
          {notice ? <p className="quiet api-notice">{notice}</p> : null}
        </aside>
      </div>

      <section className="api-errors" id="errors" aria-labelledby="api-errors-title">
        <h2 id="api-errors-title">Status codes</h2>
        <div className="api-codes">
          <div className="api-head" aria-hidden="true">
            <span>Status</span>
            <span>Meaning</span>
          </div>
          <ul>
            {CODES.map(([code, meaning]) => (
              <li key={code}>
                <span className="num">{code}</span>
                <span>{meaning}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function ApiKeys({ getAccessToken }: { getAccessToken?: () => Promise<string | null> }) {
  const origin = window.location.origin;
  const tokenRef = useRef(getAccessToken);
  tokenRef.current = getAccessToken;
  const [record, setRecord] = useState<KeyRecord | null>(null);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hours, setHours] = useState(24);
  const [now, setNow] = useState(() => Date.now());
  const bearer = secret || "kt_your_key";
  const life = keyLifetime(hours) ?? KEY_LIFETIMES[2];
  const ends = record?.expiresAt ? Date.parse(record.expiresAt) : NaN;
  const remaining = Number.isFinite(ends) ? ends - now : null;
  const expired = Boolean(record) && (remaining !== null ? remaining <= 0 : !record?.active);
  const liveKey = Boolean(record) && !expired;

  useEffect(() => {
    if (!record?.expiresAt || expired) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [record?.expiresAt, expired]);

  useEffect(() => {
    if (!expired || !secret) return;
    setSecret("");
    clearApiKey();
  }, [expired, secret]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const next = await readRecord(await sessionHeaders(tokenRef.current));
        if (!live) return;
        const saved = loadApiKey();
        if (next && saved?.prefix === next.prefix) {
          setRecord(next);
          if (next.active && keyActive(saved.expiresAt)) setSecret(saved.key);
          else clearApiKey();
        } else if (next) {
          if (saved) clearApiKey();
          setRecord(next);
        } else if (saved && keyActive(saved.expiresAt)) {
          setRecord({ prefix: saved.prefix, createdAt: saved.createdAt, expiresAt: saved.expiresAt ?? null, active: true });
          setSecret(saved.key);
        } else if (saved) {
          clearApiKey();
        }
      } catch (caught) {
        if (!live) return;
        const saved = loadApiKey();
        if (saved && keyActive(saved.expiresAt)) {
          setRecord({ prefix: saved.prefix, createdAt: saved.createdAt, expiresAt: saved.expiresAt ?? null, active: true });
          setSecret(saved.key);
          return;
        }
        if (saved) clearApiKey();
        setError(caught instanceof Error ? caught.message : "The key service did not answer.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function issue() {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const headers = await sessionHeaders(tokenRef.current);
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ hours: life.hours }),
      });
      const body = (await response.json().catch(() => null)) as { key?: string; prefix?: string; createdAt?: string; expiresAt?: string; error?: string } | null;
      if (!response.ok || !body?.key?.startsWith("kt_") || !body.prefix || !body.createdAt || !body.expiresAt) {
        throw new Error(keyFailure(response.status, body?.error));
      }
      const issued = { key: body.key, prefix: body.prefix, createdAt: body.createdAt, expiresAt: body.expiresAt };
      saveApiKey(issued);
      setRecord({ prefix: issued.prefix, createdAt: issued.createdAt, expiresAt: issued.expiresAt, active: true });
      setSecret(issued.key);
      setNow(Date.now());
      setConfirm(false);
      setNotice(`Key created. It stops after ${life.label}. Copy it now.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The key service did not answer.");
    } finally {
      setWorking(false);
    }
  }

  async function copy(value: string, done: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(done);
      setError("");
    } catch {
      setNotice("");
      setError("The browser did not allow the copy.");
    }
  }

  return (
    <div className="api-page api-keys wrap">
      <header className="page-head">
        <h1>Your key</h1>
        <p className="lede">Create the key for every service. Choose how long it stays active. It is shown in full once, and it stops when that time ends.</p>
      </header>

      <section className="api-key" aria-label="Your key">
        <dl className="api-key-facts">
          <div>
            <dt>Status</dt>
            <dd>{loading ? "Checking" : expired ? "Expired" : liveKey ? "Active" : "Not issued"}</dd>
          </div>
          <div>
            <dt>Prefix</dt>
            <dd className="num">{record?.prefix ?? "None"}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd className="num">{record ? issuedOn(record.createdAt) : "None"}</dd>
          </div>
          <div>
            <dt>Time left</dt>
            <dd className="num">{loading ? "Checking" : !record ? life.label : remaining === null ? "No end time" : formatKeyRemaining(remaining)}</dd>
          </div>
        </dl>
        <div className="api-key-body">
          <p className="api-key-value num">{loading ? "Checking your key." : secret || (record ? `${record.prefix}…` : "No key yet.")}</p>
          <p className="quiet">
            {expired
              ? "This key has stopped. Calls with it are refused. Create a new key and choose a new lifetime."
              : secret
                ? "This browser holds the full key. Leave it here, or copy it into the client that will call the API. The countdown above is the time left before it stops."
                : liveKey
                  ? "The full key stays in the browser that created it. Create a new key to see a full value again."
                  : "Choose a lifetime, then create a key. Send it as Authorization: Bearer on each call."}
          </p>
          <fieldset className="api-key-life">
            <legend>{liveKey ? "Next key stays active for" : "This key stays active for"}</legend>
            <div className="api-key-life-options" role="radiogroup" aria-label="Key lifetime">
              {KEY_LIFETIMES.map((option) => (
                <label key={option.hours}>
                  <input
                    type="radio"
                    name="key-lifetime"
                    value={option.hours}
                    checked={hours === option.hours}
                    onChange={() => setHours(option.hours)}
                    disabled={working || loading}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="api-key-actions">
            <p className="quiet">{confirm ? `The current key stops working. The new key stays active for ${life.label}.` : liveKey ? "A new key retires the previous one." : `The key stops after ${life.label}.`}</p>
            <div className="api-key-buttons">
              {secret && !expired ? (
                <button type="button" className="btn ink" onClick={() => void copy(secret, "Key copied.")} disabled={working}>
                  Copy key
                </button>
              ) : null}
              {confirm ? (
                <>
                  <button type="button" className="btn ghost" onClick={() => setConfirm(false)} disabled={working}>
                    Cancel
                  </button>
                  <button type="button" className="btn ink" onClick={() => void issue()} disabled={working || loading}>
                    {working ? "Replacing" : "Replace this key"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={secret ? "btn ghost" : "btn ink"}
                  onClick={() => (liveKey ? setConfirm(true) : void issue())}
                  disabled={working || loading}
                >
                  {working ? "Creating" : liveKey ? "Replace key" : "Create a key"}
                </button>
              )}
            </div>
          </div>
          {notice ? <p className="quiet api-notice">{notice}</p> : null}
          {error ? <p className="api-notice">{error}</p> : null}
        </div>
      </section>

      <div className="api-key-grid">
        <section className="api-key-block" aria-label="How to send the key">
          <h2>Send</h2>
          <dl>
            <div>
              <dt>Authorization</dt>
              <dd className="num">Bearer {record ? `${record.prefix}…` : "kt_..."}</dd>
            </div>
            <div>
              <dt>Base URL</dt>
              <dd className="num">{origin}/api/v1</dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd>Not used on these calls</dd>
            </div>
          </dl>
        </section>
        <section className="api-key-block" aria-label="First call">
          <div className="api-meta">
            <h2>First call</h2>
            <button type="button" className="btn ghost" onClick={() => void copy(`curl ${origin}/api/v1 \\\n  -H "Authorization: Bearer ${bearer}"`, "Request copied.")}>
              Copy request
            </button>
          </div>
          <pre className="code">{`curl ${origin}/api/v1 \\\n  -H "Authorization: Bearer ${bearer}"`}</pre>
        </section>
      </div>

      <section className="api-key-block" aria-labelledby="api-opens-title">
        <h2 id="api-opens-title">What this key opens</h2>
        <ul className="api-open-list">
          {SERVICES.map((item) => (
            <li key={item.id}>
              <span className="api-method">{item.method}</span>
              <strong>{item.title}</strong>
              <code>{item.path}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

async function sessionHeaders(readToken: (() => Promise<string | null>) | undefined): Promise<HeadersInit> {
  if (!readToken) return {};
  try {
    const token = await readToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function readRecord(headers: HeadersInit): Promise<KeyRecord | null> {
  const response = await fetch("/api/keys", { headers, credentials: "include" });
  const body = (await response.json().catch(() => null)) as { key?: KeyRecord | null; error?: string } | null;
  if (!response.ok) throw new Error(keyFailure(response.status, body?.error));
  const key = body?.key;
  if (!key?.prefix || !key.createdAt) return null;
  const expiresAt = typeof key.expiresAt === "string" && Number.isFinite(Date.parse(key.expiresAt)) ? key.expiresAt : null;
  const active = typeof key.active === "boolean" ? key.active : keyActive(expiresAt);
  return { prefix: key.prefix, createdAt: key.createdAt, expiresAt, active };
}

function keyFailure(status: number, error?: string): string {
  if (status === 401 || error === "Sign in before creating a key.") return "Sign in again, then create the key.";
  if (status === 400 || error === "Choose how long the key stays active.") return "Choose how long the key stays active.";
  if (error === "Sign-in is not configured.") return "Sign-in is not configured on this server.";
  return "The key service did not answer.";
}

function issuedOn(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
