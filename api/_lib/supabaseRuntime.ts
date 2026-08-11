type ReqLike = {
  headers?: Record<string, string | string[] | undefined>;
};

function normalizeHost(req?: ReqLike) {
  const raw = req?.headers?.host;
  if (Array.isArray(raw)) return String(raw[0] || "").toLowerCase();
  return String(raw || "").toLowerCase();
}

function isProductionRuntime(req?: ReqLike) {
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") return true;

  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "production") return true;

  const host = normalizeHost(req);
  if (host.includes("mairide.in") || host.includes("vercel.app")) return true;

  return false;
}

export function getRuntimeSupabaseConfig(req?: ReqLike) {
  void isProductionRuntime(req);
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  };
}
