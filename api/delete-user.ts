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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = Array.isArray(req.headers?.authorization)
      ? req.headers.authorization[0]
      : req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessToken = authHeader.slice("Bearer ".length);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return res.status(401).json({ error: "Unauthorized" });
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
      return res.status(403).json({ error: "Forbidden: Super Admin access required" });
    }

    const { uid } = req.body || {};
    if (!uid) {
      return res.status(400).json({ error: "Missing uid" });
    }

    if (authData.user.id === uid) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }

    await supabaseAdmin.from("bookings").delete().or(`consumer_id.eq.${uid},driver_id.eq.${uid}`);
    await supabaseAdmin.from("rides").delete().eq("driver_id", uid);
    await supabaseAdmin.from("transactions").delete().eq("user_id", uid);
    await supabaseAdmin.from("referrals").delete().or(`referrer_id.eq.${uid},referred_id.eq.${uid}`);
    await supabaseAdmin.from("support_tickets").delete().eq("user_id", uid);
    await supabaseAdmin.from("users").delete().eq("id", uid);
    await supabaseAdmin.auth.admin.deleteUser(uid);

    return res.status(200).json({ message: "User deleted successfully." });
  } catch (error: any) {
    console.error("Standalone delete user failed:", error);
    return res.status(500).json({ error: error?.message || "Failed to delete user" });
  }
}
