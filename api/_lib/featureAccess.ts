import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./supabaseRuntime.js";

export type FeatureRequester = {
  uid?: string;
  id?: string;
  email?: string;
  displayName?: string;
  role?: string;
};

export const STRICT_SANDBOX_EMAILS = ["ad@optonpay.com", "ad@optoninfocom.com"];

export function getSupabaseAdminClient() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error("Missing Supabase admin environment variables."), { status: 500 });
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function getGlobalAppConfig() {
  const { data, error } = await getSupabaseAdminClient()
    .from("app_config")
    .select("data")
    .eq("id", "global")
    .maybeSingle();

  if (error) throw error;
  return (data?.data as Record<string, any> | undefined) || {};
}

export function listConfigValues(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isSandboxRequester(requester: FeatureRequester | null | undefined, config: Record<string, any>) {
  if (!requester) return false;
  const email = String(requester.email || "").trim().toLowerCase();
  return Boolean(email && STRICT_SANDBOX_EMAILS.includes(email));
}

export function canUseControlledFeature(
  featureEnabled: unknown,
  requester: FeatureRequester | null | undefined,
  config: Record<string, any>
) {
  return Boolean(featureEnabled) || isSandboxRequester(requester, config);
}
