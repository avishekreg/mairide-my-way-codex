import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./supabaseRuntime";

const DRIVER_JOINING_BONUS = 500;
const TRAVELER_JOINING_BONUS = 250;
const TIER1_REWARD = 25;
const TIER2_REWARD = 5;

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey: supabaseServiceRoleKey } = getRuntimeSupabaseConfig();

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
  referralCode: string;
  referredBy?: string | null;
  referralPath?: string[];
  consents?: Record<string, any>;
}) {
  const now = new Date().toISOString();
  const joiningBonus = input.role === "driver" ? DRIVER_JOINING_BONUS : TRAVELER_JOINING_BONUS;
  const data = {
    uid: input.uid,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    status: "active",
    phoneNumber: input.phoneNumber || "",
    photoURL: "",
    onboardingComplete: false,
    referralCode: input.referralCode,
    referredBy: input.referredBy || null,
    referralPath: input.referralPath || [],
    wallet: {
      balance: joiningBonus,
      pendingBalance: 0,
    },
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
    referral_code: input.referralCode,
    referred_by: input.referredBy || null,
    referral_path: input.referralPath || [],
    force_password_change: false,
    wallet: {
      balance: joiningBonus,
      pendingBalance: 0,
    },
    location: null,
    driver_details: null,
    data,
    created_at: now,
    updated_at: now,
  };
}

async function generateUniqueReferralCode(supabaseAdmin: any) {
  while (true) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();

    if (error) throw error;
    if (!data) return code;
  }
}

export async function handleCompleteSignup(req: any, res: any) {
  const {
    email,
    password,
    displayName,
    phoneNumber,
    role,
    referralCodeInput,
    consents,
  } = req.body || {};

  if (!email || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPhone = String(phoneNumber || "").replace(/[^\d]/g, "");
    const normalizedReferralCode = String(referralCodeInput || "").trim().toUpperCase();
    const ownReferralCode = await generateUniqueReferralCode(supabaseAdmin);
    let referredBy: string | null = null;
    let referralPath: string[] = [];

    if (normalizedReferralCode) {
      const { data: referrer, error: referrerError } = await supabaseAdmin
        .from("users")
        .select("*")
        .eq("referral_code", normalizedReferralCode)
        .maybeSingle();

      if (referrerError) throw referrerError;

      if (referrer) {
        referredBy = referrer.id;
        referralPath = [referrer.id, ...(((referrer.referral_path as string[]) || []))].slice(0, 2);
      }
    }

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
      referralCode: ownReferralCode,
      referredBy,
      referralPath,
      consents,
    });

    const { error: profileError } = await supabaseAdmin.from("users").upsert(row, {
      onConflict: "id",
    });

    if (profileError) {
      return res.status(500).json({ error: profileError.message || "Failed to create user profile" });
    }

    const joiningBonus = role === "driver" ? DRIVER_JOINING_BONUS : TRAVELER_JOINING_BONUS;
    const txId = `init_${authData.user.id}`;
    const { error: transactionError } = await supabaseAdmin.from("transactions").upsert(
      {
        id: txId,
        user_id: authData.user.id,
        type: "wallet_topup",
        status: "completed",
        data: {
          id: txId,
          userId: authData.user.id,
          type: "wallet_topup",
          amount: joiningBonus,
          currency: "MAICOIN",
          status: "completed",
          description: role === "driver" ? "Driver joining bonus" : "Traveler joining bonus",
          createdAt: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (transactionError) {
      return res.status(500).json({ error: transactionError.message || "Failed to initialize wallet" });
    }

    for (let i = 0; i < referralPath.length; i++) {
      const referrerId = referralPath[i];
      const tier = i + 1;
      const rewardAmount = tier === 1 ? TIER1_REWARD : TIER2_REWARD;
      const refId = `ref${tier}_${referrerId}_${authData.user.id}`;

      const { error: referralError } = await supabaseAdmin.from("referrals").upsert(
        {
          id: refId,
          referrer_id: referrerId,
          referred_id: authData.user.id,
          status: "joined",
          data: {
            id: refId,
            referrerId,
            referredId: authData.user.id,
            tier,
            status: "joined",
            rewardAmount,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      if (referralError) {
        return res.status(500).json({ error: referralError.message || "Failed to initialize referral data" });
      }
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
