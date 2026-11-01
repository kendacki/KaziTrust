#!/usr/bin/env node
import { createInterface } from "node:readline";
import { handleMcpMessage } from "./protocol.mjs";

process.stdin.setEncoding("utf8");
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const message = JSON.parse(trimmed);
    const reply = await handleMcpMessage(message, process.env);
    if (reply == null) return;
    const payload = Array.isArray(reply) ? reply : [reply];
    for (const item of payload) {
      process.stdout.write(`${JSON.stringify(item)}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error instanceof Error ? error.message : "Parse error" },
      })}\n`,
    );
  }
});
