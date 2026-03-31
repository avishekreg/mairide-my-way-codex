import { handleVerifyOtp } from "../../src/server/backend";

export default async function handler(req: any, res: any) {
  return handleVerifyOtp(req, res);
}
