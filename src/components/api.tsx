import { useState } from "react";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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

export function ApiAccess() {
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
