import assert from "node:assert/strict";
import { ingestClientEvents, summarize, track } from "../analytics.mjs";
import { keyFromUrl, normalizeApiKey } from "../auth.mjs";
import { callTool } from "../handlers.mjs";
import { consumeKeyRead, dailyReadLimit, issueApiKey, resolveApiKey } from "../keyauth.mjs";
import { handleMcpMessage } from "../protocol.mjs";
import { openModeEnabled, redactSecrets } from "../security.mjs";

const env = {
  ...process.env,
  KAZITRUST_MCP_OPEN: "1",
  KAZITRUST_BASE_URL: process.env.KAZITRUST_BASE_URL || "https://www.kazitrustai.fun",
  VERCEL_ENV: "development",
  KAZITRUST_API_DAILY_READS: "3",
  PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET || "smoke-privy-secret-for-signed-keys",
};

assert.equal(normalizeApiKey("Bearer kt_abc123"), "kt_abc123");
assert.equal(keyFromUrl("https://www.kazitrustai.fun/mcp/kt_abc123"), "kt_abc123");
assert.equal(keyFromUrl("https://www.kazitrustai.fun/mcp?key=kt_abc123"), "kt_abc123");
assert.match(redactSecrets("Bearer kt_abc123def4567890abcd"), /Bearer …|kt_abc12…/);
assert.equal(openModeEnabled({ KAZITRUST_MCP_OPEN: "1", VERCEL_ENV: "production" }), false);
assert.equal(openModeEnabled({ KAZITRUST_MCP_OPEN: "1", VERCEL_ENV: "development" }), true);
assert.equal(dailyReadLimit({ KAZITRUST_API_DAILY_READS: "3" }), 3);

const gated = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 99,
    method: "tools/call",
    params: { name: "wallet_snapshot", arguments: { address: "11111111111111111111111111111111" } },
  },
  { ...process.env, KAZITRUST_BASE_URL: env.KAZITRUST_BASE_URL, VERCEL_ENV: "production" },
);
assert.equal(gated.error?.code, -32001);

const prodEnv = {
  ...process.env,
  VERCEL_ENV: "production",
  PRIVY_APP_SECRET: env.PRIVY_APP_SECRET,
  KAZITRUST_API_DAILY_READS: "2",
};
const issued = await issueApiKey(
  { hours: 1, purpose: "development", ownerId: "did:privy:smoke", readLimit: 2 },
  prodEnv,
);
assert.match(issued.key, /^kt_[a-f0-9]{32}_/i);
const resolved = await resolveApiKey(issued.key, {}, prodEnv);
assert.equal(resolved.ok, true);
assert.equal(keyFromUrl(`https://www.kazitrustai.fun/mcp/${issued.key}`), issued.key);

const first = await consumeKeyRead(issued.key, {}, prodEnv);
assert.equal(first.ok, true);
assert.equal(first.remaining, 1);
const second = await consumeKeyRead(issued.key, {}, prodEnv);
assert.equal(second.ok, true);
assert.equal(second.remaining, 0);
const third = await consumeKeyRead(issued.key, {}, prodEnv);
assert.equal(third.ok, false);

const badKey = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 100,
    method: "tools/call",
    params: {
      name: "token_risk",
      arguments: { mint: "So11111111111111111111111111111111111111112", api_key: "kt_smoke_key_for_auth_gate" },
    },
  },
  { ...process.env, KAZITRUST_BASE_URL: env.KAZITRUST_BASE_URL, VERCEL_ENV: "production", PRIVY_APP_SECRET: env.PRIVY_APP_SECRET },
);
assert.equal(badKey.error?.code, -32001);
assert.match(String(badKey.error?.message || ""), /invalid or expired|API key/i);

const snapKey = await issueApiKey(
  { hours: 1, purpose: "development", ownerId: "did:privy:smoke-snap", readLimit: 30 },
  { ...prodEnv, KAZITRUST_API_DAILY_READS: "30" },
);
const goodSnap = await handleMcpMessage(
  {
    jsonrpc: "2.0",
    id: 101,
    method: "tools/call",
    params: {
      name: "wallet_snapshot",
      arguments: { address: "not-an-address", api_key: snapKey.key },
    },
  },
  { ...process.env, KAZITRUST_BASE_URL: env.KAZITRUST_BASE_URL, VERCEL_ENV: "production", PRIVY_APP_SECRET: env.PRIVY_APP_SECRET, KAZITRUST_API_DAILY_READS: "30" },
);
assert.equal(goodSnap.error, undefined);
assert.equal(goodSnap.result?.isError, true);

function ok(reply) {
  assert.equal(reply.jsonrpc, "2.0");
  assert.ok(reply.result, JSON.stringify(reply));
  return reply.result;
}

const init = ok(
  await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "kazitrust-smoke", version: "0.0.1" },
      },
    },
    env,
  ),
);
assert.equal(init.serverInfo.name, "kazitrust");
assert.match(init.instructions, /Solana/);

const listed = ok(await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, env));
const names = listed.tools.map((tool) => tool.name).sort();
assert.deepEqual(names, ["fetch", "list_services", "screen_address", "search", "token_risk", "wallet_snapshot"].sort());

const search = ok(
  await handleMcpMessage(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search", arguments: { query: "binance hack" } },
    },
    env,
  ),
);
assert.ok(search.structuredContent.results.some((item) => item.id === "binance-hack-2026"));

const screened = await callTool("screen_address", { address: "AffzFDKZbyMiU11zmVBoAqD25ugpr7xoWWyRyGigBEaU" }, env);
assert.equal(screened.isError, undefined);
assert.equal(screened.structuredContent.listed, true);
assert.ok(screened.structuredContent.matches.some((item) => item.list === "binance-hack-2026"));

const clear = await callTool("screen_address", { address: "11111111111111111111111111111111" }, env);
assert.equal(clear.structuredContent.listed, false);

const services = await callTool("list_services", {}, env);
assert.equal(services.structuredContent.scoringVersion, "0.4.3");
assert.ok(services.structuredContent.mcp.includes("/mcp"));

await track({ source: "api", name: "smoke_api", ok: true, meta: { route: "/api/v1" } }, env);
await ingestClientEvents([{ name: "page_view", meta: { route: "/app" } }], env);
const stats = await summarize(env, { limit: 20 });
assert.equal(stats.ok, true);
assert.ok(Number(stats.totals?.events || 0) >= 1);
assert.ok(stats.byName?.["tools/call"] || stats.byName?.initialize || stats.totals.mcp >= 1);

console.log("mcp smoke ok");
console.log(
  JSON.stringify(
    {
      tools: names,
      binanceListed: screened.structuredContent.listed,
      scoringVersion: services.structuredContent.scoringVersion,
      analyticsEvents: stats.totals.events,
      analyticsFailed: stats.totals.failed,
    },
    null,
    2,
  ),
);
