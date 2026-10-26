export type Band = "Low" | "Guarded" | "Elevated" | "High";

export type Severity = "clean" | "note" | "watch" | "elevated" | "high";

export type Evidence = {
  kind: "transaction" | "read";
  label: string;
  signature?: string;
  slot?: number;
  time?: string;
};

export type Finding = {
  id: string;
  title: string;
  severity: Severity;
  severityWord: string;
  confidence: number;
  explanation: string;
  evidence: Evidence[];
};

export type ScoreRule = {
  id: string;
  points: number;
  detail: string;
};

export type Hop = {
  label: string;
  detail: string;
};

export type ClusterNode = {
  id: string;
  label: string;
  volume: number;
};

export type HoldingRow = {
  label: string;
  amount: string;
  pct: number;
  flag?: string;
};

export type FlowRow = {
  label: string;
  amount: string;
  address?: string;
};

export type TimelineEvent = {
  time: string;
  title: string;
  detail: string;
};

export type ApprovalRow = {
  mint: string;
  delegate: string;
  amount: string;
  address?: string;
};

export type ProgramSlice = {
  label: string;
  value: number;
};

export type CompareSide = {
  address: string;
  title: string;
  score: number | null;
  band: Band | null;
  line: string;
};

export type Visual =
  | { type: "funding"; caption: string; hops: Hop[] }
  | {
      type: "cluster";
      caption: string;
      center: string;
      nodes: ClusterNode[];
      edges: { a: string; b: string; volume: number }[];
    }
  | { type: "heatmap"; caption: string; cells: number[]; peak: string }
  | { type: "timeline"; caption: string; events: TimelineEvent[] }
  | { type: "holdings"; caption: string; rows: HoldingRow[] }
  | {
      type: "counterparties";
      caption: string;
      inbound: FlowRow[];
      outbound: FlowRow[];
    }
  | { type: "approvals"; caption: string; rows: ApprovalRow[] }
  | { type: "restrictions"; caption: string; rows: { label: string; state: string; detail: string }[] }
  | { type: "rugcheck"; caption: string; rows: { label: string; state: string; detail: string }[] }
  | { type: "programs"; caption: string; slices: ProgramSlice[] }
  | { type: "compare"; caption: string; left: CompareSide; right: CompareSide }
  | {
      type: "batch";
      caption: string;
      rows: { address: string; score: number | null; band: string; line: string }[];
    };

export type Report = {
  kind: "wallet" | "compare" | "sample" | "batch";
  wallet: string;
  displayAddress: string;
  typeGuess: string;
  riskScore: number | null;
  band: Band | null;
  confidence: "low" | "medium" | "high";
  confidenceLabel: string;
  scoringVersion: string;
  dataAsOf: string;
  summary: string;
  meaning: string;
  nextStep: string;
  findings: Finding[];
  visuals: Visual[];
  rules: ScoreRule[];
  tools: string[];
  txCount: number;
  warnings: string[];
  illustrative: boolean;
  watchAddress?: string;
  cited: string[];
};

export type Answer =
  | { kind: "text"; text: string; followups: string[] }
  | { kind: "report"; report: Report; followups: string[] };

export type StepState = "active" | "done";

export type TrailStep = {
  label: string;
  state: StepState;
};
