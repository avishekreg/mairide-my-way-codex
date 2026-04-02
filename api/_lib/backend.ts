import axios from "axios";
import { createClient } from "@supabase/supabase-js";

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

function getSupabaseAdmin(): any {
  if (supabaseAdmin) return supabaseAdmin;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function findAuthUser(uid: string, email?: string | null) {
  const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) throw error;

  const users = data?.users || [];
  return (
    users.find((user) => user.id === uid) ||
    (email ? users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) : null) ||
    null
  );
}

function buildUserRow(input: {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: string;
  adminRole?: string;
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

export async function handleAdminCreateUser(req: ReqLike, res: ResLike) {
  const { email, password, displayName, phoneNumber, role, adminRole } = req.body || {};

  if (!email || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { data: authData, error: authError } = await getSupabaseAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      phone: phoneNumber || undefined,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (authError || !authData.user) {
      throw authError || new Error("Failed to create auth user");
    }

    const row = buildUserRow({
      uid: authData.user.id,
      email,
      displayName,
      phoneNumber,
      role,
      adminRole,
      forcePasswordChange: true,
    });

    const { error: profileError } = await getSupabaseAdmin().from("users").upsert(row, {
      onConflict: "id",
    });

    if (profileError) throw profileError;

    res.status(201).json({
      message: "User created successfully",
      uid: authData.user.id,
    });
  } catch (error: any) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: error.message || "Failed to create user" });
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

    const cleanupDeletes = [
      supabaseAdmin.from("support_tickets").delete().or(`user_id.eq.${uid},data->>userId.eq.${uid}`),
      supabaseAdmin.from("transactions").delete().or(`user_id.eq.${uid},data->>userId.eq.${uid}`),
      supabaseAdmin.from("referrals").delete().or(`referrer_id.eq.${uid},referred_id.eq.${uid},data->>referrerId.eq.${uid},data->>referredId.eq.${uid}`),
      supabaseAdmin.from("bookings").delete().or(`consumer_id.eq.${uid},driver_id.eq.${uid},data->>consumerId.eq.${uid},data->>driverId.eq.${uid}`),
      supabaseAdmin.from("rides").delete().or(`driver_id.eq.${uid},data->>driverId.eq.${uid}`),
      supabaseAdmin.from("users").delete().eq("id", uid),
    ];

    const cleanupResults = await Promise.all(cleanupDeletes);
    const failedCleanup = cleanupResults.find((result) => result.error);
    if (failedCleanup?.error) {
      throw failedCleanup.error;
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
