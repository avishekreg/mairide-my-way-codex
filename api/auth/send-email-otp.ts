import { handleSendEmailOtp } from "../_lib/otp.ts";

export default async function handler(req: any, res: any) {
  return handleSendEmailOtp(req, res);
}
