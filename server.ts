import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import authHandler from "./api/auth.ts";
import bookingsHandler from "./api/bookings.ts";
import paymentsHandler from "./api/payments.ts";
import adminHandler from "./api/admin-api.ts";
import userHandler from "./api/user.ts";
import completeDriverOnboardingHandler from "./api/complete-driver-onboarding.ts";
import deleteUserHandler from "./api/delete-user.ts";
import uploadDriverDocHandler from "./api/upload-driver-doc.ts";
import { handleCompleteSignup } from "./api/_lib/signup.ts";
import { handleSubmitReview } from "./api/_lib/reviews.ts";
import {
  handleSendEmailOtp,
  handleSendOtp,
  handleVerifyOtp,
} from "./api/_lib/otp.ts";
import {
  handleHealth,
  handleUserCancelRide,
  handleUserCreateRide,
  handleUserCounterBooking,
  handleUserChangePassword,
  handleUserRejectBooking,
  handleUserTravelerCounterBooking,
  handleUserTravelerRespondBooking,
} from "./api/_lib/backend.ts";
import { handleResolvePhoneLogin } from "./api/auth.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  dotenv.config({ path: ".env.local", override: true });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3002);

  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", handleHealth);
  app.post("/api/delete-user", deleteUserHandler);
  app.post("/api/upload-driver-doc", uploadDriverDocHandler);
  app.all("/api/admin-api", adminHandler);
  app.post("/api/user/change-password", handleUserChangePassword);
  app.post("/api/complete-driver-onboarding", completeDriverOnboardingHandler);
  app.post("/api/user/create-ride", handleUserCreateRide);
  app.post("/api/user/reject-booking", handleUserRejectBooking);
  app.post("/api/user/cancel-ride", handleUserCancelRide);
  app.post("/api/user/counter-booking", handleUserCounterBooking);
  app.post("/api/user/traveler-counter-booking", handleUserTravelerCounterBooking);
  app.post("/api/user/traveler-respond-booking", handleUserTravelerRespondBooking);
  app.all("/api/user", userHandler);
  app.all("/api/auth", authHandler);
  app.all("/api/payments", paymentsHandler);
  app.post("/api/auth/send-otp", handleSendOtp);
  app.post("/api/auth/send-email-otp", handleSendEmailOtp);
  app.post("/api/auth/verify-otp", handleVerifyOtp);
  app.post("/api/auth/complete-signup", handleCompleteSignup);
  app.post("/api/auth/resolve-phone-login", handleResolvePhoneLogin);
  app.post("/api/bookings/submit-review", handleSubmitReview);
  app.all("/api/bookings", bookingsHandler);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
