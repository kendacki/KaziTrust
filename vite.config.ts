import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { groqPlugin } from "./src/server/groq";
import { gatewayPlugin } from "./src/server/gateway";
import { restrictionsPlugin } from "./src/server/restrictions";
import { tokenMetaPlugin } from "./src/server/tokenmeta";
import { rpcPlugin } from "./src/server/rpc";
import { rugcheckPlugin } from "./src/server/rugcheck";
import { solscanPlugin } from "./src/server/solscan";

function spa404(): Plugin {
  let outDir = "dist";
  return {
    name: "kazitrust-spa-404",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  appType: "spa",
  plugins: [react(), spa404(), rpcPlugin(), groqPlugin(), solscanPlugin(), rugcheckPlugin(), restrictionsPlugin(), tokenMetaPlugin(), gatewayPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
});
