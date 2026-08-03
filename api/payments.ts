import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";
import { canUseControlledFeature, getGlobalAppConfig, isSandboxRequester } from "./_lib/featureAccess.js";

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw Object.assign(new Error("Missing Supabase admin environment variables."), { status: 500 });
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function getAuthHeader(req: any) {
  return Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
}

async function verifyTokenFromHeader(req: any) {
  const authHeader = getAuthHeader(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);

  if (error || !data.user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  return data.user;
}

async function getRazorpayConfig() {
  let keyId = process.env.VITE_RAZORPAY_KEY_ID;
  let keySecret = process.env.RAZORPAY_KEY_SECRET;

  try {
    const { data } = await getSupabaseAdmin()
      .from("app_config")
      .select("data")
      .eq("id", "global")
      .maybeSingle();

    const configData = (data?.data as Record<string, any> | undefined) || {};
    keyId = String(configData.razorpayKeyId || keyId || "").trim();
    keySecret = String(configData.razorpayKeySecret || keySecret || "").trim();
  } catch {
    // Fallback to environment variables if config lookup is unavailable.
  }

  if (!keyId || !keySecret) {
    throw Object.assign(new Error("Razorpay test credentials are not configured."), { status: 500 });
  }

  return { keyId, keySecret };
}

const controlledPaymentDmtActions = new Set([
  "create-dmt-transfer",
  "verify-dmt-transfer",
  "dmt-status",
  "initiate-dmt",
  "create-controlled-payment",
  "create-aeps-transaction",
  "aeps-status",
  "create-bill-payment",
  "bill-payment-status",
  "create-rail-booking",
  "create-flight-booking",
  "create-bus-booking",
  "create-hotel-booking",
  "create-loan-application",
  "create-credit-card-application",
]);

const actionServiceMap: Record<string, string> = {
  "create-dmt-transfer": "dmt",
  "verify-dmt-transfer": "dmt",
  "dmt-status": "dmt",
  "initiate-dmt": "dmt",
  "create-controlled-payment": "dmt",
  "create-aeps-transaction": "aeps",
  "aeps-status": "aeps",
  "create-bill-payment": "bill_payments",
  "bill-payment-status": "bill_payments",
  "create-rail-booking": "rail_bookings",
  "create-flight-booking": "flight_bookings",
  "create-bus-booking": "bus_bookings",
  "create-hotel-booking": "hotel_bookings",
  "create-loan-application": "loan_applications",
  "create-credit-card-application": "credit_card_services",
};

function isMaiPayMasterEnabled(config: Record<string, any>) {
  return Boolean(config.maipayEnabled ?? config.paymentDmtServicesEnabled);
}

function isMaiPayServiceEnabled(config: Record<string, any>, serviceId: string) {
  return Boolean(isMaiPayMasterEnabled(config) && config.maipayServiceCatalog?.[serviceId]);
}

async function guardPaymentDmtAccess(req: any, res: any) {
  const config = await getGlobalAppConfig();
  const action = getAction(req);
  const serviceId = actionServiceMap[action] || "dmt";
  const requester = req.body?.profile || req.body?.requester || {
    uid: req.body?.userId,
    email: req.body?.email,
    displayName: req.body?.displayName,
    role: req.body?.role,
  };

  if (!canUseControlledFeature(isMaiPayServiceEnabled(config, serviceId), requester, config)) {
    return res.status(403).json({
      error: "This MaiPay service is inactive for this account.",
      serviceId,
    });
  }

  return res.status(501).json({
    error: "MaiPay connector is gated and not configured for live execution yet.",
    serviceId,
    sandbox: true,
  });
}

function getLiveMoneyWalletAnnualFee(config: Record<string, any>) {
  const minFee = Number(config.liveMoneyWalletMinAnnualFee || 500);
  const maxFee = Number(config.liveMoneyWalletMaxAnnualFee || 1000);
  const annualFee = Number(config.liveMoneyWalletAnnualFee || 750);
  return Math.min(Math.max(annualFee, minFee), maxFee);
}

function canUseLiveMoneyWallet(config: Record<string, any>, requester: Record<string, any>) {
  return Boolean(isMaiPayServiceEnabled(config, "driver_live_wallet") && config.liveMoneyWalletAddOnEnabled) || isSandboxRequester(requester, config);
}

async function createLiveMoneyWalletSubscriptionOrder(req: any, res: any) {
  try {
    const user = await verifyTokenFromHeader(req);
    const config = await getGlobalAppConfig();
    const requester = {
      uid: user.id,
      email: user.email,
      role: req.body?.role || req.body?.profile?.role,
      displayName: req.body?.displayName || req.body?.profile?.displayName,
    };

    if (!canUseLiveMoneyWallet(config, requester)) {
      return res.status(403).json({ error: "Live Money Wallet add-on is inactive for this account." });
    }

    const annualFee = getLiveMoneyWalletAnnualFee(config);
    const { keyId, keySecret } = await getRazorpayConfig();
    const receipt = `lmw_sub_${String(user.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 18)}_${Date.now().toString().slice(-8)}`.slice(0, 40);
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: Math.round(annualFee * 100),
        currency: "INR",
        receipt,
        notes: {
          userId: user.id,
          userEmail: user.email || "",
          product: "driver_live_money_wallet_subscription",
          annualFee,
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.error?.description || payload?.description || "Failed to create Live Money Wallet subscription order.",
      });
    }

    return res.status(200).json({ ...payload, annualFee, keyId });
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to create Live Money Wallet subscription order." });
  }
}

async function createLiveMoneyWalletQrCode(req: any, res: any) {
  try {
    const user = await verifyTokenFromHeader(req);
    const config = await getGlobalAppConfig();
    const requester = {
      uid: user.id,
      email: user.email,
      role: req.body?.role || req.body?.profile?.role,
      displayName: req.body?.displayName || req.body?.profile?.displayName,
    };

    const qrCollectionAllowed = isMaiPayServiceEnabled(config, "qr_collections") || isSandboxRequester(requester, config);
    if (!canUseLiveMoneyWallet(config, requester) && !qrCollectionAllowed) {
      return res.status(403).json({ error: "Live Money Wallet collections are inactive for this account." });
    }

    const amount = Number(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "A valid collection amount is required." });
    }

    const { keyId, keySecret } = await getRazorpayConfig();
    const response = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        type: "upi_qr",
        name: "mAIRide Live Money Wallet",
        usage: "single_use",
        fixed_amount: true,
        payment_amount: Math.round(amount * 100),
        description: "Driver Live Money Wallet collection",
        notes: {
          driverId: user.id,
          driverEmail: user.email || "",
          product: "driver_live_money_wallet_collection",
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.error?.description || payload?.description || "Failed to generate Live Money Wallet QR.",
      });
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to generate Live Money Wallet QR." });
  }
}

async function createRazorpayOrder(req: any, res: any) {
  try {
    await verifyTokenFromHeader(req);
    const { amount, bookingId, payer, notes } = req.body || {};
    const numericAmount = Number(amount);

    if (!bookingId || !payer || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "A valid booking, payer, and amount are required." });
    }

    const { keyId, keySecret } = await getRazorpayConfig();
    const compactBookingId = String(bookingId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 18);
    const compactTimestamp = Date.now().toString().slice(-8);
    const receipt = `${payer.slice(0, 1)}${compactBookingId}${compactTimestamp}`.slice(0, 40);
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: Math.round(numericAmount * 100),
        currency: "INR",
        receipt,
        notes: {
          bookingId,
          payer,
          ...(notes && typeof notes === "object" ? notes : {}),
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload?.error?.description || payload?.description || "Failed to create Razorpay order.",
      });
    }

    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to create Razorpay order." });
  }
}

async function verifyRazorpayPayment(req: any, res: any) {
  try {
    await verifyTokenFromHeader(req);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Razorpay verification payload is incomplete." });
    }

    const { keySecret } = await getRazorpayConfig();
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: "Razorpay payment signature is invalid." });
    }

    return res.status(200).json({
      verified: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to verify Razorpay payment." });
  }
}

function normalizeGstRate(rawRate: number) {
  if (!Number.isFinite(rawRate)) return 0.18;
  return rawRate > 1 ? rawRate / 100 : rawRate;
}

function resolvePayerFeeBreakdown(bookingData: Record<string, any>, payer: "consumer" | "driver", coinsUsed: number) {
  const configuredServiceFee = Number(bookingData.serviceFee || 0);
  const configuredGstAmount = Number(bookingData.gstAmount || 0);
  const inferredGstRate =
    configuredServiceFee > 0 ? configuredGstAmount / configuredServiceFee : normalizeGstRate(Number(bookingData.gstRate ?? 0.18));
  const baseFee = configuredServiceFee > 0 ? configuredServiceFee : 100;
  const normalizedCoinsUsed = Math.max(Number(coinsUsed || 0), 0);

  const storedServiceFee = Number(
    payer === "consumer" ? bookingData.consumerNetServiceFee : bookingData.driverNetServiceFee
  );
  const storedGstAmount = Number(
    payer === "consumer" ? bookingData.consumerNetGstAmount : bookingData.driverNetGstAmount
  );

  if (
    Number.isFinite(storedServiceFee) &&
    Number.isFinite(storedGstAmount) &&
    storedServiceFee >= 0 &&
    storedGstAmount >= 0
  ) {
    return {
      serviceFee: storedServiceFee,
      gstAmount: storedGstAmount,
      totalFee: storedServiceFee + storedGstAmount,
    };
  }

  const netServiceFee = Math.max(baseFee - normalizedCoinsUsed, 0);
  const gstAmount = netServiceFee * normalizeGstRate(inferredGstRate);
  return {
    serviceFee: netServiceFee,
    gstAmount,
    totalFee: netServiceFee + gstAmount,
  };
}

function buildPlatformFeeTransactionRow({
  booking,
  payer,
  paymentMode,
  paymentStatus,
  transactionId,
  orderId,
  receiptUrl,
  gateway,
  coinsUsed = 0,
  metadata = {},
}: {
  booking: Record<string, any>;
  payer: "consumer" | "driver";
  paymentMode: "maicoins" | "online" | "hybrid";
  paymentStatus: "pending" | "completed" | "failed";
  transactionId?: string;
  orderId?: string;
  receiptUrl?: string;
  gateway?: "manual" | "razorpay";
  coinsUsed?: number;
  metadata?: Record<string, any>;
}) {
  const bookingData = (booking.data as Record<string, any>) || {};
  const bookingId = booking.id;
  const payerUserId = payer === "consumer" ? booking.consumer_id || bookingData.consumerId : booking.driver_id || bookingData.driverId;
  const payerName = payer === "consumer" ? bookingData.consumerName : bookingData.driverName;
  const { serviceFee, gstAmount, totalFee } = resolvePayerFeeBreakdown(bookingData, payer, Number(coinsUsed || 0));
  const txId = `platform_fee_${bookingId}_${payer}`;

  return {
    id: txId,
    user_id: payerUserId || null,
    type: "maintenance_fee_payment",
    status: paymentStatus,
    data: {
      id: txId,
      userId: payerUserId || null,
      type: "maintenance_fee_payment",
      amount: paymentMode === "maicoins" ? coinsUsed : Math.max(totalFee - coinsUsed, 0),
      currency: paymentMode === "maicoins" ? "MAICOIN" : "INR",
      status: paymentStatus,
      description: `Platform fee payment for ${bookingData.origin || "ride"} to ${bookingData.destination || "destination"}`,
      relatedId: bookingId,
      createdAt: new Date().toISOString(),
      metadata: {
        bookingId,
        rideId: booking.ride_id || bookingData.rideId || null,
        payer,
        payerName: payerName || null,
        paymentMode,
        gateway: gateway || (paymentMode === "online" ? "razorpay" : "manual"),
        transactionId: transactionId || null,
        orderId: orderId || null,
        receiptUrl: receiptUrl || null,
        serviceFee,
        gstAmount,
        totalFee,
        coinsUsed,
        route: `${bookingData.origin || "Unknown"} -> ${bookingData.destination || "Unknown"}`,
        ...metadata,
      },
    },
  };
}

async function recordPlatformFee(req: any, res: any) {
  try {
    await verifyTokenFromHeader(req);
    const {
      bookingId,
      payer,
      paymentMode,
      paymentStatus,
      transactionId,
      orderId,
      receiptUrl,
      gateway,
      coinsUsed,
      metadata,
    } = req.body || {};

    if (!bookingId || !payer || !paymentMode || !paymentStatus) {
      return res.status(400).json({ error: "bookingId, payer, paymentMode, and paymentStatus are required." });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!booking) {
      return res.status(404).json({ error: "Booking not found." });
    }

    const row = buildPlatformFeeTransactionRow({
      booking,
      payer,
      paymentMode,
      paymentStatus,
      transactionId,
      orderId,
      receiptUrl,
      gateway,
      coinsUsed,
      metadata,
    });

    const { error } = await supabaseAdmin.from("transactions").upsert(row, { onConflict: "id" });
    if (error) throw error;

    return res.status(200).json({ recorded: true, id: row.id });
  } catch (error: any) {
    return res.status(error?.status || 500).json({ error: error?.message || "Failed to record platform fee transaction." });
  }
}

export default async function handler(req: any, res: any) {
  const action = getAction(req);

  if (controlledPaymentDmtActions.has(action)) {
    return guardPaymentDmtAccess(req, res);
  }

  if (action === "create-live-wallet-subscription-order") {
    return createLiveMoneyWalletSubscriptionOrder(req, res);
  }

  if (action === "create-live-wallet-qr-code") {
    return createLiveMoneyWalletQrCode(req, res);
  }

  if (action === "create-razorpay-order") {
    return createRazorpayOrder(req, res);
  }

  if (action === "verify-razorpay-payment") {
    return verifyRazorpayPayment(req, res);
  }

  if (action === "record-platform-fee") {
    return recordPlatformFee(req, res);
  }

  return res.status(404).json({ error: "Payments route not found" });
}
