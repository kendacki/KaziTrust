import { useState } from "react";
import { motion } from "framer-motion";
import { cautionLabel, formatNumber, shortAddress } from "../format";
import type { Finding, Report, Visual } from "../types";
import { isSolanaAddress } from "../engine/address";
import { FindingIcon, IconClose, IconCopy, IconPlus } from "./icons";
import { Gauge, VisualFrame, VisualView, visualTitle } from "./visuals";

export function ReportView({
  report,
  onExpand,
  onPick,
}: {
  report: Report;
  onExpand: (visual: Visual) => void;
  onPick: (address: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <motion.article className="report" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
          <p className="verdict-band">{cautionLabel(report.kind, report.riskScore, report.band)}</p>
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
                    {linkedEvidence(finding).length ? (
                      <button
                        type="button"
                        className="evidence-toggle"
                        aria-expanded={openId === finding.id}
                        aria-label={openId === finding.id ? "Close evidence" : "Open evidence"}
                        onClick={() => setOpenId((current) => (current === finding.id ? null : finding.id))}
                      >
                        {openId === finding.id ? <IconClose size={14} /> : <IconPlus size={14} />}
                      </button>
                    ) : null}
                  </div>
                  {openId === finding.id ? <EvidenceList finding={finding} /> : null}
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

export function linkedEvidence(finding: Finding) {
  return finding.evidence.filter((item) => (item.kind === "transaction" ? Boolean(item.signature) : Boolean(item.address)));
}

function scanHref(item: Finding["evidence"][number]): string | null {
  if (item.signature) return `https://solscan.io/tx/${item.signature}`;
  if (item.address) return `https://solscan.io/account/${item.address}`;
  return null;
}

export function EvidenceList({ finding }: { finding: Finding }) {
  const rows = linkedEvidence(finding);
  if (!rows.length) return null;
  return (
    <div className="evidence">
      <div className="evidence-head">
        <p>Instances</p>
        <span className="num">{rows.length}</span>
      </div>
      <ol>
        {rows.map((item, index) => {
          const href = scanHref(item);
          const value = item.signature || item.address || "";
          return (
            <li key={`${item.label}-${index}`}>
              <span className="evidence-index num">{index + 1}</span>
              <div className="evidence-body">
                <div className="evidence-top">
                  <strong>{item.kind === "transaction" ? "Transaction" : "Account read"}</strong>
                  <span className="evidence-actions">
                    {item.time ? <span className="quiet">{item.time}</span> : null}
                    {item.slot ? <span className="quiet num">Slot {formatNumber(item.slot, 0)}</span> : null}
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        Solscan
                      </a>
                    ) : null}
                    {value ? (
                      <button type="button" className="text-btn" onClick={() => navigator.clipboard.writeText(value)}>
                        Copy
                      </button>
                    ) : null}
                  </span>
                </div>
                {href ? (
                  <a className="quiet-link num" href={href} target="_blank" rel="noreferrer">
                    {item.label}
                  </a>
                ) : (
                  <p className="num">{item.label}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function reportPlainText(report: Report): string {
  const lines = [
    `KaziTrust ${report.scoringVersion}`,
    report.displayAddress,
    report.typeGuess,
    report.riskScore === null ? `No score. ${cautionLabel(report.kind, report.riskScore, report.band)}` : `Score ${report.riskScore} ${report.band}`,
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
          <p>{cautionLabel(report.kind, report.riskScore, report.band)}</p>
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
