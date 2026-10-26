import { handleKeys, type KeyRequest, type KeyResponse } from "../src/server/keys-http";

export default function handler(req: KeyRequest, res: KeyResponse) {
  return handleKeys(req, res);
}
