import { handleAdminForceCancelRide, requireAdminStaff } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authContext = await requireAdminStaff(req, res);
  if (!authContext) return;

  return handleAdminForceCancelRide(req, res);
}
