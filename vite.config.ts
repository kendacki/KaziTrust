import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { groqPlugin } from "./src/server/groq";
import { gatewayPlugin } from "./src/server/gateway";
import { restrictionsPlugin } from "./src/server/restrictions";
import { rpcPlugin } from "./src/server/rpc";
import { rugcheckPlugin } from "./src/server/rugcheck";
import { solscanPlugin } from "./src/server/solscan";

export default defineConfig({
  plugins: [react(), rpcPlugin(), groqPlugin(), solscanPlugin(), rugcheckPlugin(), restrictionsPlugin(), gatewayPlugin()],
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    host: "127.0.0.1",
  },
});
