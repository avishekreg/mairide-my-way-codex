import { handleHealth, handleUserSearchRides } from "./_lib/backend.ts";

export default async function handler(req: any, res: any) {
  const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;

  if (action === "search-rides") {
    return handleUserSearchRides(req, res);
  }

  return handleHealth(req, res);
}
