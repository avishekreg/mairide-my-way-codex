import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase env vars are incomplete. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function buildSignupRow(input: {
  uid: string;
  email: string;
  displayName: string;
  phoneNumber?: string;
  role: string;
  consents?: Record<string, any>;
}) {
  const now = new Date().toISOString();
  const data = {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    status: "active",
    phoneNumber: input.phoneNumber || "",
    photoURL: "",
    onboardingComplete: false,
    createdAt: now,
    ...(input.consents ? { consents: input.consents } : {}),
  };

  return {
    id: input.uid,
    email: input.email,
    display_name: input.displayName,
    role: input.role,
    status: "active",
    phone_number: input.phoneNumber || null,
    photo_url: null,
    onboarding_complete: false,
    admin_role: null,
    verification_status: null,
    rejection_reason: null,
    verified_by: null,
    referral_code: null,
    referred_by: null,
    referral_path: [],
    force_password_change: false,
    wallet: null,
    location: null,
    driver_details: null,
    data,
    created_at: now,
    updated_at: now,
  };
}

export async function handleCompleteSignup(req: any, res: any) {
  const {
    email,
    password,
    displayName,
    phoneNumber,
    role,
    consents,
  } = req.body || {};

  if (!email || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phoneNumber || "").replace(/[^\d]/g, "");

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      phone: normalizedPhone || undefined,
      user_metadata: {
        display_name: displayName,
      },
    });

    if (authError || !authData.user) {
      const message = authError?.message || "Failed to create auth user";
      const status = /already been registered|already registered|already exists/i.test(message) ? 409 : 500;
      return res.status(status).json({ error: message });
    }

    const row = buildSignupRow({
      uid: authData.user.id,
      email: normalizedEmail,
      displayName,
      phoneNumber: normalizedPhone,
      role,
      consents,
    });

    const { error: profileError } = await supabaseAdmin.from("users").upsert(row, {
      onConflict: "id",
    });

    if (profileError) {
      return res.status(500).json({ error: profileError.message || "Failed to create user profile" });
    }

    return res.status(201).json({
      message: "Signup completed successfully",
      uid: authData.user.id,
      email: normalizedEmail,
    });
  } catch (error: any) {
    console.error("Complete signup error:", error);
    return res.status(500).json({ error: error.message || "Failed to complete signup" });
  }
}

export default async function handler(req: any, res: any) {
  return handleCompleteSignup(req, res);
}
