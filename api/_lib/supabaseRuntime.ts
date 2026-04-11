type ReqLike = {
  headers?: Record<string, string | string[] | undefined>;
};

const PROD_SUPABASE_URL = "https://jcgoccsdlrjnratpaeje.supabase.co";
const PROD_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5NTkwMTQsImV4cCI6MjA5MDUzNTAxNH0.iPIawKCThu7lYMoGrWAyRDVvQPf5YICP7Ap_XOwAOrw";
const PROD_SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjZ29jY3NkbHJqbnJhdHBhZWplIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk1OTAxNCwiZXhwIjoyMDkwNTM1MDE0fQ.Ixfciz-8l1wIk6qs70mv2DQ1J_zOfZI4-lcbqy0fP6s";

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
  // Hard lock server runtime to main production Supabase for all environments.
  // Staging project has been retired.
  return {
    supabaseUrl: PROD_SUPABASE_URL,
    anonKey: PROD_SUPABASE_ANON_KEY,
    serviceRoleKey: PROD_SUPABASE_SERVICE_ROLE_KEY,
  };
}
