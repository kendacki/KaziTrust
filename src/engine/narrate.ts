import { getAccessToken } from "@privy-io/react-auth";
import { ungroundedAddresses } from "./address";
import { RULE_CATALOG } from "./labels";
import type { Report } from "../types";

type Narration = {
  summary?: string;
  meaning?: string;
  nextStep?: string;
  text?: string;
  followups?: string[];
  model?: string;
};

function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[—–]/g, ", ").replace(/!/g, ".").trim();
}

function followups(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(clean).filter((item) => item.length > 0 && item.length < 90).slice(0, 3);
}

function grounded(text: string, report?: Report): boolean {
  if (!text) return false;
  const allowed = new Set(report?.cited ?? []);
  return ungroundedAddresses(text, allowed).length === 0;
}

async function ask(body: unknown, signal: AbortSignal): Promise<Narration | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!import.meta.env.DEV) {
    const token = await getAccessToken();
    if (!token) return null;
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch("/api/groq", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) return null;
  return (await response.json()) as Narration;
}

export async function narrateReport(question: string, report: Report, signal: AbortSignal): Promise<string[] | null> {
  const facts = {
    address: report.displayAddress,
    type: report.typeGuess,
    score: report.riskScore,
    band: report.band,
    confidence: report.confidenceLabel,
    illustrative: report.illustrative,
    signaturesRead: report.txCount,
    findings: report.findings.map((finding) => ({
      title: finding.title,
      severity: finding.severityWord,
      explanation: finding.explanation,
    })),
    rules: report.rules.map((rule) => `${rule.points > 0 ? "+" : ""}${rule.points}: ${rule.detail}`),
    warnings: report.warnings,
  };
  try {
    const narration = await ask({ kind: "explain", question, facts }, signal);
    if (!narration) return null;
    const summary = clean(narration.summary);
    const meaning = clean(narration.meaning);
    const nextStep = clean(narration.nextStep);
    const combined = `${summary}\n${meaning}\n${nextStep}`;
    if (!grounded(combined, report)) return null;
    if (summary) report.summary = summary;
    if (meaning) report.meaning = meaning;
    if (nextStep) report.nextStep = nextStep;
    if (narration.model) report.tools = [...report.tools, `Groq ${narration.model}`];
    const next = followups(narration.followups).filter((item) => grounded(item, report));
    return next.length ? next : null;
  } catch {
    return null;
  }
}

export async function narrateText(question: string, fallback: string, signal: AbortSignal): Promise<{ text: string; followups: string[] } | null> {
  const context = RULE_CATALOG.map((rule) => `${rule.title}: ${rule.detail}`).join("\n");
  try {
    const narration = await ask({ kind: "chat", question, context: `${context}\n\nFallback if you are unsure:\n${fallback}` }, signal);
    const text = clean(narration?.text) || clean(narration?.summary);
    if (!narration || !text || !grounded(text)) return null;
    return { text, followups: followups(narration.followups).filter((item) => grounded(item)) };
  } catch {
    return null;
  }
}
