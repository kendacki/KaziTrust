import { handleKeyRequest } from "../src/server/keys-http";

type NodeReq = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

type NodeRes = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
};

function asRequest(input: Request | NodeReq): Request {
  const headers = (input as Request).headers;
  if (headers && typeof headers.get === "function") return input as Request;
  const node = input as NodeReq;
  const next = new Headers();
  for (const [key, value] of Object.entries(node.headers ?? {})) {
    if (typeof value === "string") next.set(key, value);
    else if (Array.isArray(value)) next.set(key, value.join(", "));
  }
  const host = next.get("host") || "localhost";
  return new Request(`https://${host}${node.url || "/api/keys"}`, { method: node.method || "GET", headers: next });
}

export default async function handler(input: Request | NodeReq, res?: NodeRes) {
  const response = await handleKeyRequest(asRequest(input));
  if (!res) return response;
  res.statusCode = response.status;
  const cookie = response.headers.get("set-cookie");
  if (cookie) res.setHeader("set-cookie", cookie);
  res.setHeader("content-type", "application/json");
  res.end(await response.text());
}
