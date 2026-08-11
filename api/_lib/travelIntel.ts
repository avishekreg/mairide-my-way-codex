import { canUseControlledFeature, getGlobalAppConfig } from "./featureAccess.js";

type TravelIntelMode = "track-train" | "track-flight";

function getAction(req: any): TravelIntelMode | "" {
  const fromQuery = req.query?.action;
  const action = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery || req.body?.action || "";
  return action === "track-train" || action === "track-flight" ? action : "";
}

function normalizeRequester(body: any) {
  const profile = body?.profile || body?.requester || {};
  return {
    uid: profile.uid || profile.id || body?.userId,
    email: profile.email || body?.email,
    displayName: profile.displayName || body?.displayName,
    role: profile.role || body?.role,
  };
}

function buildDemoResult(mode: TravelIntelMode, identifier: string, travelDate: string) {
  const checkedAt = new Date().toISOString();
  const label = mode === "track-train" ? "train" : "flight";
  return {
    status: "staged",
    title: `Demo ${label} status · ${identifier}`,
    summary:
      `Travel Intel is running in demo/sandbox mode. Live ${label} provider data will appear here once the admin enables a configured provider.`,
    checkedAt,
    details: [
      { label: "Travel date", value: travelDate },
      { label: "Platform mode", value: "Demo / Sandbox" },
      { label: "Provider", value: "Not connected" },
    ],
  };
}

async function fetchProviderResult({
  baseUrl,
  apiKey,
  mode,
  identifier,
  travelDate,
}: {
  baseUrl: string;
  apiKey: string;
  mode: TravelIntelMode;
  identifier: string;
  travelDate: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ action: mode, identifier, travelDate }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || payload?.message || "Travel provider request failed.");
    }
    return {
      status: "active",
      title: String(payload?.title || `${mode === "track-train" ? "Train" : "Flight"} status · ${identifier}`),
      summary: String(payload?.summary || payload?.statusText || "Live provider response received."),
      checkedAt: new Date().toISOString(),
      details: Array.isArray(payload?.details) ? payload.details : [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleTravelIntel(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const action = getAction(req);
  if (!action) {
    return res.status(400).json({ error: "Invalid Travel Intel action." });
  }

  const identifier = String(req.body?.identifier || "").trim();
  const travelDate = String(req.body?.travelDate || new Date().toISOString().slice(0, 10)).trim();
  if (!identifier) {
    return res.status(400).json({ error: action === "track-train" ? "Train number is required." : "Flight number is required." });
  }

  try {
    const config = await getGlobalAppConfig();
    const requester = normalizeRequester(req.body);
    const allowed = canUseControlledFeature(Boolean(config.trackingServicesEnabled), requester, config);
    if (!allowed) {
      return res.status(403).json({
        error: "Travel Intel is currently in sandbox mode and is not enabled for this account.",
        status: "disabled",
      });
    }

    const providerUrl = String(
      action === "track-train" ? config.trainTrackingApiBaseUrl || "" : config.flightTrackingApiBaseUrl || ""
    ).trim();
    const apiKey = String(config.travelTrackingApiKey || process.env.TRAVEL_TRACKING_API_KEY || "").trim();

    if (!providerUrl) {
      return res.status(200).json(buildDemoResult(action, identifier, travelDate));
    }

    try {
      return res.status(200).json(await fetchProviderResult({
        baseUrl: providerUrl,
        apiKey,
        mode: action,
        identifier,
        travelDate,
      }));
    } catch (providerError: any) {
      console.warn("Travel Intel provider fallback:", providerError?.message || providerError);
      return res.status(200).json({
        ...buildDemoResult(action, identifier, travelDate),
        summary:
          "Live provider lookup failed, so mAIRide is showing a demo/sandbox response instead. Check provider URL, key, and network health before public rollout.",
      });
    }
  } catch (error: any) {
    return res.status(error?.status || 500).json({
      error: error?.message || "Travel Intel could not be checked right now.",
      status: "error",
    });
  }
}
