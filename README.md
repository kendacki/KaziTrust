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
