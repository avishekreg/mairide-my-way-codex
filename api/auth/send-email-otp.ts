import { handleSendEmailOtp } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  return handleSendEmailOtp(req, res);
}
