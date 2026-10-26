export function isSolName(value: string): boolean {
  return value === "SOL" || value === "Wrapped SOL" || value.endsWith(" SOL");
}

export function SolMark({ size = 14 }: { size?: number }) {
  return <img className="sol-mark" src="/logos/solana.svg" alt="" width={size} height={size} />;
}

export function SolText({ children, size = 14 }: { children: string; size?: number }) {
  if (!isSolName(children)) return children;
  return (
    <span className="sol-text">
      <SolMark size={size} />
      {children}
    </span>
  );
}
