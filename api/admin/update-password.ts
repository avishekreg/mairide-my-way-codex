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

async function findAuthUser(supabaseAdmin: any, uid: string, email?: string | null) {
  const directLookup = await supabaseAdmin.auth.admin.getUserById(uid);
  if (directLookup.data?.user) return directLookup.data.user;

  if (!email) return null;

  let page = 1;
  while (page <= 5) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });

    if (error) throw error;

    const users = data?.users || [];
    const matched = users.find((user: any) => user.email?.toLowerCase() === email.toLowerCase());
    if (matched) return matched;

    if (users.length < 1000) break;
    page += 1;
  }

  return null;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authContext = await requireSuperAdmin(req, res);
  if (!authContext) return;

  const { uid, newPassword } = req.body || {};

  if (!uid || !newPassword) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const { supabaseAdmin } = authContext;
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    if (profileError) throw profileError;

    const authUser = await findAuthUser(supabaseAdmin, uid, profile?.email);
    if (!authUser) {
      return res.status(404).json({
        error: "No matching authentication account was found for this user. Ask the user to sign up once with their email, then retry the reset.",
      });
    }

    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password: newPassword,
    });
    if (authUpdateError) throw authUpdateError;

    if (profile) {
      const mergedData = {
        ...(profile.data || {}),
        forcePasswordChange: true,
      };

      const { error: updateError } = await supabaseAdmin
        .from("users")
        .update({
          force_password_change: true,
          data: mergedData,
        })
        .eq("id", uid);

      if (updateError) throw updateError;
    }

    return res.status(200).json({ message: "Password updated successfully" });
  } catch (error: any) {
    console.error("Error updating password:", error);
    return res.status(500).json({ error: error.message || "Failed to update password" });
  }
}
