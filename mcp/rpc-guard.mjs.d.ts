export type PreparedRpcRequest =
  | { ok: true; payload: string; id: string | number }
  | { ok: false; message: string };

export function prepareRpcRequest(parsed: unknown): PreparedRpcRequest;

export function prepareRpcResponse(body: unknown, id: string | number, failMessage: string): string;

export function isAllowedRpcMethod(method: unknown): boolean;
