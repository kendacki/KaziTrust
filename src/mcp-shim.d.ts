declare module "*.mjs" {
  const value: unknown;
  export default value;
  export function handleMcpMessage(
    message: unknown,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): Promise<unknown>;
  export function mcpHttpHeaders(): Record<string, string>;
  export function track(
    partial: Record<string, unknown>,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): Promise<Record<string, unknown> | null>;
  export function ingestClientEvents(
    batch: unknown,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): Promise<Array<Record<string, unknown>>>;
  export function summarize(
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
    options?: { limit?: number },
  ): Promise<Record<string, unknown>>;
  export function analyticsHttpHeaders(req?: unknown): Record<string, string>;
  export function isProduction(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
  export function openModeEnabled(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean;
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
  export function allowedOrigins(env?: NodeJS.ProcessEnv | Record<string, string | undefined>): Set<string>;
  export function authorizeAnalyticsRead(
    reqAuth: string,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): boolean;
  export function timed<T>(
    base: Record<string, unknown>,
    work: () => Promise<T>,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): Promise<T>;
  export function isUiEventName(name: string): boolean;
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
  export function prepareRpcRequest(
    parsed: unknown,
  ):
    | { ok: true; payload: string; id: string | number }
    | { ok: false; message: string };
  export function prepareRpcResponse(body: unknown, id: string | number, failMessage: string): string;
  export function isAllowedRpcMethod(method: unknown): boolean;
}
