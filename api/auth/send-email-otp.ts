import { handleSendEmailOtp } from "../../src/server/backend.ts";

export default async function handler(req: any, res: any) {
  return handleSendEmailOtp(req, res);
}
