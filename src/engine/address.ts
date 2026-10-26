const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  let zeros = 0;
  for (const char of value) {
    if (char === "1") zeros += 1;
    else break;
  }
  let n = 0n;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return false;
    n = n * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.push(Number(n % 256n));
    n /= 256n;
  }
  return zeros + bytes.length === 32;
}

export function extractAddresses(text: string): string[] {
  const found = text.match(/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g) ?? [];
  const unique: string[] = [];
  for (const item of found) {
    if (isSolanaAddress(item) && !unique.includes(item)) unique.push(item);
  }
  return unique;
}

const ADDRESS_PATTERN = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

export function ungroundedAddresses(text: string, allowed: Set<string>): string[] {
  const bad: string[] = [];
  for (const match of text.match(ADDRESS_PATTERN) ?? []) {
    if (isSolanaAddress(match) && !allowed.has(match)) bad.push(match);
  }
  return bad;
}
