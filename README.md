<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="readme/header-dark.png" />
    <img src="readme/header-light.png" width="409" alt="KaziTrust AI. Know the Wallet, Measure the Risk, Protect Your Assets." />
  </picture>
</div>

<p align="center">
  <a href="https://kazitrustai.fun">kazitrustai.fun</a>
</p>

## On this page

- [What it does](#what-it-does)
- [How a read works](#how-a-read-works)
- [The score](#the-score)
- [Sign in](#sign-in)
- [The API](#the-api)
- [MCP for ChatGPT and OpenAI](#mcp-for-chatgpt-and-openai)
- [Analytics](#analytics)
- [Run it locally](#run-it-locally)
- [Limits](#limits)
- [Privacy](#privacy)

## What it does

KaziTrust reads a public Solana address. You get a score, a band, a few findings, and the evidence behind them. The same services are available through one API key.

## How a read works

### Quick read

A quick read stays on the latest activity. It uses the newest 25 signatures and opens 4 transactions.

### Deep scan

A deep scan looks further. It walks up to 80 signatures, opens 16 transactions from both ends of that window, and reads the oldest funding address. It does not walk the entire chain.

## The score

The score runs from 0 to 100.

| Band | Score |
| --- | --- |
| Low | 0 to 24 |
| Guarded | 25 to 49 |
| Elevated | 50 to 74 |
| High | 75 to 100 |

A blocked address is scored 96. A wallet with no score is shown as Caution. RugCheck is a separate token check, and it does not move this number.

## Sign in

On the live app, sign in before a wallet read. You can use email or Google. On your own machine, the local app opens without that step.

## The API

Signed out, `/api` explains each call. Signed in, the API control in the app creates your key.

### The key

One key is active. It starts with `kt_`. A new key replaces the old one, and the old key stops working. The server stores a hash in `data/api-keys.json`, which is not committed. The full key stays in the browser that created it.

`GET /api/keys` returns the prefix and the time the key was created. `POST /api/keys` returns the full key once. On a production build, that post requires a signed-in session.

### Services

The live base URL is `https://kazitrustai.fun/api/v1`. Send the key on every call.

```bash
curl https://kazitrustai.fun/api/v1 \
  -H "Authorization: Bearer kt_your_key"
```

The app does not need this key. The open `/rpc` path is for the app. Outside callers use `/api/v1/rpc`.

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/v1` | The service list. |
| POST | `/api/v1/rpc` | The Solana node result. Send a normal JSON-RPC body. |
| GET | `/api/v1/rugcheck?mint=` | Token risk for one mint. |
| GET | `/api/v1/restrictions` | Published Solana addresses from the OFAC SDN list. |
| GET | `/api/v1/solscan?path=&address=` | A label, a portfolio, or recent activity. |
| POST | `/api/v1/wording` | Sentences for a read. |

For token risk, Good is a raw score under 1000, Warning runs through 5000, and above that is Danger.

For labels and activity, `path` is `account/metadata`, `account/portfolio`, or `account/defi/activities`.

For wording, send JSON. Use `kind` `chat` with a question, or `kind` `explain` with a question and a facts object. A chat answer comes back as text and followups. An explain answer comes back as summary, meaning, nextStep, and followups. The key does not change a score.

Post bodies must be JSON and stay under 200,000 bytes.

## MCP for ChatGPT and OpenAI

KaziTrust exposes a remote Model Context Protocol server so ChatGPT, the OpenAI Responses API, and local MCP clients can call the same Solana screening tools.

### Remote endpoint

```
https://www.kazitrustai.fun/mcp
```

Transport is Streamable HTTP over JSON-RPC `POST`. `GET /mcp` returns a short discovery document. Do not paste the URL into a normal chat. Add it in connector / MCP settings.

In Claude: Settings → Connectors → Add custom connector. If there is no Request headers / API key field, paste `https://www.kazitrustai.fun/mcp/kt_YOUR_KEY`. If Request headers is available, use the plain `/mcp` URL and set `Authorization` to `Bearer kt_YOUR_KEY`.

In ChatGPT: add a custom MCP server with the same base URL. For hosted chain and RugCheck tools, send a KaziTrust API key as a bearer token. `search`, `fetch`, `screen_address`, and `list_services` work without a key.

OpenAI Responses API example:

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-5.4",
    "tools": [{
      "type": "mcp",
      "server_label": "kazitrust",
      "server_description": "Solana wallet risk, restriction lists, and token checks.",
      "server_url": "https://www.kazitrustai.fun/mcp",
      "authorization": "Bearer kt_your_key",
      "require_approval": "never"
    }],
    "input": "Screen AffzFDKZbyMiU11zmVBoAqD25ugpr7xoWWyRyGigBEaU with KaziTrust."
  }'
```

### Tools

| Tool | Purpose |
| --- | --- |
| `search` / `fetch` | Method docs and published watchlist notes for ChatGPT research compatibility |
| `screen_address` | Exact match on OFAC SDN (when reachable), Meteora Kelsier, and Binance hack 2026 Solana IOCs |
| `wallet_snapshot` | Live balance, owner, and recent signatures |
| `token_risk` | RugCheck mint report |
| `list_services` | API and MCP catalog |

### Local MCP

```bash
npm run test:mcp
npm run mcp
npm run mcp:http
```

`npm run mcp` speaks stdio for Cursor-style clients. `npm run mcp:http` listens on `http://127.0.0.1:8787/mcp`. Local Vite also mounts `/mcp` during `npm run dev`.

## Analytics

KaziTrust records product, API, and MCP usage so successes and failures are visible without blocking a read.

| Source | What is captured |
| --- | --- |
| UI | Page views, sign-in/out, wallet reads (start/complete/error/quota), watchlist pins, mode changes, PDF export, file attach, API key create, client errors |
| API | `/api/v1` gateway calls, RPC, RugCheck, restrictions, Solscan, wording, key issue |
| MCP | `initialize`, `tools/list`, `tools/call` with tool name, latency, and error text |

Events POST to `/api/analytics`. They always emit a structured `kazitrust_analytics` log line. Locally they append to `data/analytics.jsonl` (gitignored). With Upstash/Vercel KV env vars set, counters and recent failures persist across serverless cold starts.

```bash
curl "https://kazitrustai.fun/api/analytics?limit=40" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN"
```

The summary returns totals, counts by event/tool/route, and recent failures so broken MCP or API calls are easy to spot.

Also fixed for production reliability: `/api/v1/*` now exists on Vercel, `/api/solscan` is hosted, MCP falls back from `/api/v1` to `/api/*` and `/rpc` when needed, and `kt_` keys are accepted on hosted tool routes (with optional Upstash key hash persistence).

### Status codes

| Status | Meaning |
| --- | --- |
| 401 | The key is missing, retired, or not in the Authorization header. Creating a key on a production build without signing in also returns 401. |
| 404 | The path is not a service on this key, or the method does not match. |
| 405 | `/api/keys` was called with a method other than GET or POST. |
| 502 | The service did not answer, or the chain nodes did not answer. |
| 503 | Sign-in, labels, wording, token risk, or the blocked list is not configured. |

## Run it locally

```bash
npm install
```

Copy `.env.example` to `.env`. Fill only the lines you intend to use. An empty line leaves that service off. Chain reads still fall back to public Solana nodes.

### Settings

| Name | What it unlocks |
| --- | --- |
| `GROQ_API_KEY` | Wording. Sentences only. It does not change a score. |
| `PRIVY_APP_ID`, `VITE_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Sign-in. Required before a key can be created on a production build. The Privy app must allow `https://kazitrustai.fun` and `https://www.kazitrustai.fun`. |
| `SOLSCAN_API_KEY` | Labels, portfolio, and recent DeFi activity. |
| `RUGCHECK_API_KEY` | Token risk for a mint. That number stays separate from the KaziTrust score. |
| `FLUX_RPC_URL` | The first Solana node. Public nodes are the fallback. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Durable analytics counters and API key hash storage. |
| `ANALYTICS_TOKEN` | Required to read `GET /api/analytics` summaries. |
| `KAZITRUST_API_KEY_HASH` | Optional sha256 hex of a fixed `kt_` key for gateway checks. |

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. The docs are at `/docs`. The API page is at `/api`.

`npm run build`, then `npm run preview`, serves a production preview on port 4173. `/api/v1` requires the key on both servers. On a production build, `POST /api/keys` requires a signed-in session.

## Limits

It will not invent a hop, a label, or a dollar value. It will not name a person. It will not ask you to sign a transaction. The wording service restates what the tools returned. It does not change the number, the band, or the addresses.

## Privacy

Chats, the watchlist, the daily counter, and the full API key stay in this browser. The server keeps a hash of the active key. Chain queries contain the address you asked about.

Scores are indicators. They are a probabilistic read of public data. They are not a finding about any person, and they are not financial, legal, or tax advice.
