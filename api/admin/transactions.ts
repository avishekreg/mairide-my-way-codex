import adminHandler from "../admin.ts";

export default async function handler(req: any, res: any) {
  req.query = { ...(req.query || {}), action: "transactions" };
  return adminHandler(req, res);
}
