import { handleAdminUpdatePassword, requireSuperAdmin } from "../../src/server/backend";

export default async function handler(req: any, res: any) {
  if (!(await requireSuperAdmin(req, res))) return;
  return handleAdminUpdatePassword(req, res);
}
