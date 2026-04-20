import crypto from "crypto";

type LatLng = { lat: number; lng: number };

const DEFAULT_NEARBY_RADIUS_KM = 25;
const MIN_NEARBY_RADIUS_KM = 10;
const MAX_NEARBY_RADIUS_KM = 25;
const FCM_TOKEN_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;

function safeString(value: unknown, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeLocation(value: any): LatLng | null {
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function getDistanceKm(a: LatLng, b: LatLng) {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function getNotificationRadiusKm(configData: Record<string, any> | null | undefined) {
  const raw =
    configData?.nearbyNotificationRadiusKm ??
    configData?.pushNotificationRadiusKm ??
    configData?.notificationRadiusKm ??
    DEFAULT_NEARBY_RADIUS_KM;
  const radius = Number(raw);
  if (!Number.isFinite(radius)) return DEFAULT_NEARBY_RADIUS_KM;
  return Math.min(MAX_NEARBY_RADIUS_KM, Math.max(MIN_NEARBY_RADIUS_KM, radius));
}

function getProfileRole(row: any) {
  return safeString(row?.role || row?.data?.role, 40).toLowerCase();
}

function isOppositeRole(actorRole: string, targetRole: string) {
  if (actorRole === "driver") return targetRole === "consumer" || targetRole === "traveler";
  if (actorRole === "consumer" || actorRole === "traveler") return targetRole === "driver";
  return false;
}

function getProfileName(row: any, fallback: string) {
  return safeString(row?.display_name || row?.data?.displayName || row?.email || fallback, 80);
}

function getProfileLocation(row: any) {
  return normalizeLocation(row?.location) || normalizeLocation(row?.data?.location);
}

function getActiveNotificationDevices(row: any) {
  const devices = row?.data?.notificationDevices;
  if (!Array.isArray(devices)) return [];
  const seen = new Set<string>();
  return devices
    .filter((device) => device?.enabled !== false && safeString(device?.token, 400))
    .filter((device) => {
      const token = safeString(device.token, 400);
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

async function getAppConfig(supabaseAdmin: any) {
  const { data } = await supabaseAdmin
    .from("app_config")
    .select("data")
    .eq("id", "global")
    .maybeSingle();
  return (data?.data as Record<string, any>) || {};
}

export async function recordUsageEvent(
  supabaseAdmin: any,
  input: {
    metricKey: string;
    value?: number;
    units?: string;
    data?: Record<string, any>;
    id?: string;
  }
) {
  const observedAt = new Date().toISOString();
  const id = input.id || `${safeString(input.metricKey, 120)}_${Date.now()}_${crypto.randomUUID()}`;
  const payload = {
    id,
    provider: "mairide",
    metric_key: safeString(input.metricKey, 120),
    value: Number.isFinite(Number(input.value)) ? Number(input.value) : 1,
    units: safeString(input.units || "event", 40),
    observed_at: observedAt,
    data: {
      ...(input.data || {}),
      observedAt,
    },
    created_at: observedAt,
    updated_at: observedAt,
  };

  const { error } = await supabaseAdmin.from("platform_usage_events").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("Usage event write failed:", error);
  }
  return payload;
}

function getFcmServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FCM_SERVICE_ACCOUNT_JSON || "";
  if (!raw.trim()) return null;
  try {
    const parsed = raw.trim().startsWith("{")
      ? JSON.parse(raw)
      : JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    if (!parsed?.client_email || !parsed?.private_key || !parsed?.project_id) return null;
    return parsed as { client_email: string; private_key: string; project_id: string };
  } catch (error) {
    console.error("Invalid Firebase service account JSON:", error);
    return null;
  }
}

function base64Url(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getFcmAccessToken(serviceAccount: { client_email: string; private_key: string }) {
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedFcmAccessToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: FCM_TOKEN_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(serviceAccount.private_key));
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.access_token) {
    throw new Error(body?.error_description || body?.error || "Unable to obtain FCM access token.");
  }
  cachedFcmAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  };
  return cachedFcmAccessToken.token;
}

async function sendFcmMessage(
  token: string,
  message: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }
) {
  const serviceAccount = getFcmServiceAccount();
  if (!serviceAccount) {
    return { ok: false, skipped: true, reason: "missing_fcm_credentials" };
  }

  const accessToken = await getFcmAccessToken(serviceAccount);
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: message.title,
            body: message.body,
          },
          data: message.data || {},
          android: {
            priority: "HIGH",
            notification: {
              channel_id: "mairide_nearby",
              sound: "default",
            },
          },
        },
      }),
    }
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, skipped: false, reason: body?.error?.message || "fcm_send_failed" };
  }
  return { ok: true, skipped: false, reason: "sent" };
}

export async function sendPushToUser(
  supabaseAdmin: any,
  targetUser: any,
  input: {
    title: string;
    body: string;
    data?: Record<string, string>;
    eventBaseId: string;
    reason: string;
  }
) {
  const devices = getActiveNotificationDevices(targetUser);
  if (!devices.length) {
    await recordUsageEvent(supabaseAdmin, {
      id: `${input.eventBaseId}_no_device`,
      metricKey: "push_notification_skipped",
      units: "notification",
      data: {
        reason: "no_active_device",
        notificationType: input.reason,
        userId: targetUser?.id,
      },
    });
    return { sent: 0, skipped: 1, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const device of devices) {
    const token = safeString(device.token, 500);
    const result = await sendFcmMessage(token, {
      title: input.title,
      body: input.body,
      data: {
        notificationType: input.reason,
        ...(input.data || {}),
      },
    }).catch((error) => ({ ok: false, skipped: false, reason: error?.message || "send_failed" }));

    const metricKey = result.ok
      ? "push_notification_sent"
      : result.skipped
        ? "push_notification_skipped"
        : "push_notification_failed";
    if (result.ok) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;

    await recordUsageEvent(supabaseAdmin, {
      id: `${input.eventBaseId}_${crypto.createHash("sha1").update(token).digest("hex").slice(0, 16)}`,
      metricKey,
      units: "notification",
      data: {
        userId: targetUser?.id,
        role: getProfileRole(targetUser),
        reason: result.reason,
        notificationType: input.reason,
        platform: safeString(device.platform, 40),
        runtime: safeString(device.runtime, 80),
      },
    });
  }

  return { sent, skipped, failed };
}

async function findNearbyOppositeUsers(
  supabaseAdmin: any,
  actor: { id: string; role: string; location: LatLng },
  radiusKm: number
) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,email,display_name,role,status,location,data")
    .neq("id", actor.id)
    .eq("status", "active")
    .limit(500);
  if (error) throw error;

  return (data || [])
    .map((row: any) => {
      const location = getProfileLocation(row);
      if (!location) return null;
      const distanceKm = getDistanceKm(actor.location, location);
      return {
        row,
        location,
        distanceKm,
        role: getProfileRole(row),
      };
    })
    .filter(Boolean)
    .filter((entry: any) => isOppositeRole(actor.role, entry.role) && entry.distanceKm <= radiusKm)
    .sort((a: any, b: any) => a.distanceKm - b.distanceKm)
    .slice(0, 25);
}

export async function notifyNearbyPresence(supabaseAdmin: any, actorProfile: any, actorLocation: LatLng | null) {
  if (!actorLocation || !actorProfile?.id) return { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const actorRole = getProfileRole(actorProfile);
  if (!actorRole || actorRole === "admin") return { considered: 0, sent: 0, skipped: 0, failed: 0 };

  const configData = await getAppConfig(supabaseAdmin).catch(() => ({}));
  const radiusKm = getNotificationRadiusKm(configData);
  const nearbyUsers = await findNearbyOppositeUsers(
    supabaseAdmin,
    { id: actorProfile.id, role: actorRole, location: actorLocation },
    radiusKm
  );
  const today = new Date().toISOString().slice(0, 10);
  const actorName = getProfileName(actorProfile, actorRole === "driver" ? "Driver" : "Traveler");
  const title = actorRole === "driver" ? "Driver nearby" : "Traveler nearby";
  const body =
    actorRole === "driver"
      ? `${actorName} is online nearby. Check if their route fits your plan.`
      : `${actorName} is looking nearby. Offer a ride if your route fits.`;

  const totals = { considered: nearbyUsers.length, sent: 0, skipped: 0, failed: 0 };
  for (const entry of nearbyUsers as any[]) {
    const result = await sendPushToUser(supabaseAdmin, entry.row, {
      title,
      body,
      reason: "nearby_presence",
      eventBaseId: `push_presence_${today}_${actorProfile.id}_${entry.row.id}`,
      data: {
        actorId: actorProfile.id,
        actorRole,
        distanceKm: String(Number(entry.distanceKm.toFixed(1))),
        radiusKm: String(radiusKm),
      },
    });
    totals.sent += result.sent;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }
  return totals;
}

export async function notifyNearbyRideRequest(supabaseAdmin: any, requestData: any, actorId: string) {
  const originLocation = normalizeLocation(requestData?.originLocation);
  if (!originLocation) return { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const configData = await getAppConfig(supabaseAdmin).catch(() => ({}));
  const radiusKm = getNotificationRadiusKm(configData);
  const nearbyUsers = await findNearbyOppositeUsers(
    supabaseAdmin,
    { id: actorId, role: "consumer", location: originLocation },
    radiusKm
  );
  const totals = { considered: nearbyUsers.length, sent: 0, skipped: 0, failed: 0 };
  for (const entry of nearbyUsers as any[]) {
    const result = await sendPushToUser(supabaseAdmin, entry.row, {
      title: "Nearby ride request",
      body: `${requestData?.consumerName || "A traveler"} needs ${requestData?.seatsNeeded || 1} seat(s): ${requestData?.origin} to ${requestData?.destination}.`,
      reason: "nearby_ride_request",
      eventBaseId: `push_ride_request_${requestData?.id}_${entry.row.id}`,
      data: {
        requestId: safeString(requestData?.id, 120),
        origin: safeString(requestData?.origin, 120),
        destination: safeString(requestData?.destination, 120),
        distanceKm: String(Number(entry.distanceKm.toFixed(1))),
        radiusKm: String(radiusKm),
      },
    });
    totals.sent += result.sent;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }
  return totals;
}

export async function notifyNearbyRideOffer(supabaseAdmin: any, rideData: any, actorId: string) {
  const originLocation = normalizeLocation(rideData?.originLocation);
  if (!originLocation) return { considered: 0, sent: 0, skipped: 0, failed: 0 };
  const configData = await getAppConfig(supabaseAdmin).catch(() => ({}));
  const radiusKm = getNotificationRadiusKm(configData);
  const nearbyUsers = await findNearbyOppositeUsers(
    supabaseAdmin,
    { id: actorId, role: "driver", location: originLocation },
    radiusKm
  );
  const totals = { considered: nearbyUsers.length, sent: 0, skipped: 0, failed: 0 };
  for (const entry of nearbyUsers as any[]) {
    const result = await sendPushToUser(supabaseAdmin, entry.row, {
      title: "Nearby ride offer",
      body: `${rideData?.driverName || "A driver"} has ${rideData?.seatsAvailable || 1} seat(s): ${rideData?.origin} to ${rideData?.destination}.`,
      reason: "nearby_ride_offer",
      eventBaseId: `push_ride_offer_${rideData?.id}_${entry.row.id}`,
      data: {
        rideId: safeString(rideData?.id, 120),
        origin: safeString(rideData?.origin, 120),
        destination: safeString(rideData?.destination, 120),
        distanceKm: String(Number(entry.distanceKm.toFixed(1))),
        radiusKm: String(radiusKm),
      },
    });
    totals.sent += result.sent;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }
  return totals;
}

export { getNotificationRadiusKm, normalizeLocation };
