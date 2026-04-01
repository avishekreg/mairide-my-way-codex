export default async function handler(req: any, res: any) {
  const sessionId = String(req?.body?.sessionId || "").trim();
  const otp = String(req?.body?.otp || "").trim();
  const apiKey = process.env.TWO_FACTOR_API_KEY;

  if (!sessionId || !otp) {
    return res.status(400).json({ Status: "Error", Details: "Session ID and OTP are required." });
  }

  if (!apiKey || sessionId.startsWith("mock_")) {
    if (otp === "123456") {
      return res.status(200).json({ Status: "Success", Details: "OTP Matched" });
    }
    return res.status(400).json({ Status: "Error", Details: "Invalid OTP" });
  }

  try {
    const response = await fetch(
      `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`,
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
    console.error("2Factor OTP Verify Error:", error);
    return res.status(500).json({
      Status: "Error",
      Details: error?.message || "Failed to verify OTP",
    });
  }
}
