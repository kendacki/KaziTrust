import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { groqPlugin } from "./src/server/groq";
import { analyticsPlugin } from "./src/server/analytics";
import { gatewayPlugin } from "./src/server/gateway";
import { mcpPlugin } from "./src/server/mcp";
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

/** Keep the stylesheet off the critical path so first paint is not blocked by CSS. */
function deferCss(): Plugin {
  return {
    name: "kazitrust-defer-css",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(/<link rel="stylesheet"([^>]*href="[^"]+\.css"[^>]*)>/g, (_match, attrs: string) => {
        const preload = `<link rel="preload" as="style"${attrs} onload="this.onload=null;this.rel='stylesheet'">`;
        const fallback = `<noscript><link rel="stylesheet"${attrs}></noscript>`;
        return `${preload}${fallback}`;
      });
    },
  };
}

export default defineConfig({
  appType: "spa",
  plugins: [react(), spa404(), deferCss(), rpcPlugin(), groqPlugin(), solscanPlugin(), rugcheckPlugin(), restrictionsPlugin(), tokenMetaPlugin(), gatewayPlugin(), mcpPlugin(), analyticsPlugin()],
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer", "@solana/web3.js", "@solana/spl-token", "bs58"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@privy-io") || id.includes("@walletconnect") || id.includes("@coinbase")) {
              return "auth-wallet";
            }
            if (id.includes("@solana")) return "solana";
            if (id.includes("framer-motion")) return "motion";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    watch: {
      ignored: ["**/tmp/**", "**/data/**", "**/.git/**"],
    },
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
});
