export function normalizeApiKey(value: unknown): string;
export function keyFromHeaders(getHeader: (name: string) => string): string;
export function keyFromUrl(urlLike: string | URL | null | undefined): string;
export function keyFromArgs(args: unknown): string;
export function withApiKey<T extends Record<string, string | undefined> | NodeJS.ProcessEnv>(
  env: T,
  key: unknown,
): T;
export function stripKeyArgs(args: unknown): Record<string, unknown>;
export function keyedMcpUrl(base?: string, key?: string): string;
