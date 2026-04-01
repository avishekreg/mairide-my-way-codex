export default async function handler(req: any, res: any) {
  const phoneNumber = String(req?.body?.phoneNumber || "").replace(/[^\d]/g, "");
  const apiKey = process.env.TWO_FACTOR_API_KEY;

  if (!phoneNumber) {
    return res.status(400).json({ Status: "Error", Details: "A valid phone number is required." });
  }

  if (!apiKey) {
    console.log(`[DEV] Mock SMS OTP sent to ${phoneNumber}: 123456`);
    return res.status(200).json({ Status: "Success", Details: "mock_sms_session_id" });
  }

  try {
    const response = await fetch(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${encodeURIComponent(phoneNumber)}/AUTOGEN2`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    const rawText = await response.text();
    const payload = rawText ? JSON.parse(rawText) : {};

    if (!response.ok) {
      return res.status(response.status).json(payload);
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    console.error("2Factor SMS OTP Error:", error);
    return res.status(500).json({
      Status: "Error",
      Details: error?.message || "Failed to send OTP",
    });
  }
}
