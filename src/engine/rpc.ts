export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpc<T>(method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  try {
    const response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
    });
    const body = (await response.json()) as { result?: T; error?: { message?: string } };
    if (!response.ok || body.error) {
      throw new RpcError(cleanNodeMessage(body.error?.message, response.status));
    }
    return body.result as T;
  } catch (error) {
    if (signal.aborted || error instanceof RpcError) throw error;
    throw new RpcError("The connection to the Solana node failed. Try the read again.");
  }
}

function cleanNodeMessage(message: string | undefined, status: number): string {
  if (message && !/status \d+|api key|upgrade/i.test(message)) return message;
  if (status === 429) return "The public Solana node is limiting reads right now. Wait a moment and try again.";
  return "The public Solana nodes did not answer. Try the read again.";
}
