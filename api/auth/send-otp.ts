import { handleSendOtp } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  return handleSendOtp(req, res);
}
