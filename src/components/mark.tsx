const MARK_RATIO = 540 / 448;

export function Mark({ size = 28 }: { size?: number }) {
  const height = size;
  const width = Math.round(size * MARK_RATIO);
  return (
    <span
      className="mark"
      style={{ width, height }}
      role="img"
      aria-label="KaziTrust"
    />
  );
}

export function Lockup({ size = 28 }: { size?: number }) {
  return (
    <span className="lockup">
      <Mark size={size} />
      <span className="wordmark">KaziTrust</span>
    </span>
  );
}
