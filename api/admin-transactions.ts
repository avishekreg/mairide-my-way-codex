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

async function requireAdmin(req: any) {
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

  if (!profile || profile.role !== "admin" || !effectiveRole) {
    return { error: { status: 403, message: "Forbidden: Admin access required" } };
  }

  return { supabaseAdmin, user: authData.user, profile };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await requireAdmin(req);
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
  } catch (error: any) {
    console.error("Standalone admin transactions failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
