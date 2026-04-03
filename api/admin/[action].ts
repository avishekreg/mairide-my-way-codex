import {
  handleAdminCreateUser,
  handleAdminDeleteUser,
  handleAdminForceCancelRide,
  handleAdminGenerateResetLink,
  handleAdminGetConfig,
  handleAdminGetTransactions,
  handleAdminSaveConfig,
  handleAdminUpdatePassword,
  handleAdminVerifyDriver,
  requireAdminStaff,
  requireSuperAdmin,
} from "../_lib/backend.ts";

type Handler = (req: any, res: any) => Promise<any>;

const superAdminHandlers: Record<string, { method: string; handler: Handler }> = {
  "create-user": { method: "POST", handler: handleAdminCreateUser },
  "delete-user": { method: "POST", handler: handleAdminDeleteUser },
  "config": { method: "GET", handler: handleAdminGetConfig },
  "update-password": { method: "POST", handler: handleAdminUpdatePassword },
  "generate-reset-link": { method: "POST", handler: handleAdminGenerateResetLink },
  "save-config": { method: "POST", handler: handleAdminSaveConfig },
  "verify-driver": { method: "POST", handler: handleAdminVerifyDriver },
  "force-cancel-ride": { method: "POST", handler: handleAdminForceCancelRide },
};

const adminStaffHandlers: Record<string, { method: string; handler: Handler }> = {
  transactions: { method: "GET", handler: handleAdminGetTransactions },
};

function getAction(req: any) {
  const queryAction = req.query?.action;
  if (typeof queryAction === "string" && queryAction) return queryAction;
  if (Array.isArray(queryAction) && queryAction[0]) return queryAction[0];
  return "";
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);
  const route = superAdminHandlers[action] || adminStaffHandlers[action];

  if (!route) {
    return res.status(404).json({ error: "Admin action not found" });
  }

  if (req.method !== route.method) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const isSuperAdminRoute = Boolean(superAdminHandlers[action]);
  const allowed = isSuperAdminRoute
    ? await requireSuperAdmin(req, res)
    : await requireAdminStaff(req, res);

  if (!allowed) return;

  return route.handler(req, res);
}
