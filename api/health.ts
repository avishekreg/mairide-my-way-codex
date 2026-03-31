import { handleHealth } from "../src/server/backend.ts";

export default async function handler(req: any, res: any) {
  return handleHealth(req, res);
}
