import { handleSendOtp } from "../../src/server/backend";

export default async function handler(req: any, res: any) {
  return handleSendOtp(req, res);
}
