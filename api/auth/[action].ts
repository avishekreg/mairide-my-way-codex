import { handleCompleteSignup } from "../_lib/signup.ts";
import { handleSendEmailOtp, handleSendOtp, handleVerifyOtp } from "../_lib/otp.ts";

const handlers: Record<string, (req: any, res: any) => Promise<any> | any> = {
  "complete-signup": handleCompleteSignup,
  "send-email-otp": handleSendEmailOtp,
  "send-otp": handleSendOtp,
  "verify-otp": handleVerifyOtp,
};

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return "";
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);
  const routeHandler = handlers[action];

  if (!routeHandler) {
    return res.status(404).json({ error: "Auth route not found" });
  }

  return routeHandler(req, res);
}
