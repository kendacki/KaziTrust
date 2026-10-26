import { formatTime } from "../format";
import type { Finding, Report, Visual } from "../types";

const sampleEvidence = {
  kind: "read" as const,
  label: "Illustrative row. Not a chain signature.",
};

function finding(
  id: string,
  title: string,
  severity: Finding["severity"],
  severityWord: string,
  confidence: number,
  explanation: string,
): Finding {
  return { id, title, severity, severityWord, confidence, explanation, evidence: [sampleEvidence] };
}

export function sampleDeployerReport(): Report {
  const findings: Finding[] = [
    finding(
      "launches",
      "Launched six tokens in 30 days, and five lost most liquidity within 48 hours.",
      "elevated",
      "Elevated",
      0.74,
      "In this sample, the deployer record is the main reason the band is Elevated. A live read would cite each mint and the liquidity transactions.",
    ),
    finding(
      "funding",
      "First funded by a wallet that also funded two earlier deployers.",
      "watch",
      "Watch",
      0.66,
      "The sample funding trail stops at a shared source. KaziTrust would show the signatures for each hop, and it would not call that source a person.",
    ),
    finding(
      "mixer",
      "No mixer exposure found in the sample window.",
      "clean",
      "Clean",
      0.81,
      "A clean line appears only when the check ran. Here it is part of the illustration, so it is not a live clearance.",
    ),
    finding(
      "freeze",
      "Holds freeze authority on its current token.",
      "watch",
      "Watch",
      0.9,
      "Freeze authority lets the mint freeze holder accounts. The live engine flags this only when the mint account itself reports the authority.",
    ),
  ];

  const visuals: Visual[] = [
    {
      type: "funding",
      caption: "Sample path. The live trail uses the oldest transaction the scan actually reached.",
      hops: [
        { label: "Shared source", detail: "Two earlier deployers" },
        { label: "Intermediate", detail: "One hop" },
        { label: "7xKp…q9Rd", detail: "Wallet under review" },
      ],
    },
    {
      type: "cluster",
      caption: "Sample cluster. Edge weight is transfer count, not identity.",
      center: "wallet",
      nodes: [
        { id: "wallet", label: "7xKp…q9Rd", volume: 8 },
        { id: "a", label: "Deployer A", volume: 5 },
        { id: "b", label: "Deployer B", volume: 4 },
        { id: "f", label: "Shared source", volume: 6 },
      ],
      edges: [
        { a: "wallet", b: "f", volume: 2 },
        { a: "a", b: "f", volume: 2 },
        { a: "b", b: "f", volume: 2 },
        { a: "wallet", b: "a", volume: 1 },
      ],
    },
    {
      type: "timeline",
      caption: "Sample events, in order.",
      events: [
        { time: "12 Sep", title: "First funded", detail: "From the shared source" },
        { time: "18 Sep", title: "First token launch", detail: "Liquidity gone in a day" },
        { time: "2 Oct", title: "Sixth launch", detail: "Freeze authority retained" },
      ],
    },
  ];

  return {
    kind: "sample",
    wallet: "sample-deployer",
    displayAddress: "7xKp…q9Rd",
    typeGuess: "Token deployer",
    riskScore: 72,
    band: "Elevated",
    confidence: "medium",
    confidenceLabel: "Confidence medium",
    scoringVersion: "0.1.0-sample",
    dataAsOf: `Illustrative sample, shown ${formatTime(Math.floor(Date.now() / 1000))}`,
    summary:
      "This is a sample deployer read, not a live chain query. The score is 72, Elevated, because the illustrated record is repeated launches that lost liquidity, plus a shared funding source and a freeze authority.",
    meaning:
      "A trader would slow down before buying the current token. A venue would ask for the live evidence view before allowlisting the address. The next useful step is a real address, where every line has to come from a transaction or an account read.",
    nextStep: "Paste a Solana address to replace this sample with a live read.",
    findings,
    visuals,
    rules: [
      { id: "base", points: 22, detail: "Sample base" },
      { id: "launches", points: 28, detail: "Repeated launches that lost liquidity" },
      { id: "funding", points: 14, detail: "Shared funding source with earlier deployers" },
      { id: "freeze", points: 8, detail: "Freeze authority still held" },
    ],
    tools: ["Illustrative sample. No chain call was made."],
    txCount: 0,
    warnings: ["These figures are a teaching sample. They are not a clearance or an accusation."],
    illustrative: true,
    cited: [],
  };
}
