import { handleAdminGetTransactions, requireAdminStaff } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const allowed = await requireAdminStaff(req, res);
  if (!allowed) return;

  return handleAdminGetTransactions(req, res);
}
