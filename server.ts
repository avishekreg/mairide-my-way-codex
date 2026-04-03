import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import authHandler from "./api/auth.ts";
import bookingsHandler from "./api/bookings.ts";
import userHandler from "./api/user.ts";
import { handleCompleteSignup } from "./api/_lib/signup.ts";
import { handleSubmitReview } from "./api/_lib/reviews.ts";
import {
  handleSendEmailOtp,
  handleSendOtp,
  handleVerifyOtp,
} from "./api/_lib/otp.ts";
import {
  handleAdminForceCancelRide,
  handleAdminCreateUser,
  handleAdminDeleteUser,
  handleAdminGetConfig,
  handleAdminGenerateResetLink,
  handleAdminSaveConfig,
  handleAdminUpdatePassword,
  handleHealth,
  handleUserCancelRide,
  handleUserCreateRide,
  handleUserCounterBooking,
  handleUserChangePassword,
  handleUserRejectBooking,
  handleUserTravelerCounterBooking,
  handleUserTravelerRespondBooking,
  requireAdminStaff,
  requireSuperAdmin,
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
  app.post("/api/admin/create-user", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminCreateUser(req, res);
  });
  app.post("/api/admin/delete-user", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminDeleteUser(req, res);
  });
  app.get("/api/admin/config", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminGetConfig(req, res);
  });
  app.post("/api/admin/update-password", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminUpdatePassword(req, res);
  });
  app.post("/api/admin/generate-reset-link", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminGenerateResetLink(req, res);
  });
  app.post("/api/admin/save-config", async (req, res) => {
    if (!(await requireSuperAdmin(req, res))) return;
    return handleAdminSaveConfig(req, res);
  });
  app.post("/api/admin/force-cancel-ride", async (req, res) => {
    if (!(await requireAdminStaff(req, res))) return;
    return handleAdminForceCancelRide(req, res);
  });
  app.post("/api/user/change-password", handleUserChangePassword);
  app.post("/api/user/create-ride", handleUserCreateRide);
  app.post("/api/user/reject-booking", handleUserRejectBooking);
  app.post("/api/user/cancel-ride", handleUserCancelRide);
  app.post("/api/user/counter-booking", handleUserCounterBooking);
  app.post("/api/user/traveler-counter-booking", handleUserTravelerCounterBooking);
  app.post("/api/user/traveler-respond-booking", handleUserTravelerRespondBooking);
  app.all("/api/user", userHandler);
  app.all("/api/auth", authHandler);
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
