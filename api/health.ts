import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

const CONFIG_LOOKUP_TIMEOUT_MS = 2500;

function applyCorsHeaders(req: any, res: any) {
  const requestOrigin = String(req?.headers?.origin || "").trim();
  const allowOrigin = requestOrigin || "*";
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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

function getFallbackAppVersion() {
  return String(process.env.VITE_APP_VERSION || "v2.0.1-beta").trim();
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, ms = CONFIG_LOOKUP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isApprovedDriver(row: any) {
  const data = (row?.data as Record<string, any>) || {};
  const role = row?.role || data.role;
  const status = row?.status || data.status;
  const onboardingComplete = row?.onboarding_complete ?? data.onboardingComplete;
  const verificationStatus = row?.verification_status || data.verificationStatus;
  const hasDriverDetails = Boolean(row?.driver_details || data.driverDetails);

  return (
    role === "driver" &&
    status === "active" &&
    onboardingComplete === true &&
    hasDriverDetails &&
    verificationStatus !== "rejected"
  );
}

function normalizePhone(phoneNumber: unknown) {
  return String(phoneNumber || "").replace(/[^\d]/g, "");
}

function buildPhoneVariants(phoneNumber: unknown) {
  const digits = normalizePhone(phoneNumber);
  const variants = new Set<string>();

  if (!digits) return [];

  variants.add(digits);
  variants.add(`+${digits}`);

  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    variants.add(last10);
    variants.add(`+${last10}`);
  }

  return Array.from(variants);
}

export default async function handler(req: any, res: any) {
  applyCorsHeaders(req, res);

  if (String(req?.method || "").toUpperCase() === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    let action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
    if (!action && req?.url) {
      try {
        const parsed = new URL(req.url, "http://localhost");
        action = parsed.searchParams.get("action") || "";
        if (!action && parsed.pathname.endsWith("/build-stamp")) action = "build-stamp";
        if (!action && parsed.pathname.endsWith("/app-version")) action = "app-version";
        if (!action && parsed.pathname.endsWith("/ping")) action = "ping";
      } catch {
        // ignore parse errors
      }
    }
    const resolveConfiguredVersion = async () => {
      const fallbackVersion = getFallbackAppVersion();
      return withTimeout((async () => {
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
        return configuredVersion || fallbackVersion;
      })(), fallbackVersion);
    };

    const buildStampPayload = async () => ({
      appVersion: await resolveConfiguredVersion(),
      commitSha: String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim(),
      commitRef: String(process.env.VERCEL_GIT_COMMIT_REF || "").trim(),
      commitMessage: String(process.env.VERCEL_GIT_COMMIT_MESSAGE || "").trim(),
      deployId: String(process.env.VERCEL_DEPLOYMENT_ID || "").trim(),
      env: String(process.env.VERCEL_ENV || process.env.NODE_ENV || "").trim(),
      vercelUrl: String(process.env.VERCEL_URL || "").trim(),
      builtAt: new Date().toISOString(),
    });
    if (action === "app-version") {
      const appVersion = await resolveConfiguredVersion();
      return res.status(200).json({ appVersion });
    }

    if (action === "build-stamp") {
      return res.status(200).json(await buildStampPayload());
    }

    if (action === "ping") {
      return res.status(200).json({
        status: "ok",
        serverTime: new Date().toISOString(),
        ...(await buildStampPayload()),
      });
    }

    if (action === "resolve-phone-login") {
      const phoneNumber = req.body?.phoneNumber || req.query?.phoneNumber;
      const variants = buildPhoneVariants(phoneNumber);
      if (!variants.length) {
        return res.status(400).json({ error: "Missing or invalid phone number" });
      }

      const supabaseAdmin = getSupabaseAdmin(req);
      const { data: userRows, error: usersError } = await supabaseAdmin
        .from("users")
        .select("*");

      if (usersError) throw usersError;

      const normalizedVariants = new Set(variants.map((value) => normalizePhone(value)));
      const matchedUser = (userRows || []).find((row: any) => {
        const data = (row?.data as Record<string, any>) || {};
        const storedDigits = normalizePhone(row?.phone_number || data.phoneNumber || "");
        if (!storedDigits) return false;
        const tail = storedDigits.slice(-10);
        return (
          normalizedVariants.has(storedDigits) ||
          normalizedVariants.has(tail) ||
          Array.from(normalizedVariants).some((candidate) => storedDigits.endsWith(candidate) || candidate.endsWith(storedDigits))
        );
      });

      if (!matchedUser) {
        return res.status(404).json({ error: "NOT_REGISTERED" });
      }

      const data = (matchedUser.data as Record<string, any>) || {};
      return res.status(200).json({
        uid: matchedUser.id,
        role: matchedUser.role || data.role || "consumer",
        email: matchedUser.email || "",
        phoneNumber: matchedUser.phone_number || data.phoneNumber || "",
      });
    }

    if (action !== "search-rides") {
      return res.status(200).json({ status: "ok", backend: "supabase", ...(await buildStampPayload()) });
    }

    const supabaseAdmin = getSupabaseAdmin(req);
    const [
      { data: rideRows, error: ridesError },
      { data: driverRows, error: driversError },
      { data: bookingRows, error: bookingsError },
    ] = await Promise.all([
      supabaseAdmin
        .from("rides")
        .select("*")
        .eq("status", "available")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("users")
        .select("*")
        .eq("role", "driver"),
      supabaseAdmin
        .from("bookings")
        .select("*")
        .eq("status", "confirmed"),
    ]);

    if (ridesError) throw ridesError;
    if (driversError) throw driversError;
    if (bookingsError) throw bookingsError;

    const approvedDriverIds = new Set((driverRows || []).filter(isApprovedDriver).map((row: any) => row.id));

    const rides = (rideRows || [])
      .filter((row: any) => {
        const data = (row.data as Record<string, any>) || {};
        return approvedDriverIds.has(row.driver_id || data.driverId);
      })
      .map((row: any) => {
        const data = (row.data as Record<string, any>) || {};
        return {
          ...data,
          id: row.id,
          driverId: row.driver_id || data.driverId,
          status: row.status || data.status || "available",
          createdAt: row.created_at || data.createdAt || null,
          updatedAt: row.updated_at || data.updatedAt || null,
        };
      });

    const bookings = (bookingRows || []).map((row: any) => {
      const data = (row.data as Record<string, any>) || {};
      return {
        id: row.id,
        rideId: row.ride_id || data.rideId || null,
        status: row.status || data.status || null,
        rideLifecycleStatus: data.rideLifecycleStatus || null,
      };
    });

    return res.status(200).json({ rides, bookings });
  } catch (error: any) {
    console.error("Standalone health/search failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
