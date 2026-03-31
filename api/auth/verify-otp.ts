import { handleVerifyOtp } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  return handleVerifyOtp(req, res);
}
