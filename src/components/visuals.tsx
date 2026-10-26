import { useId, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { Band, Visual } from "../types";
import { shortAddress } from "../format";
import { isSolanaAddress } from "../engine/address";

export function Gauge({ score, band, large = false }: { score: number | null; band: Band | null; large?: boolean }) {
  const raw = useId().replace(/:/g, "");
  const filled = band === "Low" ? 1 : band === "Guarded" ? 2 : band === "Elevated" ? 3 : band === "High" ? 4 : 0;
  const width = large ? 188 : 120;
  const height = large ? 22 : 14;
  const gap = 4;
  const seg = (width - gap * 3) / 4;
  return (
    <svg className="gauge" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={band ? `${band} band, score ${score}` : "No score"}>
      <title>{band ? `${band}, ${score}` : "Unscored"}</title>
      <defs>
        <pattern id={`hatch-${raw}`} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="5" stroke="currentColor" strokeWidth="1.4" />
        </pattern>
      </defs>
      {Array.from({ length: 4 }, (_, i) => {
        const on = i < filled;
        const high = band === "High" && on;
        return (
          <motion.rect
            key={i}
            x={i * (seg + gap)}
            y="0"
            width={seg}
            height={height}
            rx="3"
            fill={high ? `url(#hatch-${raw})` : on ? "currentColor" : "transparent"}
            stroke="currentColor"
            strokeWidth="1.25"
            opacity={on ? 1 : 0.28}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            style={{ transformBox: "fill-box", transformOrigin: "left center" }}
            transition={{ delay: 0.15 + i * 0.08, duration: 0.45 }}
          />
        );
      })}
    </svg>
  );
}

export function VisualFrame({
  title,
  caption,
  children,
  onExpand,
}: {
  title: string;
  caption: string;
  children: ReactNode;
  onExpand?: () => void;
}) {
  return (
    <motion.figure className="visual" initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.55 }}>
      <figcaption>
        <div>
          <strong>{title}</strong>
          <p>{caption}</p>
        </div>
        {onExpand ? (
          <button type="button" className="text-btn" onClick={onExpand}>
            Expand
          </button>
        ) : null}
      </figcaption>
      {children}
    </motion.figure>
  );
}

export function VisualView({ visual, onPick, large = false }: { visual: Visual; onPick?: (address: string) => void; large?: boolean }) {
  if (visual.type === "funding") return <Funding visual={visual} large={large} />;
  if (visual.type === "cluster") return <Cluster visual={visual} onPick={onPick} large={large} />;
  if (visual.type === "heatmap") return <Heatmap visual={visual} large={large} />;
  if (visual.type === "timeline") return <Timeline visual={visual} />;
  if (visual.type === "holdings") return <Holdings visual={visual} />;
  if (visual.type === "counterparties") return <Counterparties visual={visual} onPick={onPick} />;
  if (visual.type === "approvals") return <Approvals visual={visual} onPick={onPick} />;
  if (visual.type === "restrictions") return <Restrictions visual={visual} />;
  if (visual.type === "rugcheck") return <Rugcheck visual={visual} />;
  if (visual.type === "programs") return <Programs visual={visual} large={large} />;
  if (visual.type === "compare") return <Compare visual={visual} />;
  return <Batch visual={visual} onPick={onPick} />;
}

function Funding({ visual, large }: { visual: Extract<Visual, { type: "funding" }>; large: boolean }) {
  const width = large ? 640 : 520;
  return (
    <svg viewBox={`0 0 ${width} 150`} className="chart" role="img" aria-label="Funding trail">
      <title>Funding trail</title>
      <desc>{visual.hops.map((hop) => `${hop.label}: ${hop.detail}`).join(". ")}</desc>
      <line x1="70" y1="58" x2={width - 70} y2="58" stroke="currentColor" strokeWidth="1.25" opacity="0.45" />
      {visual.hops.map((hop, index) => {
        const x = 70 + ((width - 140) * index) / Math.max(1, visual.hops.length - 1);
        const anchor = index === 0 ? "start" : index === visual.hops.length - 1 ? "end" : "middle";
        const labelX = index === 0 ? 24 : index === visual.hops.length - 1 ? width - 24 : x;
        return (
          <g key={`${hop.label}-${index}`} className="chart-node">
            <circle cx={x} cy="58" r="7" fill="var(--panel)" stroke="currentColor" strokeWidth="1.5" />
            <text x={labelX} y="96" textAnchor={anchor} fill="currentColor" fontSize="13">
              {hop.label}
            </text>
            <text x={labelX} y="116" textAnchor={anchor} fill="currentColor" fontSize="11" opacity="0.62">
              {hop.detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Cluster({
  visual,
  onPick,
  large,
}: {
  visual: Extract<Visual, { type: "cluster" }>;
  onPick?: (address: string) => void;
  large: boolean;
}) {
  const width = large ? 640 : 460;
  const height = large ? 380 : 280;
  const cx = width / 2;
  const cy = height / 2;
  const radius = large ? 112 : 86;
  const centerLabel = visual.nodes.find((node) => node.id === visual.center)?.label ?? shortAddress(visual.center);
  const others = visual.nodes.filter((node) => node.id !== visual.center);
  const points = others.map((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(1, others.length)) * Math.PI * 2;
    return {
      node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      lx: cx + Math.cos(angle) * (radius + 34),
      ly: cy + Math.sin(angle) * (radius + 30),
    };
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Linked accounts">
      <title>Linked accounts in this scan</title>
      <desc>The address under review sits in the centre. Surrounding nodes are counterparties from the opened transactions.</desc>
      {points.map(({ node, x, y }) => (
        <line key={node.id} x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeWidth={Math.min(3, 1 + node.volume / 2)} opacity="0.45" />
      ))}
      <g>
        <circle cx={cx} cy={cy} r="18" fill="var(--panel)" stroke="currentColor" strokeWidth="1.6" />
        <text x={cx} y={cy + 40} textAnchor="middle" fill="currentColor" fontSize="11">
          {centerLabel}
        </text>
      </g>
      {points.map(({ node, x, y, lx, ly }) => (
        <g
          key={node.id}
          className={isSolanaAddress(node.id) ? "chart-hit" : undefined}
          onClick={() => (isSolanaAddress(node.id) && onPick ? onPick(node.id) : undefined)}
        >
          <circle cx={x} cy={y} r="14" fill="var(--panel)" stroke="currentColor" strokeWidth="1.4" />
          <text x={lx} y={ly} textAnchor="middle" fill="currentColor" fontSize="11">
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function Heatmap({ visual, large }: { visual: Extract<Visual, { type: "heatmap" }>; large: boolean }) {
  const peak = Math.max(...visual.cells, 1);
  const cell = large ? 18 : 12;
  const gap = 3;
  const left = 36;
  const top = 18;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <svg viewBox={`0 0 ${left + 24 * (cell + gap)} ${top + 7 * (cell + gap) + 8}`} className="chart" role="img" aria-label={`Activity heatmap, busiest at ${visual.peak}`}>
      <title>Activity by hour</title>
      <desc>{`Scanned signatures by local weekday and hour. Busiest cell: ${visual.peak}.`}</desc>
      {days.map((day, row) => (
        <text key={day} x="0" y={top + row * (cell + gap) + cell - 2} fill="currentColor" fontSize="10" opacity="0.62">
          {day}
        </text>
      ))}
      {visual.cells.map((value, index) => {
        const col = index % 24;
        const row = Math.floor(index / 24);
        return (
          <rect
            key={index}
            x={left + col * (cell + gap)}
            y={top + row * (cell + gap)}
            width={cell}
            height={cell}
            rx="2"
            fill="currentColor"
            opacity={value === 0 ? 0.08 : 0.18 + (value / peak) * 0.82}
          />
        );
      })}
    </svg>
  );
}

function Timeline({ visual }: { visual: Extract<Visual, { type: "timeline" }> }) {
  return (
    <div className="timeline" role="list">
      {visual.events.map((event) => (
        <div className="timeline-row" role="listitem" key={`${event.time}-${event.title}`}>
          <span className="timeline-dot" />
          <div>
            <strong>{event.title}</strong>
            <p>{event.detail}</p>
          </div>
          <time className="num">{event.time}</time>
        </div>
      ))}
    </div>
  );
}

function Holdings({ visual }: { visual: Extract<Visual, { type: "holdings" }> }) {
  return (
    <div className="bars" role="list">
      {visual.rows.map((row) => (
        <div className="bar-row" role="listitem" key={row.label}>
          <div className="bar-meta">
            <span>{row.label}</span>
            <span className="num">{row.amount}</span>
          </div>
          <div className="bar-track">
            <span style={{ width: `${row.pct}%` }} />
          </div>
          {row.flag ? <em>{row.flag}</em> : null}
        </div>
      ))}
    </div>
  );
}

function Counterparties({ visual, onPick }: { visual: Extract<Visual, { type: "counterparties" }>; onPick?: (address: string) => void }) {
  return (
    <div className="split-flow">
      <FlowColumn title="In" rows={visual.inbound} onPick={onPick} />
      <FlowColumn title="Out" rows={visual.outbound} onPick={onPick} />
    </div>
  );
}

function FlowColumn({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: { label: string; amount: string; address?: string }[];
  onPick?: (address: string) => void;
}) {
  return (
    <div>
      <p className="eyebrow">{title}</p>
      {rows.length === 0 ? <p className="quiet">None in the opened transactions.</p> : null}
      <ul className="flow-list">
        {rows.map((row) => (
          <li key={`${title}-${row.label}-${row.amount}`}>
            {row.address && isSolanaAddress(row.address) && onPick ? (
              <button type="button" className="text-btn" onClick={() => onPick(row.address!)}>
                {row.label}
              </button>
            ) : (
              <span>{row.label}</span>
            )}
            <span className="num">{row.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Approvals({ visual, onPick }: { visual: Extract<Visual, { type: "approvals" }>; onPick?: (address: string) => void }) {
  if (!visual.rows.length) {
    return (
      <p className="clean-line">
        <span className="dot" /> No delegate found on token accounts with a balance.
      </p>
    );
  }
  return (
    <ul className="approval-list">
      {visual.rows.map((row) => (
        <li key={`${row.mint}-${row.delegate}`}>
          <div>
            <strong>{row.mint}</strong>
            <p>
              Delegate{" "}
              {row.address && onPick ? (
                <button type="button" className="text-btn" onClick={() => onPick(row.address!)}>
                  {row.delegate}
                </button>
              ) : (
                row.delegate
              )}
            </p>
          </div>
          <span className="num">{row.amount}</span>
        </li>
      ))}
    </ul>
  );
}

function Restrictions({ visual }: { visual: Extract<Visual, { type: "restrictions" }> }) {
  return <StateList rows={visual.rows} clean="Clear" />;
}

function Rugcheck({ visual }: { visual: Extract<Visual, { type: "rugcheck" }> }) {
  return <StateList rows={visual.rows} clean="Good" />;
}

function StateList({ rows, clean }: { rows: { label: string; state: string; detail: string }[]; clean: string }) {
  return (
    <ul className="approval-list">
      {rows.map((row, index) => (
        <li key={`${row.label}-${index}`}>
          <div>
            <strong>{row.label}</strong>
            <p>{row.detail}</p>
          </div>
          <span className={row.state === clean ? "clean-word" : undefined}>{row.state}</span>
        </li>
      ))}
    </ul>
  );
}

function Programs({ visual, large }: { visual: Extract<Visual, { type: "programs" }>; large: boolean }) {
  const total = visual.slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  const r = large ? 78 : 58;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="ring-wrap">
      <svg width={r * 2 + 24} height={r * 2 + 24} viewBox={`0 0 ${r * 2 + 24} ${r * 2 + 24}`} role="img" aria-label="Contract mix">
        <title>Contracts used</title>
        <desc>{visual.slices.map((slice) => `${slice.label} ${slice.value}`).join(", ")}</desc>
        <circle cx={r + 12} cy={r + 12} r={r} fill="none" stroke="currentColor" strokeWidth="10" opacity="0.12" />
        {visual.slices.map((slice, index) => {
          const length = (slice.value / total) * c;
          const dash = `${length} ${c - length}`;
          const node = (
            <circle
              key={slice.label}
              cx={r + 12}
              cy={r + 12}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth="10"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              opacity={1 - index * 0.12}
              transform={`rotate(-90 ${r + 12} ${r + 12})`}
            />
          );
          offset += length;
          return node;
        })}
      </svg>
      <ul>
        {visual.slices.map((slice) => (
          <li key={slice.label}>
            <span>{slice.label}</span>
            <span className="num">{slice.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Compare({ visual }: { visual: Extract<Visual, { type: "compare" }> }) {
  return (
    <div className="compare">
      {[visual.left, visual.right].map((side) => (
        <article key={side.address}>
          <p className="eyebrow">{shortAddress(side.address)}</p>
          <h3>{side.title}</h3>
          <p className="score num">{side.score ?? "None"}</p>
          <Gauge score={side.score} band={side.band} />
          <p>{side.band ?? "Unscored"}</p>
          <p className="quiet">{side.line}</p>
        </article>
      ))}
    </div>
  );
}

function Batch({ visual, onPick }: { visual: Extract<Visual, { type: "batch" }>; onPick?: (address: string) => void }) {
  return (
    <ul className="batch-list">
      {visual.rows.map((row) => (
        <li key={row.address}>
          <button type="button" className="text-btn" onClick={() => onPick?.(row.address)}>
            {shortAddress(row.address)}
          </button>
          <span>{row.line}</span>
          <span className="num">{row.score ?? "None"}</span>
          <span>{row.band}</span>
        </li>
      ))}
    </ul>
  );
}

export function visualTitle(visual: Visual): string {
  switch (visual.type) {
    case "funding":
      return "Funding trail";
    case "cluster":
      return "Linked accounts";
    case "heatmap":
      return "When it is active";
    case "timeline":
      return "Timeline";
    case "holdings":
      return "What it holds";
    case "counterparties":
      return "Counterparties";
    case "approvals":
      return "Approvals";
    case "restrictions":
      return "Blocked and restricted";
    case "rugcheck":
      return "Token risk";
    case "programs":
      return "Contracts";
    case "compare":
      return "Side by side";
    default:
      return "Batch";
  }
}
