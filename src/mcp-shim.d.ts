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
  export function analyticsHttpHeaders(): Record<string, string>;
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
}
