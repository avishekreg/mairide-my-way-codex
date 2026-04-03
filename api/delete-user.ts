import { handleAdminDeleteUser, requireSuperAdmin } from "./_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await requireSuperAdmin(req, res))) return;
  return handleAdminDeleteUser(req, res);
}
