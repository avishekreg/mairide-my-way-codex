import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

function applyCorsHeaders(req: any, res: any) {
  const requestOrigin = String(req?.headers?.origin || "").trim();
  const allowOrigin = requestOrigin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function getSupabaseAdmin(req?: any) {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig(req);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getSupabasePublic(req?: any) {
  const { supabaseUrl, anonKey } = getRuntimeSupabaseConfig(req);
  if (!supabaseUrl || !anonKey) return null;
  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export default async function handler(req: any, res: any) {
  applyCorsHeaders(req, res);

  if (String(req?.method || "").toUpperCase() === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    let configuredVersion = "";
    try {
      const supabaseAdmin = getSupabaseAdmin(req);
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("data")
        .eq("id", "global")
        .maybeSingle();
      if (error) throw error;
      configuredVersion = String((data?.data as Record<string, any> | undefined)?.appVersion || "").trim();
    } catch {
      const supabasePublic = getSupabasePublic(req);
      if (supabasePublic) {
        const { data } = await supabasePublic
          .from("app_config")
          .select("data")
          .eq("id", "global")
          .maybeSingle();
        configuredVersion = String((data?.data as Record<string, any> | undefined)?.appVersion || "").trim();
      }
    }

    const fallbackVersion = String(process.env.VITE_APP_VERSION || "v2.0.1-beta").trim();
    const commitSha = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
    const commitRef = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();
    const commitMessage = String(process.env.VERCEL_GIT_COMMIT_MESSAGE || "").trim();
    const deployId = String(process.env.VERCEL_DEPLOYMENT_ID || "").trim();
    const env = String(process.env.VERCEL_ENV || process.env.NODE_ENV || "").trim();
    const vercelUrl = String(process.env.VERCEL_URL || "").trim();
    const builtAt = new Date().toISOString();

    return res.status(200).json({
      appVersion: configuredVersion || fallbackVersion,
      commitSha,
      commitRef,
      commitMessage,
      deployId,
      env,
      vercelUrl,
      builtAt,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: error?.message || "Failed to load build stamp",
    });
  }
}
