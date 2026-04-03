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

function getAuthHeader(req: any) {
  return Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
}

async function requireSuperAdmin(req: any) {
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
  const effectiveRole =
    profile?.admin_role ||
    profile?.data?.adminRole ||
    (authData.user.email && configuredSuperAdmin && authData.user.email.toLowerCase() === configuredSuperAdmin
      ? "super_admin"
      : null);

  if (!profile || profile.role !== "admin" || effectiveRole !== "super_admin") {
    return { error: { status: 403, message: "Forbidden: Super Admin access required" } };
  }

  return { supabaseAdmin, user: authData.user, profile };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await requireSuperAdmin(req);
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
      verificationStatus: normalizedStatus,
      rejectionReason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
      verifiedBy: auth.user.id,
      status: normalizedStatus === "approved" ? "active" : "inactive",
    };

    const { error } = await auth.supabaseAdmin
      .from("users")
      .update({
        verification_status: normalizedStatus,
        rejection_reason: normalizedStatus === "rejected" ? (rejectionReason || "") : null,
        verified_by: auth.user.id,
        status: normalizedStatus === "approved" ? "active" : "inactive",
        data: nextData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", uid);

    if (error) throw error;

    return res.status(200).json({ message: `Driver ${normalizedStatus} successfully.` });
  } catch (error: any) {
    console.error("Standalone verify driver failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
