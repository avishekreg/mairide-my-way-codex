import { handleVerifyOtp } from "../_lib/otp.ts";

export default async function handler(req: any, res: any) {
  return handleVerifyOtp(req, res);
}
