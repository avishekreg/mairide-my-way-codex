import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime";

type CapacityMetricSeverity = "healthy" | "watch" | "warning" | "critical";
const DRIVER_JOINING_BONUS = 500;
const TRAVELER_JOINING_BONUS = 250;

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAction(req: any) {
  const action = req.query?.action;
  if (typeof action === "string") return action;
  if (Array.isArray(action) && action[0]) return action[0];
  return "";
}

function getAuthHeader(req: any) {
  return Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
}

async function getAuthenticatedAdmin(req: any, requireSuperAdmin = false) {
  const authHeader = getAuthHeader(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;

  const configuredSuperAdmin = String(process.env.VITE_SUPER_ADMIN_EMAIL || "").toLowerCase();
  const effectiveAdminRole =
    profile?.admin_role ||
    profile?.data?.adminRole ||
    (authData.user.email && configuredSuperAdmin && authData.user.email.toLowerCase() === configuredSuperAdmin
      ? "super_admin"
      : null);

  if (!profile || profile.role !== "admin" || !effectiveAdminRole) {
    return { error: { status: 403, message: "Forbidden: Admin access required" } };
  }

  if (requireSuperAdmin && effectiveAdminRole !== "super_admin") {
    return { error: { status: 403, message: "Forbidden: Super Admin access required" } };
  }

  return {
    supabaseAdmin,
    user: authData.user,
    profile,
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

function getJoiningBonusByRole(role: string) {
  return role === "driver" ? DRIVER_JOINING_BONUS : TRAVELER_JOINING_BONUS;
}

function parseWallet(raw: any) {
  const balance = Number(raw?.balance);
  const pendingBalance = Number(raw?.pendingBalance);
  if (!Number.isFinite(balance) || !Number.isFinite(pendingBalance)) {
    return null;
  }
  return { balance, pendingBalance };
}

async function backfillDriverJoiningBonuses(supabaseAdmin: any) {
  const { data: driverRows, error } = await supabaseAdmin
    .from("users")
    .select("id,wallet,data,role")
    .eq("role", "driver");

  if (error) throw error;

  for (const row of driverRows || []) {
    const payload = (row?.data as Record<string, any>) || {};
    const walletFromRow = parseWallet(row?.wallet);
    const walletFromPayload = parseWallet(payload?.wallet);
    const currentWallet = walletFromRow || walletFromPayload || { balance: 0, pendingBalance: 0 };

    if (currentWallet.balance >= DRIVER_JOINING_BONUS) {
      continue;
    }

    const nextWallet = {
      balance: DRIVER_JOINING_BONUS,
      pendingBalance: Number.isFinite(currentWallet.pendingBalance) ? currentWallet.pendingBalance : 0,
    };

    await supabaseAdmin
      .from("users")
      .update({
        wallet: nextWallet,
        data: {
          ...payload,
          wallet: nextWallet,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);

    const delta = Math.max(DRIVER_JOINING_BONUS - Number(currentWallet.balance || 0), 0);
    const txId = `driver_bonus_backfill_${row.id}`;
    await supabaseAdmin.from("transactions").upsert({
      id: txId,
      user_id: row.id,
      type: "wallet_topup",
      status: "completed",
      data: {
        id: txId,
        userId: row.id,
        type: "wallet_topup",
        amount: delta,
        currency: "MAICOIN",
        status: "completed",
        description: "Driver joining bonus backfill",
        createdAt: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}

async function handleGetConfig(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { data, error } = await auth.supabaseAdmin
    .from("app_config")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  if (error) throw error;

  return res.status(200).json({
    config: data
      ? {
          id: data.id,
          ...((data.data as Record<string, any>) || {}),
          createdAt: data.created_at,
          updatedAt: data.updated_at,
        }
      : null,
  });
}

async function handleSaveConfig(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const payload = req.body || {};
  const now = new Date().toISOString();
  const configData = {
    ...payload,
    updatedAt: now,
    updatedBy: auth.user.email || auth.profile.email || "admin",
  };

  const { error } = await auth.supabaseAdmin.from("app_config").upsert(
    {
      id: "global",
      updated_at: now,
      data: configData,
    },
    { onConflict: "id" }
  );

  if (error) throw error;

  return res.status(200).json({
    message: "Configuration saved successfully",
    config: {
      id: "global",
      ...configData,
    },
  });
}

async function handleGetTransactions(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, false);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { data, error } = await auth.supabaseAdmin
    .from("transactions")
    .select("id,user_id,type,status,created_at,updated_at,data")
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) throw error;

  const transactions = (data || []).map((row: any) => ({
    ...((row.data as Record<string, any>) || {}),
    id: row.id,
    userId: row.user_id ?? row.data?.userId ?? null,
    type: row.type ?? row.data?.type ?? null,
    status: row.status ?? row.data?.status ?? null,
    createdAt: row.created_at ?? row.data?.createdAt ?? null,
    updatedAt: row.updated_at ?? row.data?.updatedAt ?? null,
  }));

  res.setHeader("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
  return res.status(200).json({ transactions });
}

async function handleGetUsers(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, false);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  // Keep historical admin-created drivers aligned with the latest joining bonus policy.
  await backfillDriverJoiningBonuses(auth.supabaseAdmin);

  const { data, error } = await auth.supabaseAdmin
    .from("users")
    .select("id,email,display_name,role,status,phone_number,onboarding_complete,admin_role,verification_status,rejection_reason,verified_by,force_password_change,driver_details,created_at,updated_at,data")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const users = (data || []).map((row: any) => {
    const payload = (row.data as Record<string, any>) || {};
    return {
      ...payload,
      uid: row.id,
      email: row.email || payload.email || "",
      displayName: row.display_name || payload.displayName || "",
      role: row.role || payload.role || "consumer",
      status: row.status || payload.status || "active",
      phoneNumber: row.phone_number || payload.phoneNumber || "",
      onboardingComplete:
        typeof row.onboarding_complete === "boolean"
          ? row.onboarding_complete
          : Boolean(payload.onboardingComplete),
      adminRole: row.admin_role || payload.adminRole,
      verificationStatus: row.verification_status || payload.verificationStatus,
      rejectionReason: row.rejection_reason || payload.rejectionReason,
      verifiedBy: row.verified_by || payload.verifiedBy,
      forcePasswordChange:
        typeof row.force_password_change === "boolean"
          ? row.force_password_change
          : Boolean(payload.forcePasswordChange),
      driverDetails: row.driver_details || payload.driverDetails,
      createdAt: row.created_at || payload.createdAt,
      updatedAt: row.updated_at || payload.updatedAt,
    };
  });

  res.setHeader("Cache-Control", "private, max-age=15, stale-while-revalidate=45");
  return res.status(200).json({ users });
}

async function handleVerifyDriver(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { uid, verificationStatus, rejectionReason } = req.body || {};
  const normalizedStatus =
    verificationStatus === "approved" || verificationStatus === "rejected"
      ? verificationStatus
      : null;

  if (!uid || !normalizedStatus) {
    return res.status(400).json({ error: "Missing uid or valid verificationStatus" });
  }

  const { data: existingUser, error: existingUserError } = await auth.supabaseAdmin
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
    uid,
    role: "driver",
    onboardingComplete: true,
    verificationStatus: normalizedStatus,
    rejectionReason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
    verifiedBy: auth.user.id,
    status: normalizedStatus === "approved" ? "active" : "inactive",
    driverDetails: existingUser.driver_details || existingData.driverDetails || null,
  };

  const { error } = await auth.supabaseAdmin
    .from("users")
    .update({
      role: "driver",
      onboarding_complete: true,
      verification_status: normalizedStatus,
      rejection_reason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
      verified_by: auth.user.id,
      status: normalizedStatus === "approved" ? "active" : "inactive",
      driver_details: existingUser.driver_details || existingData.driverDetails || null,
      data: nextData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uid);

  if (error) throw error;

  return res.status(200).json({ message: `Driver ${normalizedStatus} successfully.` });
}

async function handleCreateUser(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { email, password, displayName, phoneNumber, role, adminRole } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = String(phoneNumber || "").replace(/[^\d+]/g, "");

  if (!normalizedEmail || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { data: existingUser, error: existingUserError } = await auth.supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingUserError) throw existingUserError;
  if (existingUser) {
    return res.status(409).json({ error: "A user with this email already exists." });
  }

  const { data: authCreateData, error: authCreateError } = await auth.supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (authCreateError || !authCreateData.user) {
    throw authCreateError || new Error("Failed to create auth user");
  }

  const referralCode = await generateUniqueReferralCode(auth.supabaseAdmin);
  const joiningBonus = getJoiningBonusByRole(role);
  const wallet = { balance: joiningBonus, pendingBalance: 0 };
  const row = {
    id: authCreateData.user.id,
    email: normalizedEmail,
    display_name: displayName,
    role,
    status: "active",
    phone_number: normalizedPhone || null,
    referral_code: referralCode,
    onboarding_complete: role !== "driver",
    admin_role: role === "admin" ? adminRole || "support" : null,
    force_password_change: true,
    wallet,
    data: {
      uid: authCreateData.user.id,
      email: normalizedEmail,
      displayName,
      role,
      status: "active",
      phoneNumber: normalizedPhone || "",
      referralCode,
      onboardingComplete: role !== "driver",
      adminRole: role === "admin" ? adminRole || "support" : undefined,
      forcePasswordChange: true,
      wallet,
    },
  };

  const { error: profileError } = await auth.supabaseAdmin.from("users").upsert(row, {
    onConflict: "id",
  });

  if (profileError) throw profileError;

  const txId = `init_${authCreateData.user.id}`;
  await auth.supabaseAdmin.from("transactions").upsert({
    id: txId,
    user_id: authCreateData.user.id,
    type: "wallet_topup",
    status: "completed",
    data: {
      id: txId,
      userId: authCreateData.user.id,
      type: "wallet_topup",
      amount: joiningBonus,
      currency: "MAICOIN",
      status: "completed",
      description: role === "driver" ? "Driver joining bonus" : "Traveler joining bonus",
      createdAt: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  return res.status(201).json({
    message: "User created successfully",
    uid: authCreateData.user.id,
  });
}

async function handleUpdatePassword(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { uid, newPassword } = req.body || {};
  if (!uid || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const { error: authError } = await auth.supabaseAdmin.auth.admin.updateUserById(uid, {
    password: newPassword,
  });
  if (authError) throw authError;

  const { data: profile } = await auth.supabaseAdmin.from("users").select("*").eq("id", uid).maybeSingle();
  const mergedData = {
    ...(((profile as any)?.data) || {}),
    forcePasswordChange: true,
  };

  const { error: updateError } = await auth.supabaseAdmin
    .from("users")
    .update({
      force_password_change: true,
      data: mergedData,
    })
    .eq("id", uid);

  if (updateError) throw updateError;

  return res.status(200).json({ message: "Password updated successfully" });
}

async function handleGenerateResetLink(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: "Missing required email" });
  }

  const redirectTo =
    process.env.APP_URL ||
    process.env.VITE_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  const { data, error } = await auth.supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (error) throw error;

  res.setHeader("Cache-Control", "private, max-age=10, stale-while-revalidate=30");
  return res.status(200).json({
    message: "Reset link generated successfully",
    actionLink: data?.properties?.action_link || null,
  });
}

async function handleForceCancelRide(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, false);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { rideId } = req.body || {};
  if (!rideId) {
    return res.status(400).json({ error: "Missing rideId" });
  }

  const { error: rideError } = await auth.supabaseAdmin
    .from("rides")
    .update({
      status: "cancelled",
      data: { cancelledByAdmin: true, cancelledAt: new Date().toISOString() },
    })
    .eq("id", rideId);
  if (rideError) throw rideError;

  const { data: linkedBookings, error: bookingFetchError } = await auth.supabaseAdmin
    .from("bookings")
    .select("*")
    .eq("ride_id", rideId);
  if (bookingFetchError) throw bookingFetchError;

  for (const booking of linkedBookings || []) {
    const bookingData = (booking.data as Record<string, any>) || {};
    const { error: bookingError } = await auth.supabaseAdmin
      .from("bookings")
      .update({
        status: "cancelled",
        data: {
          ...bookingData,
          rideRetired: true,
          rideCancellationReason: "Cancelled by MaiRide support",
        },
      })
      .eq("id", booking.id);
    if (bookingError) throw bookingError;
  }

  return res.status(200).json({ message: "Ride cancelled successfully." });
}

async function handleDeleteUser(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, true);
  if ("error" in auth) {
    return res.status(auth.error.status).json({ error: auth.error.message });
  }

  const { uid } = req.body || {};
  if (!uid) {
    return res.status(400).json({ error: "Missing required uid" });
  }

  if (auth.user.id === uid) {
    return res.status(400).json({ error: "You cannot delete the currently logged-in super admin." });
  }

  await auth.supabaseAdmin.from("support_tickets").delete().eq("user_id", uid);
  await auth.supabaseAdmin.from("transactions").delete().eq("user_id", uid);
  await auth.supabaseAdmin.from("referrals").delete().or(`referrer_id.eq.${uid},referred_id.eq.${uid}`);
  await auth.supabaseAdmin.from("bookings").delete().or(`consumer_id.eq.${uid},driver_id.eq.${uid}`);
  await auth.supabaseAdmin.from("rides").delete().eq("driver_id", uid);
  await auth.supabaseAdmin.from("users").delete().eq("id", uid);
  await auth.supabaseAdmin.auth.admin.deleteUser(uid);

  return res.status(200).json({ message: "User deleted successfully." });
}

function normalizeToIso(input: any) {
  if (!input) return null;
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function dayKeyFromIso(iso: string) {
  return iso.slice(0, 10);
}

function utcDayStartIso(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function daysBackIso(days: number) {
  const now = Date.now();
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

function safeNumber(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateRowBytes(row: any) {
  try {
    return Buffer.byteLength(JSON.stringify(row ?? {}), "utf8");
  } catch {
    return 0;
  }
}

function metricSeverity(utilizationPercent: number): CapacityMetricSeverity {
  if (utilizationPercent >= 95) return "critical";
  if (utilizationPercent >= 80) return "warning";
  if (utilizationPercent >= 60) return "watch";
  return "healthy";
}

function makeMetric(input: {
  key: string;
  label: string;
  category: string;
  used: number;
  capacity: number;
  unit: string;
  notes?: string;
}) {
  const safeCapacity = Math.max(1, safeNumber(input.capacity, 1));
  const used = Math.max(0, safeNumber(input.used, 0));
  const utilization = Number(((used / safeCapacity) * 100).toFixed(2));
  const severity = metricSeverity(utilization);
  return {
    ...input,
    used,
    capacity: safeCapacity,
    utilization,
    severity,
    threshold80Reached: utilization >= 80,
    threshold95Reached: utilization >= 95,
  };
}

function pluckTimestamp(row: any, ...keys: string[]) {
  for (const key of keys) {
    const value = row?.[key];
    const normalized = normalizeToIso(value);
    if (normalized) return normalized;
  }
  return null;
}

function buildLastDays(dayCount: number) {
  const days: string[] = [];
  const now = new Date();
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(now.getUTCDate() - i);
    days.push(dayKeyFromIso(d.toISOString()));
  }
  return days;
}

function roleFromUserRow(row: any) {
  return String(row?.role || row?.data?.role || "consumer").toLowerCase();
}

function bookingStatusFromRow(row: any) {
  return String(row?.status || row?.data?.status || "").toLowerCase();
}

function rideLifecycleFromRow(row: any) {
  return String(row?.data?.rideLifecycleStatus || "").toLowerCase();
}

function transactionRevenueFromRow(row: any) {
  const metadata = row?.data?.metadata || {};
  if (typeof metadata?.revenue === "number") return metadata.revenue;
  const amount = safeNumber(row?.data?.amount, 0);
  if (String(row?.type || row?.data?.type) === "maintenance_fee_payment" && amount > 0) {
    return amount;
  }
  return 0;
}

function transactionGstFromRow(row: any) {
  const metadata = row?.data?.metadata || {};
  return safeNumber(metadata?.gstAmount, 0);
}

async function handleCapacity(req: any, res: any) {
  const auth = await getAuthenticatedAdmin(req, false);
  if ("error" in auth) {
    const nowIso = new Date().toISOString();
    return res.status(200).json({
      generatedAt: nowIso,
      limits: {},
      metrics: [],
      summary: {
        liveSessionsNow: 0,
        staleSessionsNow: 0,
        offlineLinksNow: 0,
        antiSpoofAlertsNow: 0,
        realtimeSignalsLast24h: 0,
        monthlySignalsEstimate: 0,
        mauLast30: 0,
        ridesToday: 0,
        bookingsToday: 0,
        completedBookingsToday: 0,
        revenueToday: 0,
        gstToday: 0,
        totalUsersTracked90d: 0,
        totalRidesTracked90d: 0,
        totalBookingsTracked90d: 0,
        totalTransactionsTracked90d: 0,
        totalTicketsTracked90d: 0,
      },
      daily: [],
      alerts: [],
      snapshots: [],
      alertHistory: [],
      storageStatus: {
        snapshotsPersisted: false,
        alertsPersisted: false,
        notes: [
          `Capacity endpoint fallback: ${auth.error.message || "Unauthorized"}.`,
          "Refresh the session and reopen Capacity to load full metrics.",
        ],
      },
    });
  }

  const nowIso = new Date().toISOString();
  const ninetyDaysAgo = daysBackIso(90);
  const thirtyDaysAgo = daysBackIso(30);
  const twentyFourHoursAgo = daysBackIso(1);

  const { data: configRow } = await auth.supabaseAdmin
    .from("app_config")
    .select("data")
    .eq("id", "global")
    .maybeSingle();
  const configData = (configRow?.data as Record<string, any>) || {};

  const limits = {
    dailySignups: safeNumber(configData.capacityDailySignups, 250),
    dailyDriverOnboarding: safeNumber(configData.capacityDailyDriverOnboarding, 80),
    dailyTravelerOnboarding: safeNumber(configData.capacityDailyTravelerOnboarding, 200),
    dailyBookings: safeNumber(configData.capacityDailyBookings, 200),
    concurrentLiveTrips: safeNumber(configData.capacityConcurrentLiveTrips, 40),
    supabaseMau: safeNumber(configData.capacitySupabaseMau, 50000),
    supabaseRealtimeMessagesMonthly: safeNumber(configData.capacitySupabaseRealtimeMessagesMonthly, 2000000),
    supabaseDbStorageMb: safeNumber(configData.capacitySupabaseDbStorageMb, 500),
    supabaseBandwidthGbMonthly: safeNumber(configData.capacitySupabaseBandwidthGbMonthly, 10),
    googleMapsLoadsMonthly: safeNumber(configData.capacityGoogleMapsLoadsMonthly, 10000),
    geminiRequestsDaily: safeNumber(configData.capacityGeminiRequestsDaily, 1500),
    vercelDeploymentsDaily: safeNumber(configData.capacityVercelDeploymentsDaily, 100),
  };

  const capacityNotes: string[] = [];

  const [usersResult, ridesResult, bookingsResult, transactionsResult, ticketsResult] = await Promise.all([
    auth.supabaseAdmin
      .from("users")
      .select("id, role, status, created_at, updated_at, data")
      .gte("created_at", ninetyDaysAgo),
    auth.supabaseAdmin
      .from("rides")
      .select("id, status, created_at, updated_at, data")
      .gte("created_at", ninetyDaysAgo),
    auth.supabaseAdmin
      .from("bookings")
      .select("id, status, created_at, updated_at, data")
      .gte("created_at", ninetyDaysAgo),
    auth.supabaseAdmin
      .from("transactions")
      .select("id, type, status, created_at, updated_at, data")
      .gte("created_at", ninetyDaysAgo),
    auth.supabaseAdmin
      .from("support_tickets")
      .select("id, status, priority, created_at, updated_at, data")
      .gte("created_at", ninetyDaysAgo),
  ]);

  let sessions: any[] = [];
  try {
    const sessionsResult = await auth.supabaseAdmin
      .from("tripSessions")
      .select("id, created_at, updated_at, data")
      .gte("updated_at", ninetyDaysAgo);
    if (sessionsResult.error) {
      const errMsg = String(sessionsResult.error.message || "").toLowerCase();
      const isMissingRelation =
        errMsg.includes("does not exist") ||
        errMsg.includes("relation") ||
        errMsg.includes("schema cache");
      if (!isMissingRelation) {
        throw sessionsResult.error;
      }
      capacityNotes.push("Trip session table not available yet. Tracking metrics will appear after tracking schema is applied.");
    } else {
      sessions = sessionsResult.data || [];
    }
  } catch (sessionError: any) {
    capacityNotes.push(`Trip session feed unavailable (${sessionError?.message || "unknown error"}).`);
  }

  const users = usersResult.data || [];
  const rides = ridesResult.data || [];
  const bookings = bookingsResult.data || [];
  const transactions = transactionsResult.data || [];
  const tickets = ticketsResult.data || [];

  if (usersResult.error) capacityNotes.push(`Users feed issue: ${usersResult.error.message}`);
  if (ridesResult.error) capacityNotes.push(`Rides feed issue: ${ridesResult.error.message}`);
  if (bookingsResult.error) capacityNotes.push(`Bookings feed issue: ${bookingsResult.error.message}`);
  if (transactionsResult.error) capacityNotes.push(`Transactions feed issue: ${transactionsResult.error.message}`);
  if (ticketsResult.error) capacityNotes.push(`Support feed issue: ${ticketsResult.error.message}`);

  const daySeries = buildLastDays(90);
  const bucket = new Map(
    daySeries.map((day) => [
      day,
      {
        day,
        signups: 0,
        driverSignups: 0,
        travelerSignups: 0,
        ridesCreated: 0,
        bookingsCreated: 0,
        completedBookings: 0,
        revenue: 0,
        gst: 0,
        supportTickets: 0,
        liveSessions: 0,
        realtimeSignals: 0,
        staleSessions: 0,
      },
    ])
  );

  const todayKey = dayKeyFromIso(nowIso);

  let liveSessionsNow = 0;
  let staleSessionsNow = 0;
  let offlineLinksNow = 0;
  let antiSpoofAlertsNow = 0;
  let realtimeSignalsLast24h = 0;
  let geminiCallsLast24h = 0;

  const realtimeActiveThresholdMs = 60_000;
  const nowMs = Date.now();

  users.forEach((row: any) => {
    const createdAt = pluckTimestamp(row, "created_at", "updated_at");
    if (!createdAt) return;
    const key = dayKeyFromIso(createdAt);
    const target = bucket.get(key);
    if (!target) return;
    target.signups += 1;
    const role = roleFromUserRow(row);
    if (role === "driver") target.driverSignups += 1;
    if (role === "consumer") target.travelerSignups += 1;
  });

  rides.forEach((row: any) => {
    const createdAt = pluckTimestamp(row, "created_at");
    if (!createdAt) return;
    const target = bucket.get(dayKeyFromIso(createdAt));
    if (!target) return;
    target.ridesCreated += 1;
  });

  bookings.forEach((row: any) => {
    const createdAt = pluckTimestamp(row, "created_at");
    if (!createdAt) return;
    const target = bucket.get(dayKeyFromIso(createdAt));
    if (!target) return;
    target.bookingsCreated += 1;
    const status = bookingStatusFromRow(row);
    const lifecycle = rideLifecycleFromRow(row);
    if (status === "completed" || lifecycle === "completed") {
      target.completedBookings += 1;
    }
  });

  transactions.forEach((row: any) => {
    const createdAt = pluckTimestamp(row, "created_at");
    if (!createdAt) return;
    const target = bucket.get(dayKeyFromIso(createdAt));
    if (!target) return;
    target.revenue += transactionRevenueFromRow(row);
    target.gst += transactionGstFromRow(row);
    const txType = String(row?.type || row?.data?.type || "").toLowerCase();
    if (txType === "llm_chat" || txType === "chatbot_usage") {
      const createdMs = new Date(createdAt).getTime();
      if (createdMs >= new Date(twentyFourHoursAgo).getTime()) {
        geminiCallsLast24h += 1;
      }
    }
  });

  tickets.forEach((row: any) => {
    const createdAt = pluckTimestamp(row, "created_at");
    if (!createdAt) return;
    const target = bucket.get(dayKeyFromIso(createdAt));
    if (!target) return;
    target.supportTickets += 1;
  });

  sessions.forEach((row: any) => {
    const sessionData = (row?.data as Record<string, any>) || {};
    const updatedAt = normalizeToIso(row?.updated_at || sessionData.updatedAt || sessionData.lastSignalAt || row?.created_at);
    if (!updatedAt) return;
    const key = dayKeyFromIso(updatedAt);
    const target = bucket.get(key);
    if (target) {
      target.liveSessions += 1;
      const auditTrail = Array.isArray(sessionData.auditTrail) ? sessionData.auditTrail : [];
      target.realtimeSignals += auditTrail.length;
      if (sessionData.isStale) target.staleSessions += 1;
    }

    const status = String(sessionData.status || "").toLowerCase();
    const networkState = String(sessionData.networkState || "").toLowerCase();
    const isStale = Boolean(sessionData.isStale);
    const updatedMs = new Date(updatedAt).getTime();
    const isFresh = nowMs - updatedMs <= realtimeActiveThresholdMs;

    if ((status === "live" || status === "preparing") && isFresh) {
      liveSessionsNow += 1;
    }
    if (isStale) {
      staleSessionsNow += 1;
    }
    if (networkState === "offline") {
      offlineLinksNow += 1;
    }

    const auditTrail = Array.isArray(sessionData.auditTrail) ? sessionData.auditTrail : [];
    auditTrail.forEach((entry: any) => {
      const entryTime = normalizeToIso(entry?.createdAt);
      if (!entryTime) return;
      if (new Date(entryTime).getTime() >= new Date(twentyFourHoursAgo).getTime()) {
        realtimeSignalsLast24h += 1;
      }
      if (entry?.meta?.spoofDetected) {
        antiSpoofAlertsNow += 1;
      }
    });
  });

  const today = bucket.get(todayKey) || {
    day: todayKey,
    signups: 0,
    driverSignups: 0,
    travelerSignups: 0,
    ridesCreated: 0,
    bookingsCreated: 0,
    completedBookings: 0,
    revenue: 0,
    gst: 0,
    supportTickets: 0,
    liveSessions: 0,
    realtimeSignals: 0,
    staleSessions: 0,
  };

  const monthlySignalsEstimate = Math.round(realtimeSignalsLast24h * 30);
  const mauLast30 = new Set(
    users
      .filter((row: any) => {
        const activeAt = normalizeToIso(row?.updated_at || row?.created_at || row?.data?.updatedAt);
        return activeAt ? new Date(activeAt).getTime() >= new Date(thirtyDaysAgo).getTime() : false;
      })
      .map((row: any) => row.id)
  ).size;

  const dbFootprintMbEstimate = Number(
    (
      [users, rides, bookings, transactions, tickets, sessions]
        .flat()
        .reduce((total: number, row: any) => total + estimateRowBytes(row), 0) /
      (1024 * 1024)
    ).toFixed(2)
  );

  const mapsLoadsMonthlyEstimate = Math.round((mauLast30 || 0) * 24);
  const bandwidthMonthlyEstimateGb = Number(((monthlySignalsEstimate * 0.0012) / 1024).toFixed(3));

  const metrics = [
    makeMetric({
      key: "daily_signups",
      label: "Daily signups",
      category: "Onboarding",
      used: today.signups,
      capacity: limits.dailySignups,
      unit: "users/day",
      notes: "Total traveler + driver signups today.",
    }),
    makeMetric({
      key: "daily_driver_onboarding",
      label: "Daily driver onboarding",
      category: "Onboarding",
      used: today.driverSignups,
      capacity: limits.dailyDriverOnboarding,
      unit: "drivers/day",
      notes: "Driver account creation throughput.",
    }),
    makeMetric({
      key: "daily_traveler_onboarding",
      label: "Daily traveler onboarding",
      category: "Onboarding",
      used: today.travelerSignups,
      capacity: limits.dailyTravelerOnboarding,
      unit: "travelers/day",
      notes: "Traveler account creation throughput.",
    }),
    makeMetric({
      key: "daily_bookings",
      label: "Daily bookings",
      category: "Marketplace",
      used: today.bookingsCreated,
      capacity: limits.dailyBookings,
      unit: "bookings/day",
      notes: "Bookings created today.",
    }),
    makeMetric({
      key: "live_trip_concurrency",
      label: "Live trip concurrency",
      category: "Tracking",
      used: liveSessionsNow,
      capacity: limits.concurrentLiveTrips,
      unit: "live sessions",
      notes: "Active session heartbeat in last 60s.",
    }),
    makeMetric({
      key: "supabase_mau",
      label: "Supabase MAU (30d)",
      category: "Supabase",
      used: mauLast30,
      capacity: limits.supabaseMau,
      unit: "users / 30d",
      notes: "Approx from users table activity.",
    }),
    makeMetric({
      key: "supabase_realtime_monthly_est",
      label: "Realtime messages (monthly estimate)",
      category: "Supabase",
      used: monthlySignalsEstimate,
      capacity: limits.supabaseRealtimeMessagesMonthly,
      unit: "events/month",
      notes: "Derived from trip session audit signals.",
    }),
    makeMetric({
      key: "supabase_db_storage_est",
      label: "DB storage (estimated)",
      category: "Supabase",
      used: dbFootprintMbEstimate,
      capacity: limits.supabaseDbStorageMb,
      unit: "MB",
      notes: "Payload approximation from sampled operational tables.",
    }),
    makeMetric({
      key: "supabase_bandwidth_monthly_est",
      label: "Bandwidth (monthly estimate)",
      category: "Supabase",
      used: bandwidthMonthlyEstimateGb,
      capacity: limits.supabaseBandwidthGbMonthly,
      unit: "GB/month",
      notes: "Derived estimate from tracking signal volume.",
    }),
    makeMetric({
      key: "google_maps_loads_monthly_est",
      label: "Google Maps loads (monthly estimate)",
      category: "Google Maps",
      used: mapsLoadsMonthlyEstimate,
      capacity: limits.googleMapsLoadsMonthly,
      unit: "loads/month",
      notes: "Estimated map views from active users.",
    }),
    makeMetric({
      key: "gemini_daily_requests",
      label: "Gemini requests (24h)",
      category: "LLM",
      used: geminiCallsLast24h,
      capacity: limits.geminiRequestsDaily,
      unit: "requests/day",
      notes: "Tracks logged chatbot usage events.",
    }),
    makeMetric({
      key: "vercel_deployments_daily",
      label: "Vercel deployments (manual tracker)",
      category: "Vercel",
      used: 0,
      capacity: limits.vercelDeploymentsDaily,
      unit: "deploys/day",
      notes: "Set by deployment event logging; currently manual fallback.",
    }),
  ];

  const alerts = metrics
    .filter((metric) => metric.utilization >= 80)
    .sort((a, b) => b.utilization - a.utilization)
    .map((metric) => ({
      id: `alert_${metric.key}_${todayKey}`,
      metricKey: metric.key,
      metricLabel: metric.label,
      category: metric.category,
      severity: metricSeverity(metric.utilization),
      utilization: metric.utilization,
      used: metric.used,
      capacity: metric.capacity,
      unit: metric.unit,
      threshold: metric.utilization >= 95 ? 95 : 80,
      message:
        metric.utilization >= 95
          ? `${metric.label} is above 95% capacity. Immediate action required.`
          : `${metric.label} has crossed 80% capacity. Plan scaling action now.`,
      observedAt: nowIso,
    }));

  const daily = daySeries.map((day) => {
    const row = bucket.get(day)!;
    return {
      ...row,
      revenue: Number(row.revenue.toFixed(2)),
      gst: Number(row.gst.toFixed(2)),
    };
  });

  const snapshotPayload = {
    id: todayKey,
    snapshot_day: todayKey,
    generated_at: nowIso,
    data: {
      generatedAt: nowIso,
      limits,
      metrics,
      summary: {
        liveSessionsNow,
        staleSessionsNow,
        offlineLinksNow,
        antiSpoofAlertsNow,
        realtimeSignalsLast24h,
        monthlySignalsEstimate,
        mauLast30,
        ridesToday: today.ridesCreated,
        bookingsToday: today.bookingsCreated,
        completedBookingsToday: today.completedBookings,
        revenueToday: Number(today.revenue.toFixed(2)),
        gstToday: Number(today.gst.toFixed(2)),
      },
    },
  };

  const storageStatus = {
    snapshotsPersisted: false,
    alertsPersisted: false,
    notes: [...capacityNotes] as string[],
  };

  try {
    const { error: snapshotError } = await auth.supabaseAdmin
      .from("platform_capacity_snapshots")
      .upsert(snapshotPayload, { onConflict: "id" });
    if (snapshotError) throw snapshotError;
    storageStatus.snapshotsPersisted = true;
  } catch (error: any) {
    storageStatus.notes.push(
      `Snapshot table unavailable (${error?.message || "unknown error"}). Run latest schema SQL on Supabase.`
    );
  }

  try {
    if (alerts.length) {
      const alertRows = alerts.map((alert) => ({
        id: `${alert.metricKey}_${todayKey}_${alert.threshold}`,
        metric_key: alert.metricKey,
        severity: alert.severity,
        utilization: alert.utilization,
        observed_at: alert.observedAt,
        status: "open",
        data: alert,
      }));
      const { error: alertError } = await auth.supabaseAdmin
        .from("platform_capacity_alerts")
        .upsert(alertRows, { onConflict: "id" });
      if (alertError) throw alertError;
    }
    storageStatus.alertsPersisted = true;
  } catch (error: any) {
    storageStatus.notes.push(
      `Alert table unavailable (${error?.message || "unknown error"}). Run latest schema SQL on Supabase.`
    );
  }

  let snapshots: any[] = [];
  let alertHistory: any[] = [];
  try {
    const snapshotsRes = await auth.supabaseAdmin
      .from("platform_capacity_snapshots")
      .select("id, snapshot_day, generated_at, data")
      .gte("snapshot_day", daySeries[0])
      .order("snapshot_day", { ascending: true });
    if (!snapshotsRes.error) {
      snapshots = snapshotsRes.data || [];
    }
  } catch {
    // Ignore history fetch failure and return current snapshot payload only
  }

  try {
    const alertsRes = await auth.supabaseAdmin
      .from("platform_capacity_alerts")
      .select("id, metric_key, severity, utilization, observed_at, status, data")
      .gte("observed_at", ninetyDaysAgo)
      .order("observed_at", { ascending: false })
      .limit(120);
    if (!alertsRes.error) {
      alertHistory = alertsRes.data || [];
    }
  } catch {
    // Ignore history fetch failure and return computed alerts
  }

  return res.status(200).json({
    generatedAt: nowIso,
    limits,
    metrics,
    summary: {
      liveSessionsNow,
      staleSessionsNow,
      offlineLinksNow,
      antiSpoofAlertsNow,
      realtimeSignalsLast24h,
      monthlySignalsEstimate,
      mauLast30,
      ridesToday: today.ridesCreated,
      bookingsToday: today.bookingsCreated,
      completedBookingsToday: today.completedBookings,
      revenueToday: Number(today.revenue.toFixed(2)),
      gstToday: Number(today.gst.toFixed(2)),
      totalUsersTracked90d: users.length,
      totalRidesTracked90d: rides.length,
      totalBookingsTracked90d: bookings.length,
      totalTransactionsTracked90d: transactions.length,
      totalTicketsTracked90d: tickets.length,
    },
    daily,
    alerts,
    storageStatus,
    snapshots,
    alertHistory: alertHistory.map((row: any) => ({
      id: row.id,
      metricKey: row.metric_key,
      severity: row.severity,
      utilization: safeNumber(row.utilization, 0),
      observedAt: row.observed_at,
      status: row.status,
      ...(row.data || {}),
    })),
  });
}

export default async function handler(req: any, res: any) {
  let action = "";
  try {
    action = getAction(req);

    switch (action) {
      case "config":
        if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
        return handleGetConfig(req, res);
      case "save-config":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleSaveConfig(req, res);
      case "transactions":
        if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
        return handleGetTransactions(req, res);
      case "users":
        if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
        return handleGetUsers(req, res);
      case "verify-driver":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleVerifyDriver(req, res);
      case "create-user":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleCreateUser(req, res);
      case "update-password":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleUpdatePassword(req, res);
      case "generate-reset-link":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleGenerateResetLink(req, res);
      case "force-cancel-ride":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleForceCancelRide(req, res);
      case "delete-user":
        if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
        return handleDeleteUser(req, res);
      case "capacity":
        if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
        return handleCapacity(req, res);
      default:
        return res.status(404).json({ error: "Admin action not found" });
    }
  } catch (error: any) {
    console.error("Standalone admin API failed:", error);
    if (action === "capacity") {
      const nowIso = new Date().toISOString();
      return res.status(200).json({
        generatedAt: nowIso,
        limits: {},
        metrics: [],
        summary: {
          liveSessionsNow: 0,
          staleSessionsNow: 0,
          offlineLinksNow: 0,
          antiSpoofAlertsNow: 0,
          realtimeSignalsLast24h: 0,
          monthlySignalsEstimate: 0,
          mauLast30: 0,
          ridesToday: 0,
          bookingsToday: 0,
          completedBookingsToday: 0,
          revenueToday: 0,
          gstToday: 0,
          totalUsersTracked90d: 0,
          totalRidesTracked90d: 0,
          totalBookingsTracked90d: 0,
          totalTransactionsTracked90d: 0,
          totalTicketsTracked90d: 0,
        },
        daily: [],
        alerts: [],
        snapshots: [],
        alertHistory: [],
        storageStatus: {
          snapshotsPersisted: false,
          alertsPersisted: false,
          notes: [
            `Capacity endpoint fell back to safe mode: ${error?.message || "unknown error"}.`,
            "This does not affect booking, payment, or negotiation logic.",
          ],
        },
      });
    }
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
