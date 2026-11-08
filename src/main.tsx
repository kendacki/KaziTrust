import { Buffer } from "buffer";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { App } from "./App";
import { OptionalAnalytics } from "./components/consent";
import { warmLostFigure } from "./lost-figure";
import "./styles.css";

globalThis.Buffer = Buffer;

void warmLostFigure();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <OptionalAnalytics>{(allowed) => (allowed ? <Analytics /> : null)}</OptionalAnalytics>
  </StrictMode>,
);
