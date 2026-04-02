import {
  handleAdminCreateUser,
  handleAdminDeleteUser,
  handleAdminGenerateResetLink,
  handleAdminGetConfig,
  handleAdminSaveConfig,
  handleAdminUpdatePassword,
  requireSuperAdmin,
} from "./_lib/backend.ts";

const handlers: Record<string, (req: any, res: any) => Promise<any> | any> = {
  "config": handleAdminGetConfig,
  "create-user": handleAdminCreateUser,
  "delete-user": handleAdminDeleteUser,
  "generate-reset-link": handleAdminGenerateResetLink,
  "save-config": handleAdminSaveConfig,
  "update-password": handleAdminUpdatePassword,
};

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

export default async function handler(req: any, res: any) {
  if (!(await requireSuperAdmin(req, res))) return;

  const action = getAction(req);
  const routeHandler = handlers[action];

  if (!routeHandler) {
    return res.status(404).json({ error: "Admin route not found" });
  }

  return routeHandler(req, res);
}
