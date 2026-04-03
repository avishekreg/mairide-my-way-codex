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

async function requireSuperAdmin(req: any, res: any) {
  const authHeader = Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const configuredSuperAdmin = String(process.env.VITE_SUPER_ADMIN_EMAIL || "").toLowerCase();
  const effectiveRole =
    profile?.admin_role ||
    profile?.data?.adminRole ||
    (authData.user.email && configuredSuperAdmin && authData.user.email.toLowerCase() === configuredSuperAdmin
      ? "super_admin"
      : null);

  if (!profile || profile.role !== "admin" || effectiveRole !== "super_admin") {
    res.status(403).json({ error: "Forbidden: Super Admin access required" });
    return null;
  }

  return { user: authData.user, profile };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await requireSuperAdmin(req, res);
    if (!auth) return;

    const payload = req.body || {};
    const now = new Date().toISOString();
    const updatedBy =
      auth.user?.email ||
      auth.profile?.email ||
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

    return res.status(200).json({
      message: "Configuration saved successfully",
      config: {
        id: "global",
        ...configData,
      },
    });
  } catch (error: any) {
    console.error("Standalone admin save config failed:", error);
    return res.status(500).json({ error: error?.message || "Failed to save configuration" });
  }
}
