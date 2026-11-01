declare module "*.mjs" {
  export function handleMcpMessage(
    message: unknown,
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  ): Promise<unknown>;
  export function mcpHttpHeaders(): Record<string, string>;
}
