export function sha(value: string): Promise<string>;
export function bearer(headerValue: unknown): string;
export function dailyReadLimit(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): number;
export function saveRemoteKey(
  record: Record<string, unknown>,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<boolean>;
export function apiKeyAllowed(
  token: string,
  reqHeaders?: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<boolean>;
export function resolveApiKey(
  token: string,
  reqHeaders?: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<{ ok: boolean; reason?: string; hash?: string; record?: Record<string, unknown> }>;
export function consumeKeyRead(
  tokenOrHash: string,
  reqHeaders?: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<{ ok: boolean; used: number; limit: number; remaining: number; error?: string }>;
export function keyQuota(
  tokenOrHash: string,
  reqHeaders?: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Promise<{ used: number; limit: number; remaining: number; ok: boolean }>;
