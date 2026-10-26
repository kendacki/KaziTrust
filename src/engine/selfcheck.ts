import { isSolanaAddress } from "./address";
import { LABELS } from "./labels";
import { investigate } from "./analyze";

for (const label of LABELS) {
  if (!isSolanaAddress(label.address)) {
    console.error("Bad label", label.name, label.address);
    process.exitCode = 1;
  }
}

const result = await investigate({
  question: "Read the Jupiter program",
  mode: "quick",
  signal: AbortSignal.timeout(40000),
  onStep: (label, state) => console.log(state, label),
});

if (result.kind !== "report") {
  console.error(result.text);
  process.exitCode = 1;
} else {
  console.log(result.report.typeGuess, result.report.riskScore, result.report.band, result.report.confidenceLabel);
  console.log(result.report.summary);
  console.log("visuals", result.report.visuals.map((item) => item.type).join(", "));
  console.log("findings", result.report.findings.length);
  console.log("warnings", result.report.warnings.join(" | "));
}
