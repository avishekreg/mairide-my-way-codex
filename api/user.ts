import {
  handleUserCancelRide,
  handleUserChangePassword,
  handleUserCounterBooking,
  handleUserCreateRide,
  handleUserRejectBooking,
  handleUserTravelerCounterBooking,
  handleUserTravelerRespondBooking,
} from "./_lib/backend.ts";

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);

  if (action === "change-password") {
    return handleUserChangePassword(req, res);
  }

  if (action === "create-ride") {
    return handleUserCreateRide(req, res);
  }

  if (action === "reject-booking") {
    return handleUserRejectBooking(req, res);
  }

  if (action === "cancel-ride") {
    return handleUserCancelRide(req, res);
  }

  if (action === "counter-booking") {
    return handleUserCounterBooking(req, res);
  }

  if (action === "traveler-counter-booking") {
    return handleUserTravelerCounterBooking(req, res);
  }

  if (action === "traveler-respond-booking") {
    return handleUserTravelerRespondBooking(req, res);
  }

  if (req.url?.endsWith("/create-ride")) {
    return handleUserCreateRide(req, res);
  }

  if (req.url?.endsWith("/reject-booking")) {
    return handleUserRejectBooking(req, res);
  }

  if (req.url?.endsWith("/cancel-ride")) {
    return handleUserCancelRide(req, res);
  }

  if (req.url?.endsWith("/counter-booking")) {
    return handleUserCounterBooking(req, res);
  }

  if (req.url?.endsWith("/traveler-counter-booking")) {
    return handleUserTravelerCounterBooking(req, res);
  }

  if (req.url?.endsWith("/traveler-respond-booking")) {
    return handleUserTravelerRespondBooking(req, res);
  }

  if (req.url?.endsWith("/change-password")) {
    return handleUserChangePassword(req, res);
  }

  if (!action) {
    return res.status(404).json({ error: "User route not found" });
  }

  return res.status(404).json({ error: "User route not found" });
}
