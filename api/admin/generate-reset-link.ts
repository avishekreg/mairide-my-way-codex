import { handleAdminGenerateResetLink, requireSuperAdmin } from "../../src/server/backend.ts";

export default async function handler(req: any, res: any) {
  if (!(await requireSuperAdmin(req, res))) return;
  return handleAdminGenerateResetLink(req, res);
}
