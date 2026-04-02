import { createClient } from "@supabase/supabase-js";

const DRIVER_JOINING_BONUS = 500;
const TRAVELER_JOINING_BONUS = 250;
const TIER1_REWARD = 25;
const TIER2_REWARD = 5;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase env vars are incomplete. Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
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

function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

function normalizeOtpValue(value: unknown) {
  return String(value || "").trim();
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const rawText = await response.text();
  let payload: any = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(typeof payload === "string" ? payload : payload?.Details || `Request failed with status ${response.status}`),
      { payload, status: response.status }
    );
  }

  return payload;
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
    const { data, error } = await supabaseAdmin.from("users").select("id").eq("referral_code", code).maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
}

async function handleSendOtp(req: any, res: any) {
  const { phoneNumber } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedPhone = normalizePhone(phoneNumber);

  if (!normalizedPhone) {
    return res.status(400).json({ Status: "Error", Details: "A valid phone number is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock SMS OTP sent to ${normalizedPhone}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_sms_session_id" });
  }

  try {
    const data = await fetchJson(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(normalizedPhone)}/AUTOGEN2`);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor SMS OTP Error:", error?.payload || error?.message || error);
    return res.status(error?.status || 500).json(error?.payload || { Status: "Error", Details: error?.message || "Failed to send OTP" });
  }
}

async function handleSendEmailOtp(req: any, res: any) {
  const { email } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return res.status(400).json({ Status: "Error", Details: "A valid email address is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock Email OTP sent to ${normalizedEmail}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_email_session_id" });
  }

  try {
    const data = await fetchJson(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/EMAIL/${encodeURIComponent(normalizedEmail)}/AUTOGEN`);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor Email OTP Error:", error?.payload || error?.message || error);
    const payload = error?.payload;
    const htmlLikePayload =
      typeof payload === "string" &&
      /<!doctype|<html|page not found/i.test(payload);

    if (htmlLikePayload || error?.status === 404) {
      return res.status(200).json({
        Status: "Error",
        Code: "EMAIL_OTP_UNAVAILABLE",
        Details: "Email OTP is unavailable right now. Please continue with phone OTP.",
      });
    }

    return res.status(error?.status || 500).json(error?.payload || { Status: "Error", Details: error?.message || "Failed to send Email OTP" });
  }
}

async function handleVerifyOtp(req: any, res: any) {
  const { sessionId, otp } = req.body || {};
  const apiKey = process.env.TWO_FACTOR_API_KEY;
  const normalizedSessionId = normalizeOtpValue(sessionId);
  const normalizedOtp = normalizeOtpValue(otp);

  if (!normalizedSessionId || !normalizedOtp) {
    return res.status(400).json({ Status: "Error", Details: "Session ID and OTP are required." });
  }

  if (!apiKey || normalizedSessionId.startsWith("mock_")) {
    if (normalizedOtp === "123456") {
      return res.status(200).json({ Status: "Success", Details: "OTP Matched" });
    }
    return res.status(400).json({ Status: "Error", Details: "Invalid OTP" });
  }

  try {
    const data = await fetchJson(`https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedOtp)}`);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor OTP Verify Error:", error?.payload || error?.message || error);
    return res.status(error?.status || 500).json(error?.payload || { Status: "Error", Details: error?.message || "Failed to verify OTP" });
  }
}

export async function handleResolvePhoneLogin(req: any, res: any) {
  const { phoneNumber } = req.body || {};
  const supabaseAdmin = getSupabaseAdmin();
  const variants = buildPhoneVariants(phoneNumber);

  if (!variants.length) {
    return res.status(400).json({ error: "A valid phone number is required." });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .in("phone_number", variants)
      .limit(1);

    if (error) {
      throw error;
    }

    const profile = data?.[0];
    if (!profile) {
      return res.status(404).json({ error: "NOT_REGISTERED" });
    }

    return res.status(200).json({
      uid: profile.id,
      role: profile.role,
      email: profile.email || "",
      phoneNumber: profile.phone_number || "",
    });
  } catch (error: any) {
    console.error("Resolve phone login error:", error);
    return res.status(500).json({ error: error.message || "Failed to resolve phone login" });
  }
}

async function handleCompleteSignup(req: any, res: any) {
  const { email, password, displayName, phoneNumber, role, referralCodeInput, consents } = req.body || {};

  if (!email || !password || !displayName || !role) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phoneNumber);
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

    const { error: profileError } = await supabaseAdmin.from("users").upsert(row, { onConflict: "id" });
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

    for (let i = 0; i < referralPath.length; i += 1) {
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

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

const handlers: Record<string, (req: any, res: any) => Promise<any> | any> = {
  "complete-signup": handleCompleteSignup,
  "resolve-phone-login": handleResolvePhoneLogin,
  "send-email-otp": handleSendEmailOtp,
  "send-otp": handleSendOtp,
  "verify-otp": handleVerifyOtp,
};

export default async function handler(req: any, res: any) {
  const action = getAction(req);
  const routeHandler = handlers[action];

  if (!routeHandler) {
    return res.status(404).json({ error: "Auth route not found" });
  }

  return routeHandler(req, res);
}
