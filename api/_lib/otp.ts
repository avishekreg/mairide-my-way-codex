export type ReqLike = {
  body?: any;
};

export type ResLike = {
  status: (code: number) => ResLike;
  json: (payload: any) => void;
};

function normalizePhone(phoneNumber: unknown) {
  return String(phoneNumber || "").replace(/[^\d]/g, "");
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
    throw Object.assign(new Error(typeof payload === "string" ? payload : payload?.Details || `Request failed with status ${response.status}`), {
      payload,
      status: response.status,
    });
  }

  return payload;
}

export async function handleSendOtp(req: ReqLike, res: ResLike) {
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
    const data = await fetchJson(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(normalizedPhone)}/AUTOGEN2`
    );
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor SMS OTP Error:", error?.payload || error?.message || error);
    return res
      .status(error?.status || 500)
      .json(error?.payload || { Status: "Error", Details: error?.message || "Failed to send OTP" });
  }
}

export async function handleSendEmailOtp(req: ReqLike, res: ResLike) {
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
    const data = await fetchJson(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/EMAIL/${encodeURIComponent(normalizedEmail)}/AUTOGEN`
    );
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor Email OTP Error:", error?.payload || error?.message || error);
    return res
      .status(error?.status || 500)
      .json(error?.payload || { Status: "Error", Details: error?.message || "Failed to send Email OTP" });
  }
}

export async function handleVerifyOtp(req: ReqLike, res: ResLike) {
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
    const data = await fetchJson(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(normalizedSessionId)}/${encodeURIComponent(normalizedOtp)}`
    );
    return res.status(200).json(data);
  } catch (error: any) {
    console.error("2Factor OTP Verify Error:", error?.payload || error?.message || error);
    return res
      .status(error?.status || 500)
      .json(error?.payload || { Status: "Error", Details: error?.message || "Failed to verify OTP" });
  }
}
