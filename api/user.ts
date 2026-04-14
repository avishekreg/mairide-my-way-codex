import {
  handleUserCancelRide,
  handleUserCancelTravelerRequest,
  handleUserChangePassword,
  handleUserCompleteDriverOnboarding,
  handleUserCounterBooking,
  handleUserCreateTravelerRequest,
  handleUserCreateRide,
  handleUserListTravelerRequests,
  handleUserRejectBooking,
  handleUserRespondBooking,
  handleUserSearchRides,
  handleUserTravelerCounterBooking,
  handleUserTravelerRespondBooking,
  handleUserUploadDriverDoc,
} from "./_lib/backend.js";

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);
  const urlAction = (() => {
    try {
      const url = req.url ? new URL(req.url, "http://localhost") : null;
      return url?.searchParams.get("action") || "";
    } catch {
      return "";
    }
  })();

  try {
    if (action === "change-password") {
      return handleUserChangePassword(req, res);
    }

    if (action === "create-ride") {
      return handleUserCreateRide(req, res);
    }

    if (action === "search-rides") {
      return handleUserSearchRides(req, res);
    }

    if (action === "reject-booking") {
      return handleUserRejectBooking(req, res);
    }

    if (action === "respond-booking") {
      return handleUserRespondBooking(req, res);
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

    if (action === "upload-driver-doc") {
      return handleUserUploadDriverDoc(req, res);
    }

    if (action === "complete-driver-onboarding") {
      return handleUserCompleteDriverOnboarding(req, res);
    }

    if (action === "create-traveler-request") {
      return handleUserCreateTravelerRequest(req, res);
    }

    if (action === "list-traveler-requests") {
      return handleUserListTravelerRequests(req, res);
    }

    if (action === "cancel-traveler-request") {
      return handleUserCancelTravelerRequest(req, res);
    }

    if (req.url?.endsWith("/create-ride")) {
      return handleUserCreateRide(req, res);
    }

    if (req.url?.endsWith("/search-rides")) {
      return handleUserSearchRides(req, res);
    }

    if (req.url?.endsWith("/reject-booking")) {
      return handleUserRejectBooking(req, res);
    }

    if (req.url?.endsWith("/respond-booking")) {
      return handleUserRespondBooking(req, res);
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

    if (req.url?.endsWith("/upload-driver-doc")) {
      return handleUserUploadDriverDoc(req, res);
    }

    if (req.url?.endsWith("/complete-driver-onboarding")) {
      return handleUserCompleteDriverOnboarding(req, res);
    }

    if (req.url?.endsWith("/create-traveler-request")) {
      return handleUserCreateTravelerRequest(req, res);
    }

    if (req.url?.endsWith("/list-traveler-requests")) {
      return handleUserListTravelerRequests(req, res);
    }

    if (req.url?.endsWith("/cancel-traveler-request")) {
      return handleUserCancelTravelerRequest(req, res);
    }

    if (req.url?.endsWith("/change-password")) {
      return handleUserChangePassword(req, res);
    }

    if (!action) {
      return res.status(404).json({ error: "User route not found" });
    }

    return res.status(404).json({ error: "User route not found" });
  } catch (error: any) {
    if (action === "list-traveler-requests") {
      return res.status(200).json({ requests: [] });
    }
    console.error("Unhandled user route error:", error);
    return res.status(error?.status || 500).json({ error: "User route failed" });
  }
}
