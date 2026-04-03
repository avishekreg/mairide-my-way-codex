import { handleAdminGetConfig, requireSuperAdmin } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const allowed = await requireSuperAdmin(req, res);
  if (!allowed) return;

  return handleAdminGetConfig(req, res);
}
