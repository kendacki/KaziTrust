export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export async function rpc<T>(method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callRpc<T>(method, params, signal);
    } catch (error) {
      last = error;
      if (signal.aborted || attempt === 1 || !retryable(error)) break;
    }
  }
  throw last;
}

async function callRpc<T>(method: string, params: unknown[], signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/rpc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new RpcError("The public Solana nodes did not answer. Try the read again.");
  }
  let body: { result?: T; error?: { message?: string } };
  try {
    body = (await response.json()) as { result?: T; error?: { message?: string } };
  } catch {
    throw new RpcError("The public Solana nodes did not answer. Try the read again.");
  }
  if (!response.ok || body.error) {
    throw new RpcError(cleanNodeMessage(body.error?.message, response.status));
  }
  return body.result as T;
}

function retryable(error: unknown): boolean {
  return error instanceof RpcError && /did not answer|limiting reads|connection to the Solana node/i.test(error.message);
}

function cleanNodeMessage(message: string | undefined, status: number): string {
  if (message && !/status \d+|api key|upgrade/i.test(message)) return message;
  if (status === 429) return "The public Solana node is limiting reads right now. Wait a moment and try again.";
  return "The public Solana nodes did not answer. Try the read again.";
}
