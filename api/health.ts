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
  try {
    const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
    if (action === "app-version") {
      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin
        .from("app_config")
        .select("data")
        .eq("id", "global")
        .maybeSingle();
      if (error) throw error;
      const configuredVersion = String((data?.data as Record<string, any> | undefined)?.appVersion || "").trim();
      const fallbackVersion = String(process.env.VITE_APP_VERSION || "v2.0.1-beta").trim();
      return res.status(200).json({
        appVersion: configuredVersion || fallbackVersion,
      });
    }

    if (action === "resolve-phone-login") {
      const phoneNumber = req.body?.phoneNumber || req.query?.phoneNumber;
      const variants = buildPhoneVariants(phoneNumber);
      if (!variants.length) {
        return res.status(400).json({ error: "Missing or invalid phone number" });
      }

      const supabaseAdmin = getSupabaseAdmin();
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
      return res.status(200).json({ status: "ok", backend: "supabase" });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const [{ data: rideRows, error: ridesError }, { data: driverRows, error: driversError }] =
      await Promise.all([
        supabaseAdmin
          .from("rides")
          .select("*")
          .eq("status", "available")
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("users")
          .select("*")
          .eq("role", "driver"),
      ]);

    if (ridesError) throw ridesError;
    if (driversError) throw driversError;

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

    return res.status(200).json({ rides, bookings: [] });
  } catch (error: any) {
    console.error("Standalone health/search failed:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
