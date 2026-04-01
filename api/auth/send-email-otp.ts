export default async function handler(req: any, res: any) {
  const email = String(req?.body?.email || "").trim().toLowerCase();
  const apiKey = process.env.TWO_FACTOR_API_KEY;

  if (!email) {
    return res.status(400).json({ Status: "Error", Details: "A valid email address is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock Email OTP sent to ${email}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_email_session_id" });
  }

  try {
    const response = await fetch(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/EMAIL/${encodeURIComponent(email)}/AUTOGEN`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    const rawText = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson && rawText ? JSON.parse(rawText) : null;

    if (!isJson) {
      return res.status(503).json({
        Status: "Error",
        Code: "EMAIL_OTP_UNAVAILABLE",
        Details:
          "Email OTP service is currently unavailable for this account. Please continue with phone OTP verification.",
        providerStatus: response.status,
      });
    }

    if (!response.ok) {
      return res.status(response.status).json(payload);
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    console.error("2Factor Email OTP Error:", error);
    return res.status(500).json({
      Status: "Error",
      Code: "EMAIL_OTP_UNAVAILABLE",
      Details:
        error?.message || "Email OTP service is currently unavailable. Please continue with phone OTP verification.",
    });
  }
}
