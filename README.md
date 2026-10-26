# KaziTrust AI

Know the Wallet. Measure the Risk. Protect Your Assets.

The app reads a public Solana address and returns a score, a band, findings, and evidence. One API key opens the same hosted services from outside the app. The live app is [https://kazitrustai.fun](https://kazitrustai.fun).

## Set up

```bash
npm install
```

Copy `.env.example` to `.env` and fill only the lines you intend to use. An empty line leaves that service off. The chain read still falls back to public Solana nodes.

| Name | What it unlocks |
| --- | --- |
| `GROQ_API_KEY` | Wording. Sentences only. It does not change a score. |
| `PRIVY_APP_ID`, `VITE_PRIVY_APP_ID`, `PRIVY_APP_SECRET` | Sign-in. Required before a key can be created on a production build. The Privy app must allow `https://kazitrustai.fun` and `https://www.kazitrustai.fun`. |
| `SOLSCAN_API_KEY` | Labels, portfolio, and recent DeFi activity. |
| `RUGCHECK_API_KEY` | Token risk for a mint. That number stays separate from the KaziTrust score. |
| `FLUX_RPC_URL` | First Solana node. Public nodes are the fallback. |

```bash
npm run dev
```

Open `http://127.0.0.1:5173`. The docs are at `/docs`. The API reference is at `/api`. That page stays open with no session, and it does not issue a key.

`npm run build`, then `npm run preview`, serves a production preview on port 4173. `/api/v1` requires the key on both servers. On a production build, `POST /api/keys` requires a signed-in session.

## The key

One key is active. It starts with `kt_`. Creating another key retires the previous one. The server stores a hash in `data/api-keys.json`, which is not committed. The full key stays in the browser that created it.

`GET /api/keys` returns the prefix and the time the key was created. `POST /api/keys` returns the full key once.

## Calling the API

The live base URL is `https://kazitrustai.fun/api/v1`. Send the key on every call.

```bash
curl https://kazitrustai.fun/api/v1 \
  -H "Authorization: Bearer kt_your_key"
```

The app itself does not need this key. The open `/rpc` path is for the app. Outside callers use `/api/v1/rpc`.

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/api/v1` | The service list. |
| POST | `/api/v1/rpc` | A Solana JSON-RPC result. Send the usual JSON-RPC body. |
| GET | `/api/v1/rugcheck?mint=` | Token risk for one mint. Good is a raw score under 1000, Warning runs through 5000, and above that is Danger. |
| GET | `/api/v1/restrictions` | OFAC SDN Solana addresses, with a source name, fetch time, and entries of address and name. |
| GET | `/api/v1/solscan?path=&address=` | `account/metadata`, `account/portfolio`, or `account/defi/activities`. |
| POST | `/api/v1/wording` | Sentences. `kind` is `chat` with a question, or `explain` with a question and a facts object. |

A chat answer comes back as `text` and `followups`. An explain answer comes back as `summary`, `meaning`, `nextStep`, and `followups`. Post bodies must be JSON and stay under 200,000 bytes.

Missing or retired keys return 401. An unknown path or the wrong method returns 404. A method other than GET or POST on `/api/keys` returns 405. A service that does not answer returns 502. A service that is not configured returns 503.

The same guide is on the docs page in the app.
