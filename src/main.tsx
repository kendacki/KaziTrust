import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import { AuthRoot } from "./auth";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthRoot>
      <App />
      <Analytics />
    </AuthRoot>
  </StrictMode>,
);
