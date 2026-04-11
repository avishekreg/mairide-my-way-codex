import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.ts";

const DRIVER_JOINING_BONUS = 500;
const TRAVELER_JOINING_BONUS = 250;
const TIER1_REWARD = 25;
const TIER2_REWARD = 5;
const EMAIL_OTP_SESSION_PREFIX = "emailotp_";
const PASSWORD_RESET_SESSION_PREFIX = "pwdreset_";
const PASSWORD_RESET_TOKEN_PREFIX = "pwdtoken_";
const inMemoryOtpSessions = new Map<string, {
  email: string;
  otpHash: string;
  expiresAt: string;
  consumedAt: string | null;
}>();
const inMemoryPasswordResetSessions = new Map<string, {
  uid: string;
  phoneNumber: string;
  otpSessionId: string;
  expiresAt: string;
  verifiedAt: string | null;
}>();
const inMemoryPasswordResetTokens = new Map<string, {
  uid: string;
  expiresAt: string;
}>();
const SMS_OTP_SESSION_PREFIX = "smsotp_";
const inMemorySmsOtpSessions = new Map<string, {
  phoneNumber: string;
  otpHash: string;
  expiresAt: string;
  consumedAt: string | null;
  purpose: "login" | "password_reset";
}>();

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

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

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email);
}

function normalizeOtpValue(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const compactDigits = raw.replace(/[^\d]/g, "");
  if (compactDigits.length >= 4 && compactDigits.length <= 6) return compactDigits;
  const match = raw.match(/(\d{4,6})/);
  if (match?.[1]) return match[1];
  if (compactDigits.length > 6) return compactDigits.slice(0, 6);
  return compactDigits;
}

function normalizeSessionValue(value: unknown) {
  return String(value || "").trim();
}

async function getAppConfigData(supabaseAdmin?: any) {
  try {
    const admin = supabaseAdmin || getSupabaseAdmin();
    const { data, error } = await admin
      .from("app_config")
      .select("data")
      .eq("id", "global")
      .maybeSingle();

    if (error) throw error;
    return (data?.data as Record<string, any> | undefined) || {};
  } catch {
    return {};
  }
}

async function getSmsOtpConfig(supabaseAdmin?: any) {
  const configData = await getAppConfigData(supabaseAdmin);
  const fallbackTemplate = String(configData.smsTemplateName || "AUTOGEN2").trim() || "AUTOGEN2";
  return {
    provider: String(configData.smsOtpProvider || "2factor").trim().toLowerCase(),
    apiUrl: String(configData.smsApiUrl || process.env.SMS_API_URL || "https://2factor.in/API/V1").trim(),
    apiKey: String(configData.twoFactorApiKey || configData.smsApiKey || process.env.TWO_FACTOR_API_KEY || "").trim(),
    templateName: fallbackTemplate,
    loginTemplateName: String(configData.smsLoginTemplateName || fallbackTemplate).trim() || fallbackTemplate,
    passwordResetTemplateName: String(configData.smsPasswordResetTemplateName || fallbackTemplate).trim() || fallbackTemplate,
  };
}

function maskPhoneNumber(phoneNumber: string) {
  const digits = normalizePhone(phoneNumber);
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return `${digits[0]}${"*".repeat(Math.max(digits.length - 4, 0))}${digits.slice(-3)}`;
}

async function getEmailOtpConfig(supabaseAdmin?: any) {
  const configData = await getAppConfigData(supabaseAdmin);
  const provider = String(
    configData.emailOtpProvider ||
      (configData.resendApiKey || process.env.RESEND_API_KEY ? "resend" : "2factor")
  )
    .trim()
    .toLowerCase();

  return {
    enabled: configData.emailOtpEnabled !== false,
    provider,
    apiUrl: String(configData.emailApiUrl || process.env.EMAIL_API_URL || "").trim(),
    apiKey: String(configData.emailApiKey || process.env.EMAIL_API_KEY || "").trim(),
    resendApiBaseUrl: String(configData.resendApiBaseUrl || process.env.RESEND_API_BASE_URL || "https://api.resend.com/emails").trim(),
    resendApiKey: String(configData.resendApiKey || process.env.RESEND_API_KEY || "").trim(),
    resendFromEmail: String(configData.resendFromEmail || process.env.RESEND_FROM_EMAIL || "").trim(),
    resendFromName: String(configData.resendFromName || process.env.RESEND_FROM_NAME || "MaiRide").trim(),
    resendReplyToEmail: String(configData.resendReplyToEmail || process.env.RESEND_REPLY_TO_EMAIL || "").trim(),
    expiryMinutes: Math.max(3, Number(configData.emailOtpExpiryMinutes || process.env.EMAIL_OTP_EXPIRY_MINUTES || 10)),
    subject: String(configData.emailOtpSubject || process.env.EMAIL_OTP_SUBJECT || "Your MaiRide verification code").trim(),
    appBaseUrl: String(configData.appBaseUrl || process.env.APP_URL || process.env.VITE_APP_URL || "").trim(),
    supportEmail: String(configData.supportEmail || process.env.SUPPORT_EMAIL || "").trim(),
  };
}

function hashOtp(code: string) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function persistSmsOtpSession(
  supabaseAdmin: any,
  sessionId: string,
  phoneNumber: string,
  otpHash: string,
  expiresAt: string,
  purpose: "login" | "password_reset"
) {
  try {
    const { error } = await supabaseAdmin.from("otp_sessions").upsert(
      {
        id: sessionId,
        channel: "sms",
        recipient: phoneNumber,
        otp_hash: otpHash,
        expires_at: expiresAt,
        consumed_at: null,
        attempts: 0,
        data: { purpose },
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    return true;
  } catch {
    inMemorySmsOtpSessions.set(sessionId, {
      phoneNumber,
      otpHash,
      expiresAt,
      consumedAt: null,
      purpose,
    });
    return false;
  }
}

async function consumeSmsOtpSession(supabaseAdmin: any, sessionId: string, otp: string) {
  const hashedOtp = hashOtp(otp);

  try {
    const { data, error } = await supabaseAdmin
      .from("otp_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("channel", "sms")
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, message: "Invalid OTP session." };
    if (data.consumed_at) return { ok: false, message: "OTP has already been used." };
    if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, message: "OTP has expired." };

    if (String(data.otp_hash || "") !== hashedOtp) {
      await supabaseAdmin
        .from("otp_sessions")
        .update({ attempts: Number(data.attempts || 0) + 1 })
        .eq("id", sessionId);
      return { ok: false, message: "Invalid OTP." };
    }

    await supabaseAdmin
      .from("otp_sessions")
      .update({ consumed_at: new Date().toISOString(), attempts: Number(data.attempts || 0) + 1 })
      .eq("id", sessionId);

    return { ok: true };
  } catch {
    const session = inMemorySmsOtpSessions.get(sessionId);
    if (!session) return { ok: false, message: "Invalid OTP session." };
    if (session.consumedAt) return { ok: false, message: "OTP has already been used." };
    if (new Date(session.expiresAt).getTime() < Date.now()) return { ok: false, message: "OTP has expired." };
    if (session.otpHash !== hashedOtp) return { ok: false, message: "Invalid OTP." };
    session.consumedAt = new Date().toISOString();
    inMemorySmsOtpSessions.set(sessionId, session);
    return { ok: true };
  }
}

async function persistEmailOtpSession(supabaseAdmin: any, sessionId: string, email: string, otpHash: string, expiresAt: string) {
  try {
    const { error } = await supabaseAdmin.from("otp_sessions").upsert(
      {
        id: sessionId,
        channel: "email",
        recipient: email,
        otp_hash: otpHash,
        expires_at: expiresAt,
        consumed_at: null,
        attempts: 0,
        data: {},
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    return true;
  } catch {
    inMemoryOtpSessions.set(sessionId, {
      email,
      otpHash,
      expiresAt,
      consumedAt: null,
    });
    return false;
  }
}

async function consumeEmailOtpSession(supabaseAdmin: any, sessionId: string, otp: string) {
  const hashedOtp = hashOtp(otp);

  try {
    const { data, error } = await supabaseAdmin
      .from("otp_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("channel", "email")
      .maybeSingle();

    if (error) throw error;
    if (!data) return { ok: false, message: "Invalid OTP session." };
    if (data.consumed_at) return { ok: false, message: "OTP has already been used." };
    if (new Date(data.expires_at).getTime() < Date.now()) return { ok: false, message: "OTP has expired." };
    if (data.otp_hash !== hashedOtp) {
      await supabaseAdmin
        .from("otp_sessions")
        .update({ attempts: Number(data.attempts || 0) + 1 })
        .eq("id", sessionId);
      return { ok: false, message: "Invalid OTP." };
    }

    await supabaseAdmin
      .from("otp_sessions")
      .update({ consumed_at: new Date().toISOString(), attempts: Number(data.attempts || 0) + 1 })
      .eq("id", sessionId);

    return { ok: true, email: String(data.recipient || "").trim().toLowerCase() };
  } catch {
    const session = inMemoryOtpSessions.get(sessionId);
    if (!session) return { ok: false, message: "Invalid OTP session." };
    if (session.consumedAt) return { ok: false, message: "OTP has already been used." };
    if (new Date(session.expiresAt).getTime() < Date.now()) return { ok: false, message: "OTP has expired." };
    if (session.otpHash !== hashedOtp) return { ok: false, message: "Invalid OTP." };
    session.consumedAt = new Date().toISOString();
    inMemoryOtpSessions.set(sessionId, session);
    return { ok: true, email: session.email };
  }
}

async function sendEmailOtpViaResend(emailConfig: Awaited<ReturnType<typeof getEmailOtpConfig>>, email: string) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const sessionId = `${EMAIL_OTP_SESSION_PREFIX}${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + emailConfig.expiryMinutes * 60_000).toISOString();
  const supabaseAdmin = getSupabaseAdmin();
  await persistEmailOtpSession(supabaseAdmin, sessionId, email, hashOtp(code), expiresAt);

  const fromAddress = emailConfig.resendFromName
    ? `${emailConfig.resendFromName} <${emailConfig.resendFromEmail}>`
    : emailConfig.resendFromEmail;

  const response = await fetch(emailConfig.resendApiBaseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${emailConfig.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [email],
      reply_to: emailConfig.resendReplyToEmail || undefined,
      subject: emailConfig.subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
          <h2 style="margin:0 0 12px;color:#1f2937">Verify your MaiRide email</h2>
          <p style="margin:0 0 16px;line-height:1.6">Use the verification code below to continue your signup. This code expires in ${emailConfig.expiryMinutes} minutes.</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#ea7a27;background:#fff7ed;border:1px solid #fdba74;border-radius:16px;padding:20px 24px;text-align:center">${code}</div>
          <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#64748b">If you did not request this code, you can ignore this email${emailConfig.supportEmail ? ` or contact ${emailConfig.supportEmail}` : ""}.</p>
        </div>
      `,
      tags: [
        { name: "product", value: "mairide" },
        { name: "flow", value: "email-otp" },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(
      new Error(payload?.message || payload?.error?.message || "Failed to send Email OTP"),
      { status: response.status, payload }
    );
  }

  return {
    Status: "Success",
    Details: sessionId,
    Provider: "resend",
  };
}

async function fetchJson(url: string, method: "GET" | "POST" = "GET") {
  const response = await fetch(url, {
    method,
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

async function sendSmsOtpToPhone(phoneNumber: string, purpose: "login" | "password_reset" = "login") {
  const normalizedPhone = normalizePhone(phoneNumber);
  const smsConfig = await getSmsOtpConfig();
  const apiKey = smsConfig.apiKey;
  if (!normalizedPhone) {
    throw Object.assign(new Error("A valid phone number is required."), { status: 400 });
  }

  if (!apiKey) {
    const code = "123456";
    const sessionId = `${SMS_OTP_SESSION_PREFIX}${crypto.randomUUID()}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await persistSmsOtpSession(getSupabaseAdmin(), sessionId, normalizedPhone, hashOtp(code), expiresAt, purpose);
    console.log(`[DEV] Mock SMS OTP sent to ${normalizedPhone}: 123456`);
    return {
      Status: "Success",
      Details: sessionId,
    };
  }

  // Enforce SMS-only delivery path and block voice/call route misconfiguration.
  const baseUrl = smsConfig.apiUrl.replace(/\/+$/, "");
  if (/\/voice(\/|$)/i.test(baseUrl) || /\/call(\/|$)/i.test(baseUrl)) {
    throw Object.assign(new Error("SMS API URL is misconfigured (voice/call route detected)."), { status: 500 });
  }

  const otpCode = generateOtpCode();
  const sessionId = `${SMS_OTP_SESSION_PREFIX}${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const selectedTemplate =
    purpose === "password_reset" ? smsConfig.passwordResetTemplateName : smsConfig.loginTemplateName;
  const templateName = /voice|call/i.test(selectedTemplate) ? "AUTOGEN2" : selectedTemplate;

  // 2Factor custom OTP send endpoint with app-generated OTP.
  const response = await fetchJson(
    `${baseUrl}/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(normalizedPhone)}/${encodeURIComponent(otpCode)}/${encodeURIComponent(templateName)}`,
    "GET"
  );

  if (String(response?.Status || "").toLowerCase() !== "success") {
    throw Object.assign(new Error(String(response?.Details || "Failed to send OTP")), {
      status: 500,
      payload: response,
    });
  }

  await persistSmsOtpSession(getSupabaseAdmin(), sessionId, normalizedPhone, hashOtp(otpCode), expiresAt, purpose);
  return {
    Status: "Success",
    Details: sessionId,
  };
}

async function verifySmsOtpSession(sessionId: string, otp: string) {
  const normalizedSessionId = normalizeSessionValue(sessionId);
  const normalizedOtp = normalizeOtpValue(otp);

  if (!normalizedSessionId || !normalizedOtp) {
    throw Object.assign(new Error("Session ID and OTP are required."), { status: 400 });
  }

  const result = await consumeSmsOtpSession(getSupabaseAdmin(), normalizedSessionId, normalizedOtp);
  if (!result.ok) {
    throw Object.assign(new Error(result.message || "Invalid OTP"), {
      status: 400,
      payload: { Status: "Error", Details: result.message || "Invalid OTP" },
    });
  }
  return { Status: "Success", Details: "OTP Matched" };
}

async function findAuthUserByEmail(supabaseAdmin: any, email: string) {
  const target = normalizeEmail(email);
  if (!target) return null;

  let page = 1;
  const perPage = 200;

  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const users = data?.users || [];
    const found = users.find((entry: any) => normalizeEmail(entry?.email) === target);
    if (found) return found;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
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
  try {
    const data = await sendSmsOtpToPhone(phoneNumber, "login");
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor SMS OTP Error:", error?.payload || error?.message || error);
    return res.status(error?.status || 500).json(error?.payload || { Status: "Error", Details: error?.message || "Failed to send OTP" });
  }
}

async function handleSendEmailOtp(req: any, res: any) {
  const { email } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const emailConfig = await getEmailOtpConfig();
  const apiKey = emailConfig.apiKey;

  if (!normalizedEmail) {
    return res.status(400).json({ Status: "Error", Details: "A valid email address is required." });
  }

  if (!emailConfig.enabled) {
    return res.status(200).json({
      Status: "Error",
      Code: "EMAIL_OTP_UNAVAILABLE",
      Details: "Email OTP is disabled right now. Please continue with phone OTP.",
    });
  }

  if (emailConfig.provider === "resend" && emailConfig.resendApiKey && emailConfig.resendFromEmail) {
    try {
      const data = await sendEmailOtpViaResend(emailConfig, normalizedEmail);
      return res.status(200).json(data);
    } catch (error: any) {
      console.error("Resend Email OTP Error:", error?.payload || error?.message || error);
      return res.status(error?.status || 500).json({
        Status: "Error",
        Details: error?.message || "Failed to send Email OTP",
      });
    }
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
  const normalizedSessionId = normalizeSessionValue(sessionId);
  const normalizedOtp = normalizeOtpValue(otp);
  if (!normalizedSessionId || !normalizedOtp) {
    return res.status(400).json({ Status: "Error", Details: "Session ID and OTP are required." });
  }

  if (normalizedSessionId.startsWith(EMAIL_OTP_SESSION_PREFIX)) {
    const result = await consumeEmailOtpSession(getSupabaseAdmin(), normalizedSessionId, normalizedOtp);
    if (!result.ok) {
      return res.status(400).json({ Status: "Error", Details: result.message || "Invalid OTP" });
    }
    return res.status(200).json({ Status: "Success", Details: "OTP Matched", Email: result.email });
  }

  try {
    const data = await verifySmsOtpSession(normalizedSessionId, normalizedOtp);
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor OTP Verify Error:", error?.payload || error?.message || error);
    return res.status(error?.status || 500).json(error?.payload || { Status: "Error", Details: error?.message || "Failed to verify OTP" });
  }
}

async function handleSendPasswordResetOtp(req: any, res: any) {
  const identifier = String(req.body?.identifier || "").trim();
  if (!identifier) {
    return res.status(400).json({ error: "Please enter your email or mobile number." });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const normalizedEmail = normalizeEmail(identifier);
    const phoneVariants = buildPhoneVariants(identifier);
    let userRow: any = null;

    if (isValidEmail(normalizedEmail)) {
      const { data, error } = await supabaseAdmin.from("users").select("*").eq("email", normalizedEmail).maybeSingle();
      if (error) throw error;
      userRow = data || null;
    }

    if (!userRow && phoneVariants.length) {
      const { data, error } = await supabaseAdmin.from("users").select("*").in("phone_number", phoneVariants).limit(1);
      if (error) throw error;
      userRow = data?.[0] || null;
    }

    if (!userRow) {
      return res.status(404).json({ error: "No account found with this email/mobile number." });
    }

    const phoneNumber = String(userRow.phone_number || userRow.data?.phoneNumber || "");
    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      return res.status(400).json({ error: "This account has no mobile number linked for OTP reset." });
    }

    const otpResponse = await sendSmsOtpToPhone(normalizedPhone, "password_reset");
    if (String(otpResponse?.Status || "").toLowerCase() !== "success" || !otpResponse?.Details) {
      return res.status(500).json({ error: String(otpResponse?.Details || "Failed to send OTP") });
    }

    const resetSessionId = `${PASSWORD_RESET_SESSION_PREFIX}${crypto.randomUUID()}`;
    inMemoryPasswordResetSessions.set(resetSessionId, {
      uid: userRow.id,
      phoneNumber: normalizedPhone,
      otpSessionId: String(otpResponse.Details),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      verifiedAt: null,
    });

    return res.status(200).json({
      message: "OTP sent to your registered mobile number.",
      resetSessionId,
      maskedPhone: maskPhoneNumber(normalizedPhone),
    });
  } catch (error: any) {
    console.error("Password reset OTP send error:", error);
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to send password reset OTP" });
  }
}

async function handleVerifyPasswordResetOtp(req: any, res: any) {
  const resetSessionId = String(req.body?.resetSessionId || "").trim();
  const otp = String(req.body?.otp || "").trim();
  if (!resetSessionId || !otp) {
    return res.status(400).json({ error: "Session ID and OTP are required." });
  }

  const session = inMemoryPasswordResetSessions.get(resetSessionId);
  if (!session) {
    return res.status(404).json({ error: "Reset session expired. Please request a new OTP." });
  }
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    inMemoryPasswordResetSessions.delete(resetSessionId);
    return res.status(400).json({ error: "Reset session expired. Please request a new OTP." });
  }

  try {
    const otpResult = await verifySmsOtpSession(session.otpSessionId, otp);
    if (String(otpResult?.Status || "").toLowerCase() !== "success") {
      return res.status(400).json({ error: String(otpResult?.Details || "Invalid OTP") });
    }

    const resetToken = `${PASSWORD_RESET_TOKEN_PREFIX}${crypto.randomUUID()}`;
    inMemoryPasswordResetTokens.set(resetToken, {
      uid: session.uid,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    inMemoryPasswordResetSessions.delete(resetSessionId);

    return res.status(200).json({
      message: "OTP verified. You can now reset your password.",
      resetToken,
    });
  } catch (error: any) {
    console.error("Password reset OTP verify error:", error);
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to verify OTP" });
  }
}

async function handleResetPasswordWithOtp(req: any, res: any) {
  const resetToken = String(req.body?.resetToken || "").trim();
  const newPassword = String(req.body?.newPassword || "");
  if (!resetToken || !newPassword) {
    return res.status(400).json({ error: "Reset token and new password are required." });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  const tokenData = inMemoryPasswordResetTokens.get(resetToken);
  if (!tokenData) {
    return res.status(404).json({ error: "Reset token expired. Please restart password reset." });
  }
  if (new Date(tokenData.expiresAt).getTime() < Date.now()) {
    inMemoryPasswordResetTokens.delete(resetToken);
    return res.status(400).json({ error: "Reset token expired. Please restart password reset." });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(tokenData.uid, {
      password: newPassword,
    });
    if (error) throw error;

    await supabaseAdmin.from("users").update({
      force_password_change: false,
      updated_at: new Date().toISOString(),
    }).eq("id", tokenData.uid);

    inMemoryPasswordResetTokens.delete(resetToken);
    return res.status(200).json({ message: "Password reset successful." });
  } catch (error: any) {
    console.error("Password reset final step error:", error);
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to reset password." });
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
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
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
      const isDuplicate = /already been registered|already registered|already exists/i.test(message);

      if (!isDuplicate) {
        return res.status(500).json({ error: message });
      }

      const existingAuthUser = await findAuthUserByEmail(supabaseAdmin, normalizedEmail);
      if (!existingAuthUser?.id) {
        return res.status(409).json({ error: "A user with this email already exists. Please sign in instead." });
      }

      const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", existingAuthUser.id)
        .maybeSingle();

      if (existingProfileError) {
        return res.status(500).json({ error: existingProfileError.message || "Failed to recover existing account profile." });
      }

      if (!existingProfile) {
        const recoveredRow = buildSignupRow({
          uid: existingAuthUser.id,
          email: normalizedEmail,
          displayName,
          phoneNumber: normalizedPhone || normalizePhone(existingAuthUser.phone),
          role,
          referralCode: ownReferralCode,
          referredBy,
          referralPath,
          consents,
        });

        const { error: recoverProfileError } = await supabaseAdmin
          .from("users")
          .upsert(recoveredRow, { onConflict: "id" });
        if (recoverProfileError) {
          return res.status(500).json({ error: recoverProfileError.message || "Failed to recover existing account profile." });
        }

        const joiningBonus = role === "driver" ? DRIVER_JOINING_BONUS : TRAVELER_JOINING_BONUS;
        const txId = `init_${existingAuthUser.id}`;
        await supabaseAdmin.from("transactions").upsert(
          {
            id: txId,
            user_id: existingAuthUser.id,
            type: "wallet_topup",
            status: "completed",
            data: {
              id: txId,
              userId: existingAuthUser.id,
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
      }

      return res.status(409).json({
        error: "A user with this email already exists. Please sign in or reset your password.",
      });
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
  "send-password-reset-otp": handleSendPasswordResetOtp,
  "verify-password-reset-otp": handleVerifyPasswordResetOtp,
  "reset-password-with-otp": handleResetPasswordWithOtp,
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
