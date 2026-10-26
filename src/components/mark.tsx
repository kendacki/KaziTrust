export function Mark({ size = 28 }: { size?: number }) {
  return (
    <span
      className="mark"
      style={{ width: size, height: size }}
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
