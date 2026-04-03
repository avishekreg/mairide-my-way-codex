import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    .select("*")
    .order("created_at", { ascending: false });

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

  return res.status(200).json({ transactions });
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

  const row = {
    id: authCreateData.user.id,
    email: normalizedEmail,
    display_name: displayName,
    role,
    status: "active",
    phone_number: normalizedPhone || null,
    onboarding_complete: role !== "driver",
    admin_role: role === "admin" ? adminRole || "support" : null,
    force_password_change: true,
    data: {
      uid: authCreateData.user.id,
      email: normalizedEmail,
      displayName,
      role,
      status: "active",
      phoneNumber: normalizedPhone || "",
      onboardingComplete: role !== "driver",
      adminRole: role === "admin" ? adminRole || "support" : undefined,
      forcePasswordChange: true,
      wallet: { balance: 25, pendingBalance: 0 },
    },
  };

  const { error: profileError } = await auth.supabaseAdmin.from("users").upsert(row, {
    onConflict: "id",
  });

  if (profileError) throw profileError;

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

export default async function handler(req: any, res: any) {
  try {
    const action = getAction(req);

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
      default:
        return res.status(404).json({ error: "Admin action not found" });
    }
  } catch (error: any) {
    console.error("Standalone admin API failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
