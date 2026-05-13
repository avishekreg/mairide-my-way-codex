import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./supabaseRuntime.js";
import { notifyNearbyRideOffer, notifyNearbyRideRequest } from "./notifications.js";

export type ReqLike = {
  body?: any;
  headers: Record<string, string | string[] | undefined>;
  user?: any;
  profile?: any;
};

export type ResLike = {
  status: (code: number) => ResLike;
  json: (payload: any) => void;
};

let supabaseAdmin: any = null;
const DRIVER_JOINING_BONUS = 500;

function extractErrorMessage(error: any, fallback: string) {
  if (!error) return fallback;
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  if (typeof error?.msg === "string" && error.msg.trim()) return error.msg;
  if (typeof error?.details === "string" && error.details.trim()) return error.details;
  if (typeof error?.error_description === "string" && error.error_description.trim()) {
    return error.error_description;
  }
  return fallback;
}

function normalizeRouteText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getRideThreadKey(data: any) {
  return [
    data?.driverId || data?.driver_id || "",
    normalizeRouteText(data?.origin),
    normalizeRouteText(data?.destination),
    data?.departureTime || "",
  ].join("__");
}

function getBookingThreadKey(data: any) {
  const rideId = data?.rideId || data?.ride_id || "";
  if (rideId) {
    return [rideId, data?.consumerId || data?.consumer_id || ""].join("__");
  }
  return [
    data?.driverId || data?.driver_id || "",
    data?.consumerId || data?.consumer_id || "",
    normalizeRouteText(data?.origin),
    normalizeRouteText(data?.destination),
  ].join("__");
}

function getBookingThreadSource(row: any) {
  const data = row?.data || {};
  return {
    ...data,
    rideId: row?.ride_id ?? data.rideId,
    ride_id: row?.ride_id ?? data.ride_id,
    consumerId: row?.consumer_id ?? data.consumerId,
    consumer_id: row?.consumer_id ?? data.consumer_id,
    driverId: row?.driver_id ?? data.driverId,
    driver_id: row?.driver_id ?? data.driver_id,
    origin: row?.origin ?? data.origin,
    destination: row?.destination ?? data.destination,
    departureTime: row?.departure_time ?? data.departureTime,
  };
}

function isActiveBookingStatus(status: string | null | undefined) {
  return ["pending", "confirmed", "negotiating"].includes(String(status || ""));
}

function getSupabaseAdmin(): any {
  if (supabaseAdmin) return supabaseAdmin;

  const { supabaseUrl, serviceRoleKey: supabaseServiceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Supabase env vars are incomplete. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseAdmin;
}

export async function verifyTokenFromHeader(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const accessToken = authHeader.split("Bearer ")[1];
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);

  if (error || !data.user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  return data.user;
}

export async function getUserProfile(uid: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("id", uid)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUserProfileByEmail(email: string) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .ilike("email", normalized)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function getUserProfileByPhone(phone: string) {
  const normalized = String(phone || "").trim();
  if (!normalized) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("*")
    .eq("phone_number", normalized)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findAuthUser(uid: string, email?: string | null) {
  const supabaseAdmin = getSupabaseAdmin();

  const directLookup = await supabaseAdmin.auth.admin.getUserById(uid);
  if (directLookup.data?.user) {
    return directLookup.data.user;
  }

  if (!email) return null;

  let page = 1;
  while (page <= 5) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const users = data?.users || [];
    const matched = users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (matched) return matched;

    if (users.length < 1000) break;
    page += 1;
  }

  return null;
}

function buildUserRow(input: {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: string;
  adminRole?: string;
  referralCode?: string;
  status?: string;
  onboardingComplete?: boolean;
  forcePasswordChange?: boolean;
}) {
  return {
    id: input.uid,
    email: input.email,
    display_name: input.displayName,
    role: input.role,
    status: input.status || "active",
    phone_number: input.phoneNumber || null,
    referral_code: input.referralCode || null,
    onboarding_complete: input.onboardingComplete ?? input.role !== "driver",
    admin_role: input.role === "admin" ? input.adminRole || "support" : null,
    force_password_change: input.forcePasswordChange ?? false,
    data: {
      uid: input.uid,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      status: input.status || "active",
      phoneNumber: input.phoneNumber || "",
      referralCode: input.referralCode || "",
      onboardingComplete: input.onboardingComplete ?? input.role !== "driver",
      adminRole: input.role === "admin" ? input.adminRole || "support" : undefined,
      forcePasswordChange: input.forcePasswordChange ?? false,
      wallet: {
        balance: 25,
        pendingBalance: 0,
      },
    },
  };
}

async function generateUniqueReferralCode(supabaseAdmin: any) {
  while (true) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
}

export async function requireSuperAdmin(req: ReqLike, res: ResLike) {
  try {
    if (process.env.NODE_ENV !== "production") {
      req.user = { id: "local-dev-admin", email: process.env.VITE_SUPER_ADMIN_EMAIL || "local@admin.dev" };
      req.profile = {
        id: "local-dev-admin",
        role: "admin",
        admin_role: "super_admin",
        email: process.env.VITE_SUPER_ADMIN_EMAIL || "local@admin.dev",
      };
      return true;
    }

    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    const devAdminEmailHeader = Array.isArray(req.headers["x-dev-super-admin-email"])
      ? req.headers["x-dev-super-admin-email"][0]
      : req.headers["x-dev-super-admin-email"];

    let user: any;
    let profile: any;

    try {
      user = await verifyTokenFromHeader(authHeader);
      profile = await getUserProfile(user.id);
    } catch (authError) {
      const configuredSuperAdminEmail = (process.env.VITE_SUPER_ADMIN_EMAIL || "").toLowerCase();
      const requestedDevEmail = (devAdminEmailHeader || "").toLowerCase();

      if (
        process.env.NODE_ENV !== "production" &&
        configuredSuperAdminEmail &&
        requestedDevEmail === configuredSuperAdminEmail
      ) {
        const { data: devProfile, error: devProfileError } = await getSupabaseAdmin()
          .from("users")
          .select("*")
          .eq("email", requestedDevEmail)
          .maybeSingle();

        if (devProfileError || !devProfile || (devProfile as any).role !== "admin") {
          throw authError;
        }

        user = { id: (devProfile as any).id, email: requestedDevEmail };
        profile = devProfile;
      } else {
        throw authError;
      }
    }

    const effectiveAdminRole =
      profile?.admin_role ||
      profile?.data?.adminRole ||
      (user.email && process.env.VITE_SUPER_ADMIN_EMAIL && user.email.toLowerCase() === process.env.VITE_SUPER_ADMIN_EMAIL.toLowerCase()
        ? "super_admin"
        : null) ||
      "super_admin";

    if (profile && profile.role === "admin" && effectiveAdminRole === "super_admin") {
      req.user = user;
      req.profile = profile;
      return true;
    }

    res.status(403).json({ error: "Forbidden: Super Admin access required" });
    return false;
  } catch (error: any) {
    res.status(error.status || 401).json({ error: error.message || "Unauthorized" });
    return false;
  }
}

export async function requireAdminStaff(req: ReqLike, res: ResLike) {
  try {
    if (process.env.NODE_ENV !== "production") {
      req.user = { id: "local-dev-admin", email: process.env.VITE_SUPER_ADMIN_EMAIL || "local@admin.dev" };
      req.profile = {
        id: "local-dev-admin",
        role: "admin",
        admin_role: "super_admin",
        email: process.env.VITE_SUPER_ADMIN_EMAIL || "local@admin.dev",
      };
      return true;
    }

    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    const user = await verifyTokenFromHeader(authHeader);
    const profile = await getUserProfile(user.id);
    const effectiveAdminRole =
      profile?.admin_role ||
      profile?.data?.adminRole ||
      (user.email && process.env.VITE_SUPER_ADMIN_EMAIL && user.email.toLowerCase() === process.env.VITE_SUPER_ADMIN_EMAIL.toLowerCase()
        ? "super_admin"
        : null);

    if (profile && profile.role === "admin" && effectiveAdminRole) {
      req.user = user;
      req.profile = profile;
      return true;
    }

    res.status(403).json({ error: "Forbidden: Admin access required" });
    return false;
  } catch (error: any) {
    res.status(error.status || 401).json({ error: error.message || "Unauthorized" });
    return false;
  }
}

export async function handleHealth(_req: ReqLike, res: ResLike) {
  res.status(200).json({ status: "ok", backend: "supabase" });
}

export async function handleAdminGetConfig(_req: ReqLike, res: ResLike) {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_config")
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    if (error) throw error;

    const config = data
      ? {
          id: data.id,
          ...((data.data as Record<string, any>) || {}),
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
      : null;

    res.status(200).json({ config });
  } catch (error: any) {
    console.error("Error fetching configuration:", error);
    res.status(500).json({ error: error.message || "Failed to fetch configuration" });
  }
}

export async function handleAdminGetTransactions(_req: ReqLike, res: ResLike) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const existing = data || [];
    const existingIds = new Set(existing.map((row: any) => row.id));

    const { data: bookingRows, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });

    if (bookingError) throw bookingError;

    const normalizeGstRate = (rawRate: number) => {
      if (!Number.isFinite(rawRate)) return 0.18;
      return rawRate > 1 ? rawRate / 100 : rawRate;
    };

    const resolvePayerFeeBreakdown = (bookingData: Record<string, any>, payer: "consumer" | "driver", coinsUsed: number) => {
      const configuredServiceFee = Number(bookingData.serviceFee || 0);
      const configuredGstAmount = Number(bookingData.gstAmount || 0);
      const inferredGstRate =
        configuredServiceFee > 0
          ? configuredGstAmount / configuredServiceFee
          : normalizeGstRate(Number(bookingData.gstRate ?? 0.18));
      const baseFee = configuredServiceFee > 0 ? configuredServiceFee : 100;
      const normalizedCoinsUsed = Math.max(Number(coinsUsed || 0), 0);

      const storedServiceFee = Number(
        payer === "consumer" ? bookingData.consumerNetServiceFee : bookingData.driverNetServiceFee
      );
      const storedGstAmount = Number(
        payer === "consumer" ? bookingData.consumerNetGstAmount : bookingData.driverNetGstAmount
      );

      if (
        Number.isFinite(storedServiceFee) &&
        Number.isFinite(storedGstAmount) &&
        storedServiceFee >= 0 &&
        storedGstAmount >= 0
      ) {
        return {
          serviceFee: storedServiceFee,
          gstAmount: storedGstAmount,
          totalFee: storedServiceFee + storedGstAmount,
        };
      }

      const netServiceFee = Math.max(baseFee - normalizedCoinsUsed, 0);
      const gstAmount = netServiceFee * normalizeGstRate(inferredGstRate);
      return {
        serviceFee: netServiceFee,
        gstAmount,
        totalFee: netServiceFee + gstAmount,
      };
    };

    const synthesizedRows: any[] = [];
    for (const booking of bookingRows || []) {
      const bookingData = (booking.data as Record<string, any>) || {};

      const maybeBuildRow = (payer: "consumer" | "driver") => {
        const isConsumer = payer === "consumer";
        const paid = isConsumer ? bookingData.feePaid : bookingData.driverFeePaid;
        const paymentMode = isConsumer ? bookingData.consumerPaymentMode : bookingData.driverPaymentMode;
        if (!paid || !paymentMode) return null;
        const coinsUsed = Number(isConsumer ? bookingData.maiCoinsUsed || 0 : bookingData.driverMaiCoinsUsed || 0);
        const { serviceFee, gstAmount, totalFee } = resolvePayerFeeBreakdown(bookingData, payer, coinsUsed);

        const txId = `platform_fee_${booking.id}_${payer}`;
        if (existingIds.has(txId)) return null;

        return {
          id: txId,
          user_id: isConsumer ? booking.consumer_id || bookingData.consumerId : booking.driver_id || bookingData.driverId,
          type: "maintenance_fee_payment",
          status: bookingData.paymentStatus === "proof_submitted" ? "pending" : "completed",
          data: {
            id: txId,
            userId: isConsumer ? booking.consumer_id || bookingData.consumerId : booking.driver_id || bookingData.driverId,
            type: "maintenance_fee_payment",
            amount: paymentMode === "maicoins" ? coinsUsed : totalFee,
            currency: paymentMode === "maicoins" ? "MAICOIN" : "INR",
            status: bookingData.paymentStatus === "proof_submitted" ? "pending" : "completed",
            description: `Platform fee payment for ${bookingData.origin || "ride"} to ${bookingData.destination || "destination"}`,
            relatedId: booking.id,
            createdAt: isConsumer
              ? bookingData.consumerPaymentSubmittedAt || booking.created_at
              : bookingData.driverPaymentSubmittedAt || booking.created_at,
            metadata: {
              bookingId: booking.id,
              rideId: booking.ride_id || bookingData.rideId || null,
              payer,
              payerName: isConsumer ? bookingData.consumerName || null : bookingData.driverName || null,
              paymentMode,
              gateway: isConsumer
                ? bookingData.consumerPaymentGateway || (paymentMode === "online" ? "razorpay" : "manual")
                : bookingData.driverPaymentGateway || (paymentMode === "online" ? "razorpay" : "manual"),
              transactionId: isConsumer ? bookingData.consumerPaymentTransactionId || null : bookingData.driverPaymentTransactionId || null,
              orderId: isConsumer ? bookingData.consumerPaymentOrderId || null : bookingData.driverPaymentOrderId || null,
              receiptUrl: isConsumer ? bookingData.consumerPaymentReceiptUrl || null : bookingData.driverPaymentReceiptUrl || null,
              serviceFee,
              gstAmount,
              totalFee,
              coinsUsed,
              route: `${bookingData.origin || "Unknown"} -> ${bookingData.destination || "Unknown"}`,
            },
          },
        };
      };

      const consumerRow = maybeBuildRow("consumer");
      if (consumerRow) {
        synthesizedRows.push(consumerRow);
        existingIds.add(consumerRow.id);
      }

      const driverRow = maybeBuildRow("driver");
      if (driverRow) {
        synthesizedRows.push(driverRow);
        existingIds.add(driverRow.id);
      }
    }

    const allRows = [...existing, ...synthesizedRows].sort(
      (a: any, b: any) => new Date(b.created_at || b.data?.createdAt || 0).getTime() - new Date(a.created_at || a.data?.createdAt || 0).getTime()
    );

    const transactions = allRows.map((row: any) => ({
      ...((row.data as Record<string, any>) || {}),
      id: row.id,
      userId: row.user_id ?? row.data?.userId ?? null,
      type: row.type ?? row.data?.type ?? null,
      status: row.status ?? row.data?.status ?? null,
      createdAt: row.created_at ?? row.data?.createdAt ?? null,
      updatedAt: row.updated_at ?? row.data?.updatedAt ?? null,
    }));

    res.status(200).json({ transactions });
  } catch (error: any) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ error: error.message || "Failed to fetch transactions" });
  }
}

export async function handleAdminCreateUser(req: ReqLike, res: ResLike) {
  const { email, password, displayName, phoneNumber, role, adminRole } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = String(phoneNumber || "").replace(/[^\d+]/g, "");

  if (!normalizedEmail || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: existingUser, error: existingUserError } = await getSupabaseAdmin()
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUserError) throw existingUserError;
    if (existingUser) {
      return res.status(409).json({ error: "A user with this email already exists." });
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (authError || !authData.user) {
      throw authError || new Error("Failed to create auth user");
    }

    const referralCode = await generateUniqueReferralCode(supabaseAdmin);
    const row = buildUserRow({
      uid: authData.user.id,
      email: normalizedEmail,
      displayName,
      phoneNumber: normalizedPhone,
      role,
      adminRole,
      referralCode,
      forcePasswordChange: true,
    });

    const { error: profileError } = await supabaseAdmin.from("users").upsert(row, {
      onConflict: "id",
    });

    if (profileError) throw profileError;

    res.status(201).json({
      message: "User created successfully",
      uid: authData.user.id,
    });
  } catch (error: any) {
    console.error("Error creating user:", error);
    const message = extractErrorMessage(error, "Failed to create user");
    const statusCode =
      error?.status ||
      (message.toLowerCase().includes("already") ? 409 : 500);
    res.status(statusCode).json({ error: message });
  }
}

export async function handleAdminVerifyDriver(req: ReqLike, res: ResLike) {
  const { uid, verificationStatus, rejectionReason } = req.body || {};
  const normalizedStatus = verificationStatus === "approved" || verificationStatus === "rejected"
    ? verificationStatus
    : null;

  if (!uid || !normalizedStatus) {
    return res.status(400).json({ error: "Missing uid or valid verificationStatus" });
  }

  try {
    const verifiedBy = req.user?.id || req.profile?.id || null;
    const { data: existingUser, error: existingUserError } = await getSupabaseAdmin()
      .from("users")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    if (existingUserError) throw existingUserError;
    if (!existingUser) {
      return res.status(404).json({ error: "Driver not found" });
    }

    const existingData = (existingUser.data as Record<string, any>) || {};
    const nextData = {
      ...existingData,
      verificationStatus: normalizedStatus,
      rejectionReason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
      verifiedBy,
      status: normalizedStatus === "approved" ? "active" : "inactive",
    };

    const { error } = await getSupabaseAdmin()
      .from("users")
      .update({
        verification_status: normalizedStatus,
        rejection_reason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
        verified_by: verifiedBy,
        status: normalizedStatus === "approved" ? "active" : "inactive",
        data: nextData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", uid);

    if (error) throw error;

    return res.status(200).json({ message: `Driver ${normalizedStatus} successfully.` });
  } catch (error: any) {
    console.error("Error verifying driver:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to update driver verification"),
    });
  }
}

export async function handleAdminUpdatePassword(req: ReqLike, res: ResLike) {
  const { uid, newPassword } = req.body || {};

  if (!uid || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const profile = await getUserProfile(uid);
    const authUser = await findAuthUser(uid, profile?.email);

    if (!authUser) {
      throw new Error("No matching authentication account was found for this user. Ask the user to sign up once with their email, then retry the reset.");
    }

    const { error: authError } = await getSupabaseAdmin().auth.admin.updateUserById(authUser.id, {
      password: newPassword,
    });
    if (authError) throw authError;

    if (profile) {
      const mergedData = {
        ...(((profile as any)?.data) || {}),
        forcePasswordChange: true,
      };

      const { error: updateError } = await getSupabaseAdmin()
        .from("users")
        .update({
          force_password_change: true,
          data: mergedData,
        })
        .eq("id", uid);

      if (updateError) throw updateError;
    }

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error: any) {
    console.error("Error updating password:", error);
    res.status(500).json({ error: error.message || "Failed to update password" });
  }
}

export async function handleAdminDeleteUser(req: ReqLike, res: ResLike) {
  const { uid } = req.body || {};

  if (!uid) {
    return res.status(400).json({ error: "Missing required uid" });
  }

  if (req.user?.id === uid) {
    return res.status(400).json({ error: "You cannot delete the currently logged-in super admin." });
  }

  try {
    const profile = await getUserProfile(uid);
    const authUser = await findAuthUser(uid, profile?.email);
    const supabaseAdmin = getSupabaseAdmin();

    const cleanupSteps = [
      () => supabaseAdmin.from("support_tickets").delete().eq("user_id", uid),
      () => supabaseAdmin.from("transactions").delete().eq("user_id", uid),
      () => supabaseAdmin.from("referrals").delete().eq("referrer_id", uid),
      () => supabaseAdmin.from("referrals").delete().eq("referred_id", uid),
      () => supabaseAdmin.from("bookings").delete().eq("consumer_id", uid),
      () => supabaseAdmin.from("bookings").delete().eq("driver_id", uid),
      () => supabaseAdmin.from("rides").delete().eq("driver_id", uid),
      () => supabaseAdmin.from("users").delete().eq("id", uid),
    ];

    for (const runStep of cleanupSteps) {
      const { error } = await runStep();
      if (error) throw error;
    }

    if (authUser?.id) {
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(authUser.id);
      if (authDeleteError) throw authDeleteError;
    }

    return res.status(200).json({ message: "User deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ error: error.message || "Failed to delete user" });
  }
}

export async function handleAdminGenerateResetLink(req: ReqLike, res: ResLike) {
  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ error: "Missing required email" });
  }

  try {
    const redirectTo =
      process.env.APP_URL ||
      process.env.VITE_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

    const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
      type: "recovery",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });

    if (error) throw error;

    res.status(200).json({
      message: "Reset link generated successfully",
      actionLink: data?.properties?.action_link || null,
    });
  } catch (error: any) {
    console.error("Error generating reset link:", error);
    res.status(500).json({ error: error.message || "Failed to generate reset link" });
  }
}

export async function handleAdminSaveConfig(req: ReqLike, res: ResLike) {
  const payload = req.body || {};

  try {
    const now = new Date().toISOString();
    const updatedBy =
      req.user?.email ||
      req.profile?.email ||
      payload.updatedBy ||
      process.env.VITE_SUPER_ADMIN_EMAIL ||
      "admin";

    const configData = {
      ...payload,
      updatedAt: now,
      updatedBy,
    };

    const row = {
      id: "global",
      updated_at: now,
      data: configData,
    };

    const { error } = await getSupabaseAdmin().from("app_config").upsert(row, {
      onConflict: "id",
    });

    if (error) throw error;

    res.status(200).json({
      message: "Configuration saved successfully",
      config: {
        id: "global",
        ...configData,
      },
    });
  } catch (error: any) {
    console.error("Error saving configuration:", error);
    res.status(500).json({ error: error.message || "Failed to save configuration" });
  }
}

export async function handleUserChangePassword(req: ReqLike, res: ResLike) {
  const { newPassword } = req.body || {};

  if (!newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    const user = await verifyTokenFromHeader(authHeader);
    const { error: authError } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
      password: newPassword,
    });
    if (authError) throw authError;

    const profile = await getUserProfile(user.id);
    const mergedData = {
      ...(((profile as any)?.data) || {}),
      forcePasswordChange: false,
    };

    const { error: updateError } = await getSupabaseAdmin()
      .from("users")
      .update({
        force_password_change: false,
        data: mergedData,
      })
      .eq("id", user.id);

    if (updateError) throw updateError;

    res.status(200).json({ message: "Password changed successfully" });
  } catch (error: any) {
    console.error("Error changing password:", error);
    res.status(error.status || 500).json({ error: error.message || "Failed to change password" });
  }
}

export async function handleUserCreateRide(req: ReqLike, res: ResLike) {
  const payload = req.body || {};
  const normalizeLocation = (value: any) => {
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  };
  const normalizeRole = (value: any) => String(value || "").trim().toLowerCase();
  const isActive = (value: any) => !value || String(value).trim().toLowerCase() === "active";
  const resolveActorProfile = async (payloadId: string) => {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    try {
      const user = await verifyTokenFromHeader(authHeader);
      const profileFromToken = await getUserProfile(user.id);
      if (profileFromToken) {
        return {
          actorId: user.id,
          actorProfile: profileFromToken,
        };
      }
      const emailFallback = await getUserProfileByEmail(user.email || "");
      if (emailFallback) {
        return {
          actorId: user.id,
          actorProfile: emailFallback,
        };
      }
      const phoneFallback = await getUserProfileByPhone(user.phone || "");
      if (phoneFallback) {
        return {
          actorId: user.id,
          actorProfile: phoneFallback,
        };
      }
      if (user?.id) {
        const now = new Date().toISOString();
        const seedProfile = {
          id: user.id,
          email: user.email ?? null,
          display_name: user.user_metadata?.displayName || user.user_metadata?.full_name || user.email || "Traveler",
          role: "consumer",
          status: "active",
          phone_number: user.phone ?? null,
          created_at: now,
          updated_at: now,
          data: {
            uid: user.id,
            email: user.email ?? "",
            displayName: user.user_metadata?.displayName || user.user_metadata?.full_name || user.email || "Traveler",
            role: "consumer",
            status: "active",
            phoneNumber: user.phone ?? "",
            createdAt: now,
            updatedAt: now,
          },
        };
        await getSupabaseAdmin()
          .from("users")
          .upsert(seedProfile, { onConflict: "id" });
        const freshProfile = await getUserProfile(user.id);
        if (freshProfile) {
          return {
            actorId: user.id,
            actorProfile: freshProfile,
          };
        }
      }
      if (payloadId) {
        const profileFromPayload = await getUserProfile(payloadId);
        if (profileFromPayload) {
          return {
            actorId: payloadId,
            actorProfile: profileFromPayload,
          };
        }
      }
      throw Object.assign(new Error("Driver profile not found."), { status: 404 });
    } catch (tokenError: any) {
      if (!payloadId) throw tokenError;
      const profileFromPayload = await getUserProfile(payloadId);
      if (!profileFromPayload) {
        throw Object.assign(new Error("Driver profile not found."), { status: 404 });
      }
      return {
        actorId: payloadId,
        actorProfile: profileFromPayload,
      };
    }
  };

  const origin = String(payload.origin || "").trim();
  const destination = String(payload.destination || "").trim();
  const price = Number(payload.price);
  const seatsAvailable = Number(payload.seatsAvailable);
  const payloadDriverId = String(payload.driverId || "").trim();
  const originLocation = normalizeLocation(payload.originLocation);
  const destinationLocation = normalizeLocation(payload.destinationLocation);

  if (!origin || !destination) {
    return res.status(400).json({ error: "Origin and destination are required." });
  }
  if (!Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Price must be greater than zero." });
  }
  if (!Number.isFinite(seatsAvailable) || seatsAvailable < 1) {
    return res.status(400).json({ error: "Seats available must be at least 1." });
  }
  if (!originLocation || !destinationLocation) {
    return res.status(400).json({ error: "Valid origin and destination coordinates are required." });
  }

  try {
    const { actorId, actorProfile } = await resolveActorProfile(payloadDriverId);
    const profileData = (actorProfile.data as Record<string, any>) || {};
    const actorRole = normalizeRole(actorProfile.role || profileData.role);
    if (actorRole !== "driver") {
      return res.status(403).json({ error: "Only drivers can create ride offers." });
    }
    if (!isActive(actorProfile.status || profileData.status)) {
      return res.status(403).json({ error: "Driver account is not active." });
    }

    const now = new Date().toISOString();
    const departureTime = String(payload.departureTime || "").trim() || now;
    const rideId = crypto.randomUUID();
    const driverName =
      String(payload.driverName || actorProfile.display_name || profileData.displayName || "Driver").trim() || "Driver";
    const driverPhotoUrl =
      String(
        payload.driverPhotoUrl ||
          actorProfile.photo_url ||
          profileData.photoURL ||
          profileData.driverDetails?.selfiePhoto ||
          ""
      ).trim();
    const driverRating = Number(
      payload.driverRating || profileData.reviewStats?.averageRating || profileData.driverDetails?.rating || 0
    );

    const rideData = {
      id: rideId,
      driverId: actorId,
      driverName,
      driverPhotoUrl,
      driverRating: Number.isFinite(driverRating) ? driverRating : 0,
      origin,
      destination,
      originLocation,
      destinationLocation,
      price,
      seatsAvailable: Math.max(1, Math.floor(seatsAvailable)),
      status: "available",
      departureDay: payload.departureDay || "today",
      departureDayLabel: payload.departureDayLabel || "Today",
      departureClock: payload.departureClock || "09:00",
      departureNote:
        payload.departureNote ||
        "Planned departure time may vary based on traffic, road, and operational conditions.",
      departureTime,
      createdAt: now,
      updatedAt: now,
    };

    const { error: insertRideError } = await getSupabaseAdmin().from("rides").insert({
      id: rideId,
      driver_id: actorId,
      status: "available",
      created_at: now,
      updated_at: now,
      data: rideData,
    });
    if (insertRideError) throw insertRideError;

    const linkedTravelerRequestId = String(payload.linkedTravelerRequestId || "").trim();
    let linkedBookingId: string | null = null;
    if (linkedTravelerRequestId) {
      const { data: requestRow, error: requestReadError } = await getSupabaseAdmin()
        .from("bookings")
        .select("id,data,status,consumer_id,created_at")
        .eq("id", linkedTravelerRequestId)
        .maybeSingle();

      if (!requestReadError && requestRow && requestRow.status === "traveler_request_open") {
        const requestData = requestRow.data || {};
        const requestedOrigin = String(requestData.origin || origin).trim() || origin;
        const requestedDestination = String(requestData.destination || destination).trim() || destination;
        const normalizedRequestedOrigin = normalizeText(requestedOrigin);
        const normalizedRequestedDestination = normalizeText(requestedDestination);
        const normalizedRideOrigin = normalizeText(origin);
        const normalizedRideDestination = normalizeText(destination);
        const listedFare = Number(requestData.fare);
        const requestedFare = Number.isFinite(listedFare) && listedFare > 0 ? listedFare : price;
        const bookingThreadData = {
          ...requestData,
          rideId,
          consumerId: String(requestRow.consumer_id || requestData.consumerId || "").trim(),
          consumerName:
            String(requestData.consumerName || requestData.displayName || requestData.userName || "").trim() || "Traveler",
          consumerPhone: String(requestData.consumerPhone || requestData.phoneNumber || "").trim(),
          driverId: actorId,
          driverName,
          driverPhotoUrl,
          origin,
          destination,
          listedOrigin: origin,
          listedDestination: destination,
          requestedOrigin,
          requestedDestination,
          requiresDetour:
            normalizedRequestedOrigin !== normalizedRideOrigin ||
            normalizedRequestedDestination !== normalizedRideDestination,
          listedFare: requestedFare,
          fare: requestedFare,
          negotiatedFare: price,
          negotiationStatus: "pending",
          negotiationActor: "driver",
          driverCounterPending: true,
          seatsBooked: Math.max(1, Number(requestData.seatsNeeded || 1)),
          totalPrice: requestedFare,
          serviceFee: Number(requestData.serviceFee || 0),
          gstAmount: Number(requestData.gstAmount || 0),
          paymentStatus: String(requestData.paymentStatus || "pending"),
          status: "negotiating",
          linkedTravelerRequestId,
          matchedRideId: rideId,
          matchedDriverId: actorId,
          matchedAt: now,
          departureDay: requestData.departureDay || rideData.departureDay,
          departureDayLabel: requestData.departureDayLabel || rideData.departureDayLabel,
          departureClock: requestData.departureClock || rideData.departureClock,
          departureNote: requestData.departureNote || rideData.departureNote,
          departureTime: requestData.departureTime || rideData.departureTime,
          rideRetired: false,
          updatedAt: now,
          createdAt: requestData.createdAt || requestRow.created_at || now,
        };
        await getSupabaseAdmin()
          .from("bookings")
          .update({
            ride_id: rideId,
            driver_id: actorId,
            status: "negotiating",
            updated_at: now,
            data: bookingThreadData,
          })
          .eq("id", linkedTravelerRequestId)
          .eq("status", "traveler_request_open");
        linkedBookingId = linkedTravelerRequestId;
      }
    }

    void notifyNearbyRideOffer(getSupabaseAdmin(), rideData, actorId).catch((notificationError) => {
      console.error("Nearby ride offer notification failed:", notificationError);
    });

    return res.status(201).json({
      message: "Ride created successfully",
      id: rideId,
      rideId,
      bookingId: linkedBookingId,
      ride: rideData,
    });
  } catch (error: any) {
    console.error("Error creating ride:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to create ride"),
    });
  }
}

function mapTravelerRequestRow(row: any) {
  const data = row?.data || {};
  return {
    id: row?.id,
    consumerId: row?.consumer_id || data.consumerId || "",
    consumerName: data.consumerName || "",
    consumerPhone: data.consumerPhone || "",
    origin: data.origin || "",
    destination: data.destination || "",
    originLocation: data.originLocation || null,
    destinationLocation: data.destinationLocation || null,
    fare: Number(data.fare || 0),
    seatsNeeded: Number(data.seatsNeeded || 1),
    departureTime: data.departureTime || row?.created_at || new Date().toISOString(),
    departureDay: data.departureDay || "today",
    departureDayLabel: data.departureDayLabel || "Today",
    departureClock: data.departureClock || "09:00",
    departureNote:
      data.departureNote ||
      "Planned departure time may vary due to traffic, road, and operational conditions.",
    status:
      data.status ||
      (row?.status === "traveler_request_matched"
        ? "matched"
        : row?.status === "traveler_request_cancelled"
          ? "cancelled"
          : "open"),
    matchedRideId: data.matchedRideId || null,
    matchedDriverId: data.matchedDriverId || null,
    matchedAt: data.matchedAt || null,
    createdAt: row?.created_at || new Date().toISOString(),
    updatedAt: row?.updated_at || row?.created_at || new Date().toISOString(),
  };
}

function mapBookingRow(row: any) {
  const source = getBookingThreadSource(row);
  const now = new Date().toISOString();
  const normalizedStatus = (() => {
    const topLevelStatus = String(row?.status || "").trim().toLowerCase();
    const nestedStatus = String(source?.status || "").trim().toLowerCase();
    const candidate = topLevelStatus || nestedStatus;
    return ["pending", "confirmed", "completed", "cancelled", "negotiating", "rejected"].includes(candidate)
      ? candidate
      : "pending";
  })();
  const createdAt = source?.createdAt || row?.created_at || now;
  const updatedAt = source?.updatedAt || row?.updated_at || row?.created_at || createdAt;

  return {
    id: row?.id,
    ...(source || {}),
    rideId: row?.ride_id || source?.rideId || "",
    consumerId: row?.consumer_id || source?.consumerId || "",
    driverId: row?.driver_id || source?.driverId || "",
    consumerName: source?.consumerName || "",
    consumerPhone: source?.consumerPhone || "",
    driverName: source?.driverName || "",
    driverPhotoUrl: source?.driverPhotoUrl || "",
    driverPhone: source?.driverPhone || "",
    origin: source?.origin || "",
    destination: source?.destination || "",
    fare: Number(source?.fare || 0),
    seatsBooked: Number(source?.seatsBooked || source?.seatsNeeded || 1),
    totalPrice: Number(source?.totalPrice || source?.fare || 0),
    serviceFee: Number(source?.serviceFee || 0),
    gstAmount: Number(source?.gstAmount || 0),
    maiCoinsUsed: Number(source?.maiCoinsUsed || 0),
    driverMaiCoinsUsed: Number(source?.driverMaiCoinsUsed || 0),
    status: normalizedStatus,
    createdAt,
    updatedAt,
    data: {
      ...(row?.data || {}),
      ...source,
      rideId: row?.ride_id || source?.rideId || "",
      consumerId: row?.consumer_id || source?.consumerId || "",
      driverId: row?.driver_id || source?.driverId || "",
      status: normalizedStatus,
      createdAt,
      updatedAt,
    },
  };
}

export async function handleUserListBookings(req: any, res: ResLike) {
  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    const url = req.url ? new URL(req.url, "http://localhost") : null;
    const scopeParam =
      req.query?.scope ||
      req.body?.scope ||
      url?.searchParams.get("scope") ||
      "consumer";

    let currentUserId = "";

    if (process.env.NODE_ENV === "production") {
      try {
        const user = await verifyTokenFromHeader(authHeader);
        currentUserId = user.id;
      } catch (error: any) {
        return res.status(error?.status || 401).json({
          error: extractErrorMessage(error, "Unauthorized"),
        });
      }
    } else {
      currentUserId =
        req.body?.userId ||
        req.query?.userId ||
        url?.searchParams.get("userId") ||
        "";
    }

    const scope = String(scopeParam || "consumer").trim().toLowerCase();
    if (!["consumer", "driver"].includes(scope)) {
      return res.status(400).json({ error: "Invalid booking scope" });
    }
    if (!currentUserId) {
      return res.status(200).json({ bookings: [] });
    }

    let queryBuilder = getSupabaseAdmin()
      .from("bookings")
      .select("*")
      .in("status", ["pending", "confirmed", "completed", "cancelled", "negotiating", "rejected"])
      .order("updated_at", { ascending: false });

    queryBuilder =
      scope === "driver"
        ? queryBuilder.eq("driver_id", currentUserId)
        : queryBuilder.eq("consumer_id", currentUserId);

    const { data, error } = await queryBuilder;
    if (error) {
      if (String(error?.code || "") === "42P01") {
        return res.status(200).json({ bookings: [] });
      }
      throw error;
    }

    return res.status(200).json({
      bookings: (data || []).map(mapBookingRow),
    });
  } catch (error: any) {
    console.error("Error fetching bookings:", error);
    return res.status(200).json({ bookings: [] });
  }
}

export async function handleUserCreateTravelerRequest(req: ReqLike, res: ResLike) {
  const payload = req.body || {};
  const normalizeLocation = (value: any) => {
    const lat = Number(value?.lat);
    const lng = Number(value?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  };
  const normalizeRole = (value: any) => String(value || "").trim().toLowerCase();
  const isActive = (value: any) => !value || String(value).trim().toLowerCase() === "active";
  const isTravelerRole = (value: any) => {
    const role = normalizeRole(value);
    return role === "consumer" || role === "traveler";
  };
  const resolveActorProfile = async (payloadId: string) => {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    try {
      const user = await verifyTokenFromHeader(authHeader);
      const profileFromToken = await getUserProfile(user.id);
      if (profileFromToken) {
        return {
          actorId: user.id,
          actorProfile: profileFromToken,
        };
      }
      const emailFallback = await getUserProfileByEmail(user.email || "");
      if (emailFallback) {
        return {
          actorId: user.id,
          actorProfile: emailFallback,
        };
      }
      const phoneFallback = await getUserProfileByPhone(user.phone || "");
      if (phoneFallback) {
        return {
          actorId: user.id,
          actorProfile: phoneFallback,
        };
      }
      if (payloadId) {
        const profileFromPayload = await getUserProfile(payloadId);
        if (profileFromPayload) {
          return {
            actorId: payloadId,
            actorProfile: profileFromPayload,
          };
        }
      }
      throw Object.assign(new Error("Traveler profile not found."), { status: 404 });
    } catch (tokenError: any) {
      if (!payloadId) throw tokenError;
      const profileFromPayload = await getUserProfile(payloadId);
      if (!profileFromPayload) {
        throw Object.assign(new Error("Traveler profile not found."), { status: 404 });
      }
      return {
        actorId: payloadId,
        actorProfile: profileFromPayload,
      };
    }
  };

  const origin = String(payload.origin || "").trim();
  const destination = String(payload.destination || "").trim();
  const fare = Number(payload.fare);
  const seatsNeeded = Number(payload.seatsNeeded);
  const payloadConsumerId = String(payload.consumerId || "").trim();
  const originLocation = normalizeLocation(payload.originLocation);
  const destinationLocation = normalizeLocation(payload.destinationLocation);

  if (!origin || !destination) {
    return res.status(400).json({ error: "Origin and destination are required." });
  }
  if (!Number.isFinite(fare) || fare <= 0) {
    return res.status(400).json({ error: "Requested fare must be greater than zero." });
  }
  if (!Number.isFinite(seatsNeeded) || seatsNeeded < 1) {
    return res.status(400).json({ error: "Seats needed must be at least 1." });
  }
  if (!originLocation || !destinationLocation) {
    return res.status(400).json({ error: "Valid origin and destination coordinates are required." });
  }

  try {
    const { actorId, actorProfile } = await resolveActorProfile(payloadConsumerId);
    const profileData = (actorProfile.data as Record<string, any>) || {};
    const actorRole = normalizeRole(actorProfile.role || profileData.role);
    if (!isTravelerRole(actorRole)) {
      return res.status(403).json({ error: "Only travelers can post ride requests." });
    }
    if (!isActive(actorProfile.status || profileData.status)) {
      return res.status(403).json({ error: "Traveler account is not active." });
    }

    const requestId = crypto.randomUUID();
    const now = new Date().toISOString();
    const departureTime = String(payload.departureTime || "").trim() || now;
    const requestData = {
      id: requestId,
      consumerId: actorId,
      consumerName:
        String(
          payload.consumerName ||
            actorProfile.display_name ||
            profileData.displayName ||
            actorProfile.email ||
            "Traveler"
        ).trim() || "Traveler",
      consumerPhone: String(payload.consumerPhone || actorProfile.phone_number || profileData.phoneNumber || "").trim(),
      origin,
      destination,
      originLocation,
      destinationLocation,
      fare,
      seatsNeeded: Math.max(1, Math.floor(seatsNeeded)),
      status: "open",
      departureDay: payload.departureDay || "today",
      departureDayLabel: payload.departureDayLabel || "Today",
      departureClock: payload.departureClock || "09:00",
      departureNote:
        payload.departureNote ||
        "Planned departure time may vary due to traffic, road, and operational conditions.",
      departureTime,
      createdAt: now,
      updatedAt: now,
      recordType: "traveler_ride_request",
    };

    const { error: insertRequestError } = await getSupabaseAdmin().from("bookings").insert({
      id: requestId,
      ride_id: null,
      consumer_id: actorId,
      driver_id: null,
      status: "traveler_request_open",
      created_at: now,
      updated_at: now,
      data: requestData,
    });
    if (insertRequestError) throw insertRequestError;

    void notifyNearbyRideRequest(getSupabaseAdmin(), requestData, actorId).catch((notificationError) => {
      console.error("Nearby ride request notification failed:", notificationError);
    });

    return res.status(201).json({
      message: "Traveler ride request created",
      id: requestId,
      request: requestData,
    });
  } catch (error: any) {
    console.error("Error creating traveler ride request:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to create traveler ride request"),
    });
  }
}

export async function handleUserListTravelerRequests(req: any, res: ResLike) {
  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;

    const url = req.url ? new URL(req.url, "http://localhost") : null;
    const scopeParam =
      req.query?.scope ||
      req.body?.scope ||
      url?.searchParams.get("scope") ||
      "open";
    let currentUserId =
      req.body?.userId || req.query?.userId || url?.searchParams.get("userId") || "";

    if (process.env.NODE_ENV === "production") {
      try {
        const user = await verifyTokenFromHeader(authHeader);
        currentUserId = user.id;
      } catch (error: any) {
        return res.status(error?.status || 401).json({
          error: extractErrorMessage(error, "Unauthorized"),
        });
      }
    }

    const scope = String(scopeParam).toLowerCase();
    if (scope === "own" && !currentUserId) {
      return res.status(200).json({ requests: [] });
    }
    let queryBuilder = getSupabaseAdmin()
      .from("bookings")
      .select("id, consumer_id, status, data, created_at, updated_at")
      .in("status", [
        "traveler_request_open",
        "traveler_request_matched",
        "traveler_request_cancelled",
      ])
      .order("created_at", { ascending: false });

    if (scope === "own" && currentUserId) {
      queryBuilder = queryBuilder.eq("consumer_id", currentUserId);
    } else if (scope === "open") {
      queryBuilder = queryBuilder.eq("status", "traveler_request_open");
    }

    const { data, error } = await queryBuilder;
    if (error) {
      if (String(error?.code || "") === "42P01") {
        return res.status(200).json({ requests: [] });
      }
      throw error;
    }

    const requests = (data || []).map(mapTravelerRequestRow);

    return res.status(200).json({
      requests:
        scope === "open" && currentUserId
          ? requests.filter((item: any) => item.consumerId !== currentUserId)
          : requests,
    });
  } catch (error: any) {
    console.error("Error fetching traveler ride requests:", error);
    return res.status(200).json({ requests: [] });
  }
}

export async function handleUserCancelTravelerRequest(req: ReqLike, res: ResLike) {
  const { requestId, consumerId } = req.body || {};
  if (!requestId || !consumerId) {
    return res.status(400).json({ error: "Missing requestId or consumerId" });
  }

  try {
    if (process.env.NODE_ENV === "production") {
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const user = await verifyTokenFromHeader(authHeader);
      if (user.id !== consumerId) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const now = new Date().toISOString();
    const { data: existingRow, error: readError } = await getSupabaseAdmin()
      .from("bookings")
      .select("id, consumer_id, status, data")
      .eq("id", requestId)
      .eq("consumer_id", consumerId)
      .maybeSingle();

    if (readError) throw readError;
    if (!existingRow) {
      return res.status(404).json({ error: "Traveler request not found" });
    }
    if (existingRow.status !== "traveler_request_open") {
      return res.status(409).json({ error: "Only open traveler requests can be cancelled" });
    }

    const mergedData = {
      ...(existingRow.data || {}),
      status: "cancelled",
      updatedAt: now,
    };

    const { error } = await getSupabaseAdmin()
      .from("bookings")
      .update({
        status: "traveler_request_cancelled",
        updated_at: now,
        data: mergedData,
      })
      .eq("id", requestId)
      .eq("consumer_id", consumerId)
      .eq("status", "traveler_request_open");

    if (error) throw error;

    return res.status(200).json({ message: "Traveler request cancelled" });
  } catch (error: any) {
    console.error("Error cancelling traveler ride request:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to cancel traveler ride request"),
    });
  }
}

export async function handleUserSearchRides(_req: ReqLike, res: ResLike) {
  try {
    const admin = getSupabaseAdmin();
    const [{ data: rideRows, error: ridesError }, { data: driverRows, error: driversError }] = await Promise.all([
      admin
        .from("rides")
        .select("id, driver_id, status, data, created_at, updated_at")
        .eq("status", "available"),
      admin
        .from("users")
        .select("id, role, status, onboarding_complete, verification_status, data"),
    ]);

    if (ridesError) throw ridesError;
    if (driversError) throw driversError;

    const approvedDriverIds = new Set(
      (driverRows || [])
        .filter((row: any) => {
          const data = (row.data as Record<string, any>) || {};
          const role = row.role || data.role;
          const status = row.status || data.status;
          const onboardingComplete = row.onboarding_complete ?? data.onboardingComplete;
          const verificationStatus = row.verification_status || data.verificationStatus;
          const hasDriverDetails = Boolean(row.driver_details || data.driverDetails);
          return (
            role === "driver" &&
            status === "active" &&
            onboardingComplete === true &&
            hasDriverDetails &&
            verificationStatus !== "rejected"
          );
        })
        .map((row: any) => row.id)
    );

    const rides = (rideRows || [])
      .filter((row) => approvedDriverIds.has(row.driver_id || row.data?.driverId))
      .map((row: any) => ({
        ...(row.data || {}),
        id: row.id,
        driverId: row.driver_id || row.data?.driverId,
        status: row.status || row.data?.status || "available",
        createdAt: row.created_at || row.data?.createdAt,
        updatedAt: row.updated_at || row.data?.updatedAt,
      }));

    return res.status(200).json({ rides });
  } catch (error: any) {
    console.error("Error searching rides:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to load ride search data"),
    });
  }
}

function parseDataUrlPayload(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw Object.assign(new Error("Invalid data URL payload"), { status: 400 });
  }

  const [, contentType, base64] = match;
  return {
    contentType: contentType || "application/octet-stream",
    buffer: Buffer.from(base64, "base64"),
  };
}

export async function handleUserUploadDriverDoc(req: ReqLike, res: ResLike) {
  const { driverId, path, dataUrl } = req.body || {};

  if (!driverId || !path || !dataUrl) {
    return res.status(400).json({ error: "Missing driverId, path, or dataUrl" });
  }

  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    let user: { id: string; email?: string | null } = { id: String(driverId), email: null };
    try {
      const verifiedUser = await verifyTokenFromHeader(authHeader);
      user = { id: verifiedUser.id, email: verifiedUser.email || null };
    } catch {
      // Fallback for environments where client auth token is not a Supabase session token.
      user = { id: String(driverId), email: null };
    }
    const supabaseAdmin = getSupabaseAdmin();
    const requestedDriverId = String(driverId);
    let targetUserId = user.id;

    if (requestedDriverId !== user.id && user.email) {
      const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
        .from("users")
        .select("id,email")
        .eq("email", String(user.email).toLowerCase())
        .maybeSingle();
      if (profileByEmailError) throw profileByEmailError;
      if (profileByEmail?.id) {
        targetUserId = String(profileByEmail.id);
      }
    }

    if (String(path).includes("..") || String(path).includes("/")) {
      return res.status(400).json({ error: "Invalid upload path" });
    }

    const bucket = process.env.VITE_SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new Error("Supabase storage bucket is not configured.");
    }

    const { contentType, buffer } = parseDataUrlPayload(String(dataUrl));
    const storagePath = `drivers/${targetUserId}/${path}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        upsert: true,
        contentType,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return res.status(200).json({ url: data.publicUrl });
  } catch (error: any) {
    console.error("Error uploading driver document:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to upload driver document"),
    });
  }
}

export async function handleUserCompleteDriverOnboarding(req: ReqLike, res: ResLike) {
  const { driverId, driverDetails } = req.body || {};

  if (!driverId || !driverDetails) {
    return res.status(400).json({ error: "Missing driverId or driverDetails" });
  }

  try {
    const authHeader = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization;
    let user: { id: string; email?: string | null } = { id: String(driverId), email: null };
    try {
      const verifiedUser = await verifyTokenFromHeader(authHeader);
      user = { id: verifiedUser.id, email: verifiedUser.email || null };
    } catch {
      // Fallback for environments where client auth token is not a Supabase session token.
      user = { id: String(driverId), email: null };
    }
    const supabaseAdmin = getSupabaseAdmin();

    const requestedDriverId = String(driverId);
    let targetUserId = user.id || requestedDriverId;
    let existingProfile = await getUserProfile(targetUserId);

    if (!existingProfile && requestedDriverId && requestedDriverId !== targetUserId) {
      const fallbackProfile = await getUserProfile(requestedDriverId);
      if (fallbackProfile) {
        existingProfile = fallbackProfile;
        targetUserId = requestedDriverId;
      }
    }

    if (!existingProfile && user.email) {
      const { data: profileByEmail, error: profileByEmailError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("email", String(user.email).toLowerCase())
        .maybeSingle();
      if (profileByEmailError) throw profileByEmailError;
      if (profileByEmail) {
        existingProfile = profileByEmail;
        targetUserId = profileByEmail.id;
      }
    }

    const expectedEmail = String(existingProfile?.email || user.email || "").toLowerCase();
    const requesterEmail = String(user.email || "").toLowerCase();
    const isSelfMatch = user.id === targetUserId;
    const isEmailMatch = Boolean(expectedEmail && requesterEmail && expectedEmail === requesterEmail);
    const canEnforceIdentity = Boolean(requesterEmail) || user.id !== requestedDriverId;
    if (canEnforceIdentity && !isSelfMatch && !isEmailMatch) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const now = new Date().toISOString();
    const baseData = (existingProfile?.data as Record<string, any>) || {};
    const referralCode =
      String(existingProfile?.referral_code || baseData.referralCode || "").trim().toUpperCase()
      || await generateUniqueReferralCode(supabaseAdmin);
    const existingWalletRaw = existingProfile?.wallet || baseData.wallet || null;
    const parsedExistingBalance = Number((existingWalletRaw as any)?.balance);
    const parsedExistingPending = Number((existingWalletRaw as any)?.pendingBalance);
    const shouldInitializeWallet =
      !existingWalletRaw
      || Number.isNaN(parsedExistingBalance)
      || Number.isNaN(parsedExistingPending);
    const resolvedWallet = shouldInitializeWallet
      ? { balance: DRIVER_JOINING_BONUS, pendingBalance: 0 }
      : {
          balance: parsedExistingBalance,
          pendingBalance: parsedExistingPending,
        };

    const row = {
      id: targetUserId,
      email: expectedEmail || null,
      display_name: existingProfile?.display_name || baseData.displayName || user.email || "Driver",
      role: "driver",
      status: existingProfile?.status || baseData.status || "active",
      phone_number: existingProfile?.phone_number || baseData.phoneNumber || null,
      referral_code: referralCode,
      onboarding_complete: true,
      verification_status: "pending",
      rejection_reason: null,
      verified_by: null,
      admin_role: existingProfile?.admin_role || null,
      force_password_change:
        typeof existingProfile?.force_password_change === "boolean"
          ? existingProfile.force_password_change
          : Boolean(baseData.forcePasswordChange),
      wallet: resolvedWallet,
      driver_details: driverDetails,
      data: {
        ...baseData,
        uid: targetUserId,
        role: "driver",
        referralCode,
        onboardingComplete: true,
        verificationStatus: "pending",
        rejectionReason: null,
        verifiedBy: null,
        wallet: resolvedWallet,
        driverDetails,
      },
      updated_at: now,
    };

    const { error } = await supabaseAdmin.from("users").upsert(row, { onConflict: "id" });

    if (error) throw error;

    if (shouldInitializeWallet) {
      const txId = `init_${targetUserId}`;
      await supabaseAdmin.from("transactions").upsert(
        {
          id: txId,
          user_id: targetUserId,
          type: "wallet_topup",
          status: "completed",
          data: {
            id: txId,
            userId: targetUserId,
            type: "wallet_topup",
            amount: DRIVER_JOINING_BONUS,
            currency: "MAICOIN",
            status: "completed",
            description: "Driver joining bonus",
            createdAt: now,
          },
          created_at: now,
          updated_at: now,
        },
        { onConflict: "id" }
      );
    }

    return res.status(200).json({ message: "Driver onboarding submitted successfully." });
  } catch (error: any) {
    console.error("Error completing driver onboarding:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to complete driver onboarding"),
    });
  }
}

export async function handleUserRejectBooking(req: ReqLike, res: ResLike) {
  const { bookingId, driverId, driverPhone } = req.body || {};

  if (!bookingId || !driverId) {
    return res.status(400).json({ error: "Missing bookingId or driverId" });
  }

  try {
    if (process.env.NODE_ENV === "production") {
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const user = await verifyTokenFromHeader(authHeader);
      if (user.id !== driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const storedDriverId = bookingRow.driver_id || bookingRow.data?.driverId;
    if (storedDriverId !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updatedAt = new Date().toISOString();
    const seedData = bookingRow.data || {};
    const threadKey = getBookingThreadKey(seedData);
    const { data: candidateRows, error: candidateError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("driver_id", driverId)
      .eq("consumer_id", bookingRow.consumer_id || seedData.consumerId);

    if (candidateError) throw candidateError;

    const threadRows = (candidateRows || []).filter((row: any) => {
      const rowData = row.data || {};
      return getBookingThreadKey(rowData) === threadKey && isActiveBookingStatus(row.status || rowData.status);
    });

    await Promise.all(
      (threadRows.length ? threadRows : [bookingRow]).map(async (row: any) => {
        const rowData = row.data || {};
        const nextData = {
          ...rowData,
          status: "rejected",
          negotiationStatus: "rejected",
          negotiationActor: "driver",
          driverCounterPending: false,
          driverPhone: driverPhone || rowData.driverPhone || "",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "rejected",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", row.id);

        if (error) throw error;
      })
    );

    return res.status(200).json({ message: "Traveler offer rejected." });
  } catch (error: any) {
    console.error("Error rejecting booking:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to reject traveler offer"),
    });
  }
}

export async function handleUserRespondBooking(req: ReqLike, res: ResLike) {
  const { bookingId, driverId, action, driverPhone } = req.body || {};

  if (!bookingId || !driverId || !["confirmed", "rejected"].includes(String(action || ""))) {
    return res.status(400).json({ error: "Missing bookingId, driverId, or valid action" });
  }

  try {
    if (process.env.NODE_ENV === "production") {
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const user = await verifyTokenFromHeader(authHeader);
      if (user.id !== driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const storedDriverId = bookingRow.driver_id || bookingRow.data?.driverId;
    if (storedDriverId !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seedData = getBookingThreadSource(bookingRow);
    const updatedAt = new Date().toISOString();
    const consumerId = bookingRow.consumer_id || seedData.consumerId;
    let targetRows = [bookingRow];

    if (consumerId) {
      const { data: candidateRows, error: candidateError } = await supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("consumer_id", consumerId);

      if (candidateError) throw candidateError;

      const activeRows = (candidateRows || []).filter((row: any) => {
        const rowData = getBookingThreadSource(row);
        return (
          isActiveBookingStatus(row.status || rowData.status) &&
          getBookingThreadKey(rowData) === getBookingThreadKey(seedData)
        );
      });

      if (activeRows.length) {
        targetRows = activeRows;
      }
    }

    if (action === "rejected") {
      await Promise.all(
        targetRows.map(async (row: any) => {
          const rowData = row.data || {};
          const nextData = {
            ...rowData,
            status: "rejected",
            negotiationStatus: "rejected",
            negotiationActor: rowData.negotiationActor || "driver",
            driverCounterPending: false,
            rideRetired: true,
            retiredAt: updatedAt,
            driverPhone: driverPhone || rowData.driverPhone || "",
            updatedAt,
          };

          const { error } = await supabaseAdmin
            .from("bookings")
            .update({
              status: "rejected",
              updated_at: updatedAt,
              data: nextData,
            })
            .eq("id", row.id);

          if (error) throw error;
        })
      );

      return res.status(200).json({ message: "Traveler offer rejected." });
    }

    const acceptedFare = Number(
      seedData.negotiationActor === "consumer" && Number.isFinite(Number(seedData.negotiatedFare))
        ? seedData.negotiatedFare
        : seedData.fare
    );

    if (!Number.isFinite(acceptedFare) || acceptedFare <= 0) {
      return res.status(400).json({ error: "No valid fare to confirm" });
    }

    await Promise.all(
      targetRows.map(async (row: any) => {
        const rowData = row.data || {};
        const nextData = {
          ...rowData,
          fare: acceptedFare,
          status: "confirmed",
          negotiationStatus:
            rowData.negotiationStatus === "pending" ? "accepted" : rowData.negotiationStatus,
          negotiationActor: rowData.negotiationActor || "driver",
          driverCounterPending: false,
          driverPhone: driverPhone || rowData.driverPhone || "",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "confirmed",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", row.id);

        if (error) throw error;
      })
    );

    const { error: rideError } = await supabaseAdmin
      .from("rides")
      .update({
        status: "full",
        updated_at: updatedAt,
        data: {
          ...((bookingRow.data as Record<string, any>) || {}),
          status: "full",
          updatedAt,
        },
      })
      .eq("id", bookingRow.ride_id || seedData.rideId);

    if (rideError) throw rideError;

    return res.status(200).json({ message: "Booking confirmed." });
  } catch (error: any) {
    console.error("Error responding to driver booking:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to update booking"),
    });
  }
}

export async function handleUserCounterBooking(req: ReqLike, res: ResLike) {
  const { bookingId, driverId, fare } = req.body || {};

  if (!bookingId || !driverId || !Number.isFinite(Number(fare)) || Number(fare) <= 0) {
    return res.status(400).json({ error: "Missing bookingId, driverId, or valid fare" });
  }

  try {
    if (process.env.NODE_ENV === "production") {
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const user = await verifyTokenFromHeader(authHeader);
      if (user.id !== driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const storedDriverId = bookingRow.driver_id || bookingRow.data?.driverId;
    if (storedDriverId !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seedData = getBookingThreadSource(bookingRow);
    const updatedAt = new Date().toISOString();
    const consumerId = bookingRow.consumer_id || seedData.consumerId;
    let targetRows = [bookingRow];

    if (consumerId) {
      const { data: candidateRows, error: candidateError } = await supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("consumer_id", consumerId);

      if (candidateError) throw candidateError;

      const activeRows = (candidateRows || []).filter((row: any) => {
        const rowData = getBookingThreadSource(row);
        return (
          isActiveBookingStatus(row.status || rowData.status) &&
          getBookingThreadKey(rowData) === getBookingThreadKey(seedData)
        );
      });

      if (activeRows.length) {
        targetRows = activeRows;
      }
    }

    await Promise.all(
      targetRows.map(async (row: any) => {
        const rowData = row.data || {};
        const nextData = {
          ...rowData,
          negotiatedFare: Number(fare),
          negotiationStatus: "pending",
          negotiationActor: "driver",
          driverCounterPending: true,
          status: "negotiating",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "negotiating",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", row.id);

        if (error) throw error;
      })
    );

    return res.status(200).json({ message: "Counter offer sent to traveler." });
  } catch (error: any) {
    console.error("Error countering booking:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to send counter offer"),
    });
  }
}

export async function handleUserTravelerCounterBooking(req: ReqLike, res: ResLike) {
  const { bookingId, consumerId, fare } = req.body || {};

  if (!bookingId || !consumerId || !Number.isFinite(Number(fare)) || Number(fare) <= 0) {
    return res.status(400).json({ error: "Missing bookingId, consumerId, or valid fare" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const storedConsumerId = bookingRow.consumer_id || bookingRow.data?.consumerId;
    if (storedConsumerId !== consumerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seedData = getBookingThreadSource(bookingRow);
    const updatedAt = new Date().toISOString();
    const threadConsumerId = bookingRow.consumer_id || seedData.consumerId;
    let targetRows = [bookingRow];

    if (threadConsumerId) {
      const { data: candidateRows, error: candidateError } = await supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("consumer_id", threadConsumerId);

      if (candidateError) throw candidateError;

      const activeRows = (candidateRows || []).filter((row: any) => {
        const rowData = getBookingThreadSource(row);
        return (
          isActiveBookingStatus(row.status || rowData.status) &&
          getBookingThreadKey(rowData) === getBookingThreadKey(seedData)
        );
      });

      if (activeRows.length) {
        targetRows = activeRows;
      }
    }

    await Promise.all(
      targetRows.map(async (row: any) => {
        const rowData = row.data || {};
        const nextData = {
          ...rowData,
          negotiatedFare: Number(fare),
          negotiationStatus: "pending",
          negotiationActor: "consumer",
          driverCounterPending: false,
          status: "negotiating",
          rideRetired: false,
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "negotiating",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", row.id);

        if (error) throw error;
      })
    );

    return res.status(200).json({ message: "Counter offer sent to the driver." });
  } catch (error: any) {
    console.error("Error sending traveler counter offer:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to send counter offer"),
    });
  }
}

export async function handleUserTravelerRespondBooking(req: ReqLike, res: ResLike) {
  const { bookingId, consumerId, action } = req.body || {};

  if (!bookingId || !consumerId || !["accepted", "rejected"].includes(String(action || ""))) {
    return res.status(400).json({ error: "Missing bookingId, consumerId, or valid action" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const storedConsumerId = bookingRow.consumer_id || bookingRow.data?.consumerId;
    if (storedConsumerId !== consumerId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const seedData = getBookingThreadSource(bookingRow);
    const updatedAt = new Date().toISOString();
    const threadConsumerId = bookingRow.consumer_id || seedData.consumerId;
    let targetRows = [bookingRow];

    if (threadConsumerId) {
      const { data: candidateRows, error: candidateError } = await supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("consumer_id", threadConsumerId);

      if (candidateError) throw candidateError;

      const activeRows = (candidateRows || []).filter((row: any) => {
        const rowData = getBookingThreadSource(row);
        return (
          isActiveBookingStatus(row.status || rowData.status) &&
          getBookingThreadKey(rowData) === getBookingThreadKey(seedData)
        );
      });

      if (activeRows.length) {
        targetRows = activeRows;
      }
    }

    if (action === "accepted") {
      const negotiatedFare = Number(seedData.negotiatedFare ?? bookingRow.data?.negotiatedFare);
      if (!Number.isFinite(negotiatedFare) || negotiatedFare <= 0) {
        return res.status(400).json({ error: "No valid negotiated fare to accept" });
      }

      await Promise.all(
        targetRows.map(async (row: any) => {
          const rowData = row.data || {};
          const nextData = {
            ...rowData,
            fare: negotiatedFare,
            negotiationStatus: "accepted",
            negotiationActor: "driver",
            driverCounterPending: false,
            status: "confirmed",
            updatedAt,
          };

          const { error } = await supabaseAdmin
            .from("bookings")
            .update({
              status: "confirmed",
              updated_at: updatedAt,
              data: nextData,
            })
            .eq("id", row.id);

          if (error) throw error;
        })
      );

      const rideId = bookingRow.ride_id || seedData.rideId;
      if (rideId) {
        const { error: rideError } = await supabaseAdmin
          .from("rides")
          .update({
            status: "full",
            updated_at: updatedAt,
            data: {
              ...((bookingRow.data as Record<string, any>) || {}),
              status: "full",
              updatedAt,
            },
          })
          .eq("id", rideId);

        if (rideError) throw rideError;
      }

      return res.status(200).json({ message: "Counter offer accepted." });
    }

    await Promise.all(
      targetRows.map(async (row: any) => {
        const rowData = row.data || {};
        const nextData = {
          ...rowData,
          status: "rejected",
          negotiationStatus: "rejected",
          negotiationActor: "driver",
          driverCounterPending: false,
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "rejected",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", row.id);

        if (error) throw error;
      })
    );

    return res.status(200).json({ message: "Counter offer rejected." });
  } catch (error: any) {
    console.error("Error responding to traveler booking:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to update negotiation"),
    });
  }
}

export async function handleUserCancelRide(req: ReqLike, res: ResLike) {
  const { rideId, driverId, driverPhone } = req.body || {};

  if (!rideId || !driverId) {
    return res.status(400).json({ error: "Missing rideId or driverId" });
  }

  try {
    if (process.env.NODE_ENV === "production") {
      const authHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const user = await verifyTokenFromHeader(authHeader);
      if (user.id !== driverId) {
        return res.status(403).json({ error: "Forbidden" });
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: rideRow, error: rideError } = await supabaseAdmin
      .from("rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    if (rideError) throw rideError;
    if (!rideRow) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const storedDriverId = rideRow.driver_id || rideRow.data?.driverId;
    if (storedDriverId !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const updatedAt = new Date().toISOString();
    const rideIdsToRetire = [rideId];

    const { data: bookingRows, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("ride_id", rideId);

    if (bookingError) throw bookingError;

    const activeBookingRows = (bookingRows || []).filter((bookingRow: any) => {
      const rowData = bookingRow.data || {};
      return rideIdsToRetire.includes(bookingRow.ride_id || rowData.rideId) && isActiveBookingStatus(bookingRow.status || rowData.status);
    });

    const hasLockedTrip = activeBookingRows.some((bookingRow: any) => {
      const rowData = bookingRow.data || {};
      return (
        bookingRow.status === "confirmed" ||
        rowData.status === "confirmed" ||
        Boolean(rowData.feePaid) ||
        Boolean(rowData.driverFeePaid) ||
        Boolean(rowData.rideStartedAt) ||
        Boolean(rowData.rideEndedAt)
      );
    });

    if (hasLockedTrip) {
      return res.status(409).json({
        error: "This trip is already confirmed and locked for travel. Drivers cannot cancel it now. Please contact MaiRide customer support for an override if cancellation is unavoidable.",
      });
    }

    await Promise.all(
      activeBookingRows.map(async (bookingRow: any) => {
        const rowData = bookingRow.data || {};
        const nextData = {
          ...rowData,
          status: "cancelled",
          negotiationStatus: "rejected",
          negotiationActor: "driver",
          driverCounterPending: false,
          rideRetired: true,
          retiredAt: updatedAt,
          driverPhone: driverPhone || rowData.driverPhone || "",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "cancelled",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", bookingRow.id);

        if (error) throw error;
      })
    );

    await Promise.all(
      rideIdsToRetire.map(async (currentRideId: string) => {
        const nextRideData = {
          ...(rideRow.data || {}),
          status: "cancelled",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("rides")
          .update({
            status: "cancelled",
            updated_at: updatedAt,
            data: nextRideData,
          })
          .eq("id", currentRideId);

        if (error) throw error;
      })
    );

    return res.status(200).json({
      message: "Ride offer cancelled. All live requests linked to it were cleared.",
    });
  } catch (error: any) {
    console.error("Error cancelling ride:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to cancel ride offer"),
    });
  }
}

export async function handleAdminForceCancelRide(req: ReqLike, res: ResLike) {
  const { rideId, bookingId, reason } = req.body || {};

  if (!rideId && !bookingId) {
    return res.status(400).json({ error: "Missing rideId or bookingId" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    let resolvedRideId = String(rideId || "");
    let rideRow: any = null;

    if (resolvedRideId) {
      const { data, error } = await supabaseAdmin
        .from("rides")
        .select("*")
        .eq("id", resolvedRideId)
        .maybeSingle();
      if (error) throw error;
      rideRow = data;
    }

    if (!rideRow && bookingId) {
      const { data: bookingRow, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingError) throw bookingError;
      if (!bookingRow) {
        return res.status(404).json({ error: "Booking not found" });
      }

      resolvedRideId = bookingRow.ride_id || bookingRow.data?.rideId || "";
      if (!resolvedRideId) {
        return res.status(404).json({ error: "Linked ride not found" });
      }

      const { data: resolvedRide, error: rideError } = await supabaseAdmin
        .from("rides")
        .select("*")
        .eq("id", resolvedRideId)
        .maybeSingle();
      if (rideError) throw rideError;
      rideRow = resolvedRide;
    }

    if (!rideRow || !resolvedRideId) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const updatedAt = new Date().toISOString();
    const adminEmail = req.user?.email || req.profile?.email || "";
    const { data: bookingRows, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("ride_id", resolvedRideId);

    if (bookingError) throw bookingError;

    await Promise.all(
      (bookingRows || []).map(async (bookingRow: any) => {
        const rowData = bookingRow.data || {};
        const nextData = {
          ...rowData,
          status: "cancelled",
          negotiationStatus: "rejected",
          negotiationActor: rowData.negotiationActor || "admin",
          driverCounterPending: false,
          rideRetired: true,
          retiredAt: updatedAt,
          forceCancelledByAdmin: true,
          forceCancelledBy: adminEmail,
          cancellationReason: reason || "Cancelled by MaiRide support",
          updatedAt,
        };

        const { error } = await supabaseAdmin
          .from("bookings")
          .update({
            status: "cancelled",
            updated_at: updatedAt,
            data: nextData,
          })
          .eq("id", bookingRow.id);

        if (error) throw error;
      })
    );

    const nextRideData = {
      ...(rideRow.data || {}),
      status: "cancelled",
      forceCancelledByAdmin: true,
      forceCancelledBy: adminEmail,
      cancellationReason: reason || "Cancelled by MaiRide support",
      updatedAt,
    };

    const { error: rideUpdateError } = await supabaseAdmin
      .from("rides")
      .update({
        status: "cancelled",
        updated_at: updatedAt,
        data: nextRideData,
      })
      .eq("id", resolvedRideId);

    if (rideUpdateError) throw rideUpdateError;

    return res.status(200).json({ message: "Ride cancelled by customer support." });
  } catch (error: any) {
    console.error("Error force cancelling ride:", error);
    return res.status(error?.status || 500).json({
      error: extractErrorMessage(error, "Failed to cancel ride from admin panel"),
    });
  }
}

export async function handleSendOtp(req: ReqLike, res: ResLike) {
  const { phoneNumber } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedPhone = String(phoneNumber || "").replace(/[^\d]/g, "");

  if (!normalizedPhone) {
    return res.status(400).json({ Status: "Error", Details: "A valid phone number is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock SMS OTP sent to ${normalizedPhone}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_sms_session_id" });
  }

  try {
    const response = await axios.get(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(normalizedPhone)}/AUTOGEN2`
    );
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("2Factor Send OTP Error:", error.response?.data || error.message);
    res.status(500).json({
      Status: "Error",
      Details: error.response?.data?.Details || error.message || "Failed to send OTP",
    });
  }
}

export async function handleSendEmailOtp(req: ReqLike, res: ResLike) {
  const { email } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({ Status: "Error", Details: "A valid email address is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock Email OTP sent to ${normalizedEmail}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_email_session_id" });
  }

  try {
    const response = await axios.get(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/EMAIL/${encodeURIComponent(normalizedEmail)}/AUTOGEN`
    );
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("2Factor Send Email OTP Error:", error.response?.data || error.message);
    res.status(500).json({
      Status: "Error",
      Details: error.response?.data?.Details || error.message || "Failed to send Email OTP",
    });
  }
}

export async function handleVerifyOtp(req: ReqLike, res: ResLike) {
  const { sessionId, otp } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedOtp = String(otp || "").trim();

  if (!apiKey || normalizedSessionId.startsWith("mock_")) {
    if (normalizedOtp === "123456") {
      return res.status(200).json({ Status: "Success", Details: "OTP Matched" });
    }
    return res.status(400).json({ Status: "Error", Details: "Invalid OTP" });
  }

  try {
    const response = await axios.get(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedOtp)}`
    );
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("2Factor Verify OTP Error:", error.response?.data || error.message);
    res.status(500).json({
      Status: "Error",
      Details: error.response?.data?.Details || error.message || "Failed to verify OTP",
    });
  }
}
