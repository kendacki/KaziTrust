# KaziTrust MCP

Remote and local Model Context Protocol server for ChatGPT, Claude, OpenAI, and stdio clients.

Do not paste the MCP URL into a normal chat. Add it in the client’s connector / MCP settings.

## Endpoints

| Mode | Command / URL |
| --- | --- |
| Production HTTP | `https://www.kazitrustai.fun/mcp` |
| Local Vite | `http://127.0.0.1:5173/mcp` |
| Local HTTP | `npm run mcp:http` → `http://127.0.0.1:8787/mcp` |
| Stdio | `npm run mcp` |

### Claude

Claude’s connector dialog often has **no place to paste an API key** (Request headers is beta / org-gated).

1. Create a `kt_` key on https://www.kazitrustai.fun/api
2. Remove the old connector if you already added the plain `/mcp` URL
3. Add a custom connector with this URL (key in the path):

```text
https://www.kazitrustai.fun/mcp/kt_YOUR_KEY
```

If your Claude plan shows **Request headers**, you can instead use `https://www.kazitrustai.fun/mcp` and set:

- Header: `Authorization`
- Value: `Bearer kt_YOUR_KEY` (include the word `Bearer` and the space)

`wallet_snapshot` and `token_risk` also accept an `api_key` argument as a last resort.

## Environment

| Name | Purpose |
| --- | --- |
| `KAZITRUST_BASE_URL` | API origin. Defaults to `https://www.kazitrustai.fun`. |
| `KAZITRUST_API_KEY` | Bearer `kt_` key for `wallet_snapshot` and `token_risk` (stdio / local HTTP). |
| `KAZITRUST_MCP_OPEN` | Set to `1` to allow all tools without a key (local only). |
| `MCP_PORT` | Port for `npm run mcp:http`. Default `8787`. |

## Cursor / Claude Desktop stdio example

```json
{
  "mcpServers": {
    "kazitrust": {
      "command": "node",
      "args": ["mcp/stdio.mjs"],
      "cwd": "C:/Users/HP/Desktop/KaziTrust AI",
      "env": {
        "KAZITRUST_BASE_URL": "https://www.kazitrustai.fun",
        "KAZITRUST_API_KEY": "kt_your_key",
        "KAZITRUST_MCP_OPEN": "1"
      }
    }
  }
}
```

## Analytics

MCP tool calls are timed and recorded through `mcp/analytics.mjs` (success, failure, latency, tool name). The same store powers UI and API events at `/api/analytics`.

## Test

```bash
npm run test:mcp
```
