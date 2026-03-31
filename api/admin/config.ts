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

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authContext = await requireSuperAdmin(req, res);
  if (!authContext) return;

  try {
    const { data, error } = await authContext.supabaseAdmin
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

    return res.status(200).json({ config });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Failed to fetch configuration" });
  }
}
