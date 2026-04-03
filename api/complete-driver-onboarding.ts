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

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = Array.isArray(req.headers?.authorization)
      ? req.headers.authorization[0]
      : req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessToken = authHeader.slice("Bearer ".length);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { driverId, driverDetails } = req.body || {};
    if (!driverId || !driverDetails) {
      return res.status(400).json({ error: "Missing driverId or driverDetails" });
    }

    if (authData.user.id !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", driverId)
      .maybeSingle();

    if (existingUserError) throw existingUserError;
    if (!existingUser) {
      return res.status(404).json({ error: "Driver profile not found" });
    }

    const nextData = {
      ...((existingUser.data as Record<string, any>) || {}),
      uid: driverId,
      role: "driver",
      onboardingComplete: true,
      verificationStatus: "pending",
      rejectionReason: null,
      verifiedBy: null,
      driverDetails,
    };

    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        role: "driver",
        onboarding_complete: true,
        verification_status: "pending",
        rejection_reason: null,
        verified_by: null,
        driver_details: driverDetails,
        data: nextData,
        updated_at: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (updateError) throw updateError;

    return res.status(200).json({ message: "Driver onboarding submitted successfully." });
  } catch (error: any) {
    console.error("Standalone complete driver onboarding failed:", error);
    return res.status(500).json({ error: error?.message || "Failed to complete driver onboarding" });
  }
}
