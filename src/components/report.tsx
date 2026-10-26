import { motion } from "framer-motion";
import { shortAddress } from "../format";
import type { Finding, Report, Visual } from "../types";
import { isSolanaAddress } from "../engine/address";
import { FindingIcon, IconCopy } from "./icons";
import { Gauge, VisualFrame, VisualView, visualTitle } from "./visuals";

export function ReportView({
  report,
  onExpand,
  onEvidence,
  onPick,
}: {
  report: Report;
  onExpand: (visual: Visual) => void;
  onEvidence: (finding: Finding) => void;
  onPick: (address: string) => void;
}) {
  return (
    <motion.article className="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {report.illustrative ? <p className="banner">Illustrative sample. No chain call was made.</p> : null}
      {report.warnings.map((warning) => (
        <p className="banner" key={warning}>
          {warning}
        </p>
      ))}
      <header className="verdict">
        <div className="verdict-id">
          <p className="eyebrow">{report.typeGuess}</p>
          <div className="address-line">
            <strong className="num">{report.displayAddress}</strong>
            {isSolanaAddress(report.wallet) ? (
              <button type="button" className="icon-btn" aria-label="Copy address" onClick={() => navigator.clipboard.writeText(report.wallet)}>
                <IconCopy size={16} />
              </button>
            ) : null}
          </div>
          {isSolanaAddress(report.wallet) ? (
            <a className="quiet-link" href={`https://solscan.io/account/${report.wallet}`} target="_blank" rel="noreferrer">
              View on Solscan
            </a>
          ) : null}
        </div>
        <div className="verdict-score">
          <p className="eyebrow">Score</p>
          <p className="score num">{report.riskScore ?? "None"}</p>
          <p className="verdict-band">{report.band ?? "Unscored"}</p>
          <Gauge score={report.riskScore} band={report.band} />
          <p className="quiet">{report.confidenceLabel}</p>
        </div>
      </header>
      <section className="report-section">
        <h3>The read</h3>
        <p className="summary">{report.summary}</p>
      </section>
      {report.findings.length ? (
        <section className="report-section">
          <h3>Findings</h3>
          <motion.ul className="findings" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}>
            {report.findings.map((finding) => (
              <motion.li key={finding.id} className={`finding severity-${finding.severity}`} variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}>
                <span className="finding-icon">
                  <FindingIcon id={finding.id} />
                </span>
                <div>
                  <div className="finding-top">
                    <strong>{finding.title}</strong>
                    <span className={finding.severity === "clean" ? "clean-word" : "sev-word"}>
                      {finding.severity === "clean" ? <span className="dot" /> : null}
                      {finding.severityWord}
                    </span>
                  </div>
                  <p>{finding.explanation}</p>
                  <div className="finding-meta">
                    <span className="num">{Math.round(finding.confidence * 100)}% confidence</span>
                    <button type="button" className="text-btn" onClick={() => onEvidence(finding)}>
                      Evidence
                    </button>
                  </div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        </section>
      ) : null}
      {report.visuals.length ? (
        <section className="report-section">
          <h3>From this scan</h3>
          <div className="report-visuals">
            {report.visuals.map((visual, index) => (
              <VisualFrame key={`${visual.type}-${index}`} title={visualTitle(visual)} caption={visual.caption} onExpand={() => onExpand(visual)}>
                <VisualView visual={visual} onPick={onPick} />
              </VisualFrame>
            ))}
          </div>
        </section>
      ) : null}
      <section className="report-section meaning">
        <h3>What this means</h3>
        <p>{report.meaning}</p>
        <p>{report.nextStep}</p>
      </section>
      {report.rules.length ? (
        <section className="report-section rules">
          <h3>How this number was built</h3>
          <ul>
            {report.rules.map((rule) => (
              <li key={rule.id}>
                <span>{rule.detail}</span>
                <span className="num">{rule.points > 0 ? `+${rule.points}` : rule.points}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </motion.article>
  );
}

export function EvidenceList({ finding }: { finding: Finding }) {
  return (
    <div className="evidence">
      <p>{finding.explanation}</p>
      <ul>
        {finding.evidence.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            <span>{item.label}</span>
            {item.time ? <span className="quiet">{item.time}</span> : null}
            {item.slot ? <span className="quiet num">Slot {item.slot}</span> : null}
            {item.signature ? (
              <a href={`https://solscan.io/tx/${item.signature}`} target="_blank" rel="noreferrer">
                Solscan
              </a>
            ) : null}
            {item.signature ? (
              <button type="button" className="text-btn" onClick={() => navigator.clipboard.writeText(item.signature ?? "")}>
                Copy
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function reportPlainText(report: Report): string {
  const lines = [
    `KaziTrust ${report.scoringVersion}`,
    report.displayAddress,
    report.typeGuess,
    report.riskScore === null ? "No score" : `Score ${report.riskScore} ${report.band}`,
    report.summary,
    "",
    ...report.findings.map((finding) => `${finding.severityWord}: ${finding.title}`),
    "",
    report.meaning,
  ];
  return lines.join("\n");
}

export function MiniRead({ report }: { report: Report }) {
  const visual = report.visuals[0];
  return (
    <div className="mini-read">
      <div className="verdict">
        <div>
          <p className="eyebrow">{report.typeGuess}</p>
          <strong className="num">{shortAddress(report.displayAddress)}</strong>
        </div>
        <div className="verdict-score">
          <p className="score num">{report.riskScore ?? "None"}</p>
          <Gauge score={report.riskScore} band={report.band} />
          <p>{report.band ?? "Unscored"}</p>
        </div>
      </div>
      <ul className="findings compact">
        {report.findings.slice(0, 3).map((finding) => (
          <li key={finding.id}>
            <FindingIcon id={finding.id} />
            <span>{finding.title}</span>
          </li>
        ))}
      </ul>
      {visual ? <VisualView visual={visual} /> : null}
    </div>
  );
}
