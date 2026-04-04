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

export default async function handler(req: any, res: any) {
  try {
    const action = Array.isArray(req.query?.action) ? req.query.action[0] : req.query?.action;
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
