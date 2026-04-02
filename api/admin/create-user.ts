import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requireSuperAdmin(req: any, res: any) {
  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    const token = String(authHeader).slice("Bearer ".length);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData.user) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }

    const superAdminEmail = (process.env.VITE_SUPER_ADMIN_EMAIL || "").toLowerCase();
    const effectiveAdminRole =
      profile.admin_role ||
      profile.data?.adminRole ||
      (authData.user.email?.toLowerCase() === superAdminEmail ? "super_admin" : null);

    if (profile.role !== "admin" || effectiveAdminRole !== "super_admin") {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }

    return { user: authData.user, profile, supabaseAdmin };
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to validate admin access" });
    return null;
  }
}

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

async function authEmailExists(supabaseAdmin: any, email: string) {
  let page = 1;
  while (page <= 5) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const users = data?.users || [];
    if (users.some((user: any) => user.email?.toLowerCase() === email)) {
      return true;
    }

    if (users.length < 1000) break;
    page += 1;
  }

  return false;
}

function buildUserRow(input: {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: string;
  adminRole?: string;
}) {
  const walletBalance = input.role === "driver" ? 500 : input.role === "consumer" ? 250 : 25;

  return {
    id: input.uid,
    email: input.email,
    display_name: input.displayName,
    role: input.role,
    status: "active",
    phone_number: input.phoneNumber || null,
    onboarding_complete: input.role !== "driver",
    admin_role: input.role === "admin" ? input.adminRole || "support" : null,
    force_password_change: true,
    data: {
      uid: input.uid,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      status: "active",
      phoneNumber: input.phoneNumber || "",
      onboardingComplete: input.role !== "driver",
      adminRole: input.role === "admin" ? input.adminRole || "support" : undefined,
      forcePasswordChange: true,
      wallet: {
        balance: walletBalance,
        pendingBalance: 0,
      },
    },
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authContext = await requireSuperAdmin(req, res);
  if (!authContext) return;

  const { email, password, displayName, phoneNumber, role, adminRole } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = String(phoneNumber || "").replace(/[^\d+]/g, "");

  if (!normalizedEmail || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { supabaseAdmin } = authContext;

    const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingProfileError) throw existingProfileError;
    if (existingProfile || (await authEmailExists(supabaseAdmin, normalizedEmail))) {
      return res.status(409).json({ error: "A user with this email already exists." });
    }

    const { data: authUserData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (authError || !authUserData.user) {
      throw authError || new Error("Failed to create auth user");
    }

    const row = buildUserRow({
      uid: authUserData.user.id,
      email: normalizedEmail,
      displayName,
      phoneNumber: normalizedPhone,
      role,
      adminRole,
    });

    const { error: profileError } = await supabaseAdmin.from("users").upsert(row, {
      onConflict: "id",
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserData.user.id).catch(() => null);
      throw profileError;
    }

    return res.status(201).json({
      message: "User created successfully",
      uid: authUserData.user.id,
    });
  } catch (error: any) {
    console.error("Error creating user:", error);
    const message = extractErrorMessage(error, "Failed to create user");
    const statusCode = error?.status || (message.toLowerCase().includes("already") ? 409 : 500);
    return res.status(statusCode).json({ error: message });
  }
}
