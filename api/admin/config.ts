import { handleAdminGetConfig, requireSuperAdmin } from "../_lib/backend.ts";

export default async function handler(req: any, res: any) {
  if (!(await requireSuperAdmin(req, res))) return;
  return handleAdminGetConfig(req, res);
}
