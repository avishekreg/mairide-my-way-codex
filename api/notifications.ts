import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";
import {
  normalizeLocation,
  notifyNearbyPresence,
  recordUsageEvent,
} from "./_lib/notifications.js";

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

async function getAuthenticatedProfile(req: any, supabaseAdmin: any) {
  const authHeader = safeString(getHeader(req, "authorization"), 2000);
  if (!authHeader.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) {
    throw Object.assign(new Error("User profile not found."), { status: 404 });
  }

  return { user: authData.user, profile };
}

function upsertNotificationDevice(existingDevices: any[], nextDevice: any) {
  const devices = Array.isArray(existingDevices) ? existingDevices : [];
  const filtered = devices.filter((device) => {
    if (!device?.token) return false;
    if (device.token === nextDevice.token) return false;
    return true;
  });
  return [nextDevice, ...filtered].slice(0, 5);
}

async function handleRegisterDevice(req: any, res: any) {
  const supabaseAdmin = getSupabaseAdmin();
  const { profile } = await getAuthenticatedProfile(req, supabaseAdmin);
  const body = req.body || {};
  const token = safeString(body.token, 600);
  const platform = safeString(body.platform || "android", 40);
  const runtime = safeString(body.runtime || "android_app", 80);
  const appVersion = safeString(body.appVersion, 80);
  const location = normalizeLocation(body.location);

  if (!token) {
    return res.status(400).json({ error: "Push token is required." });
  }
  if (platform !== "android") {
    return res.status(400).json({ error: "Only Android push registration is supported right now." });
  }

  const now = new Date().toISOString();
  const profileData = (profile.data as Record<string, any>) || {};
  const device = {
    id: `android_${safeString(token, 64)}`,
    token,
    platform,
    runtime,
    appVersion,
    enabled: true,
    registeredAt: now,
    updatedAt: now,
    source: "capacitor_push_notifications",
    location: location ? { ...location, lastUpdated: now } : undefined,
  };
  const notificationDevices = upsertNotificationDevice(profileData.notificationDevices, device);
  const nextLocation = location ? { ...location, lastUpdated: now } : profile.location || profileData.location || null;
  const nextData = {
    ...profileData,
    notificationDevices,
    notificationSettings: {
      nearbyEnabled: true,
      rideRequestEnabled: true,
      rideOfferEnabled: true,
      ...(profileData.notificationSettings || {}),
      updatedAt: now,
    },
    ...(nextLocation ? { location: nextLocation } : {}),
    pushUpdatedAt: now,
  };

  const { error: updateError } = await supabaseAdmin
    .from("users")
    .update({
      data: nextData,
      location: nextLocation,
      updated_at: now,
    })
    .eq("id", profile.id);
  if (updateError) throw updateError;

  await recordUsageEvent(supabaseAdmin, {
    metricKey: "push_token_registered",
    units: "device",
    data: {
      userId: profile.id,
      role: profile.role || profileData.role,
      platform,
      runtime,
      appVersion,
      hasLocation: Boolean(location),
    },
  });

  let proximity = { considered: 0, sent: 0, skipped: 0, failed: 0 };
  try {
    proximity = await notifyNearbyPresence(
      supabaseAdmin,
      {
        ...profile,
        data: nextData,
        location: nextLocation,
      },
      location
    );
  } catch (error) {
    console.error("Nearby presence push failed:", error);
  }

  return res.status(200).json({
    ok: true,
    deviceCount: notificationDevices.length,
    proximity,
  });
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }

  try {
    const action = getAction(req);
    if (action === "register-device") {
      if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
      return handleRegisterDevice(req, res);
    }
    return res.status(404).json({ error: "Notification route not found" });
  } catch (error: any) {
    console.error("Notification route failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "Notification route failed",
    });
  }
}
