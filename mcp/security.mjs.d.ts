export function isProduction(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
export function openModeEnabled(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
export function redactSecrets(value: unknown): string;
export function publicError(error: unknown, fallback?: string): string;
export function securityHeaders(extra?: Record<string, string>): Record<string, string>;
export function corsHeaders(
  req?: unknown,
  options?: { allowCredentials?: boolean },
): Record<string, string>;
export function mcpCorsHeaders(): Record<string, string>;
export function clientIp(req?: unknown): string;
export function rateLimit(key: string, options?: { limit?: number; windowMs?: number }): boolean;
