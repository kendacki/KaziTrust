import assert from "node:assert/strict";
import { ingestClientEvents, summarize, track } from "../analytics.mjs";
import { callTool } from "../handlers.mjs";
import { handleMcpMessage } from "../protocol.mjs";

const env = {
  ...process.env,
  KAZITRUST_MCP_OPEN: "1",
  KAZITRUST_BASE_URL: process.env.KAZITRUST_BASE_URL || "https://kazitrustai.fun",
};

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
