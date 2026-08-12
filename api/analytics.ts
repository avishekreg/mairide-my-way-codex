import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

const ANDROID_APK_URL =
  process.env.MAIRIDE_ANDROID_APK_URL || "https://downloads.mairide.in/mairide-android.apk";

const ALLOWED_METRICS = new Set([
  "app_opened",
  "user_logged_in",
  "android_apk_download_started",
  "android_app_update_started",
  "traveler_signup_completed",
  "driver_signup_completed",
  "ride_requested",
  "ride_offered",
  "match_created",
  "booking_confirmed",
  "payment_started",
  "payment_completed",
]);

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  try {
    const url = req.url ? new URL(req.url, "http://localhost") : null;
    return url?.searchParams.get("action") || "";
  } catch {
    return "";
  }
}

function getHeader(req: any, name: string) {
  const value = req.headers?.[name.toLowerCase()] ?? req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function safeString(value: unknown, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function getRequestContext(req: any) {
  return {
    userAgent: safeString(getHeader(req, "user-agent"), 360),
    referer: safeString(getHeader(req, "referer"), 360),
    country: safeString(getHeader(req, "x-vercel-ip-country") || getHeader(req, "cf-ipcountry"), 12),
    region: safeString(getHeader(req, "x-vercel-ip-country-region"), 80),
    city: safeString(getHeader(req, "x-vercel-ip-city"), 120),
    host: safeString(getHeader(req, "host"), 160),
  };
}

async function resolveAuthContext(req: any, supabaseAdmin: any) {
  const authHeader = safeString(getHeader(req, "authorization"), 2000);
  if (!authHeader.startsWith("Bearer ")) return {};

  const accessToken = authHeader.slice("Bearer ".length);
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data?.user) return {};

  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("id,email,role,status")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    userId: data.user.id,
    role: profile?.role || data.user.user_metadata?.role || null,
    status: profile?.status || null,
  };
}

async function recordUsageEvent(req: any, input: { metricKey: string; value?: number; units?: string; data?: any }) {
  const metricKey = safeString(input.metricKey, 120);
  if (!ALLOWED_METRICS.has(metricKey)) {
    throw Object.assign(new Error("Unsupported analytics metric."), { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const authContext = await resolveAuthContext(req, supabaseAdmin).catch(() => ({}));
  const observedAt = new Date().toISOString();
  const value = Number.isFinite(Number(input.value)) ? Number(input.value) : 1;

  const payload = {
    id: `${metricKey}_${Date.now()}_${randomUUID()}`,
    provider: "mairide",
    metric_key: metricKey,
    value,
    units: safeString(input.units || "event", 40),
    observed_at: observedAt,
    data: {
      ...getRequestContext(req),
      ...(input.data && typeof input.data === "object" ? input.data : {}),
      ...authContext,
      observedAt,
    },
    created_at: observedAt,
    updated_at: observedAt,
  };

  const { error } = await supabaseAdmin.from("platform_usage_events").insert(payload);
  if (error) throw error;
  return payload;
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  try {
    if (action === "android-download") {
      await recordUsageEvent(req, {
        metricKey: "android_apk_download_started",
        units: "download",
        data: { source: "download_redirect" },
      }).catch((error) => {
        console.error("Android download analytics failed:", error);
      });

      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Location", ANDROID_APK_URL);
      return res.status(302).end();
    }

    if (action === "event") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      const body = req.body || {};
      const event = await recordUsageEvent(req, {
        metricKey: body.metricKey,
        value: body.value,
        units: body.units,
        data: body.data,
      });
      return res.status(202).json({ ok: true, id: event.id });
    }

    return res.status(404).json({ error: "Analytics route not found" });
  } catch (error: any) {
    console.error("Analytics route failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "Analytics route failed",
    });
  }
}
