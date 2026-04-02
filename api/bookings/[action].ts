import { handleSubmitReview } from "../_lib/reviews.ts";

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return "";
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);

  if (action !== "submit-review") {
    return res.status(404).json({ error: "Booking route not found" });
  }

  return handleSubmitReview(req, res);
}
