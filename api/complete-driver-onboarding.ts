import { handleUserCompleteDriverOnboarding } from "./_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return handleUserCompleteDriverOnboarding(req, res);
}
