export function isProduction(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
export function openModeEnabled(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
export function allowedOrigins(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): Set<string>;
export function redactSecrets(value: unknown): string;
export function publicError(error: unknown, fallback?: string): string;
export function securityHeaders(extra?: Record<string, string>): Record<string, string>;
export function corsHeaders(
  req?: unknown,
  options?: { allowCredentials?: boolean; env?: NodeJS.ProcessEnv | Record<string, string | undefined> },
): Record<string, string>;
export function mcpCorsHeaders(): Record<string, string>;
export function browserOriginAllowed(
  req?: unknown,
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean;
export function clientIp(req?: unknown): string;
export function fingerprintClient(req?: unknown): string;
export function rateLimitAllow(
  reqOrKey: unknown,
  profileName?: string,
  options?: { capacity?: number; refillPerSec?: number; suffix?: string },
): { ok: boolean; remaining: number; retryAfterSec: number; headers: Record<string, string> };
export function rateLimit(key: string, options?: { limit?: number; windowMs?: number }): boolean;
