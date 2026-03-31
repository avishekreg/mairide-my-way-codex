import { handleUserChangePassword } from "../../src/server/backend";

export default async function handler(req: any, res: any) {
  return handleUserChangePassword(req, res);
}
