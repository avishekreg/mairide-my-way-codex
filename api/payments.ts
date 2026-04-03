import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { verifyTokenFromHeader } from "./_lib/backend.ts";

function getAction(req: any) {
  const fromQuery = req.query?.action;
  if (Array.isArray(fromQuery)) return fromQuery[0];
  if (typeof fromQuery === "string") return fromQuery;
  return req.body?.action || "";
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function createRazorpayOrder(req: any, res: any) {
  try {
    await verifyTokenFromHeader(req.headers.authorization);
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
    await verifyTokenFromHeader(req.headers.authorization);
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
  paymentMode: "maicoins" | "online";
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
  const serviceFee = Number(bookingData.serviceFee || 0);
  const gstAmount = Number(bookingData.gstAmount || 0);
  const totalFee = serviceFee + gstAmount;
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
      amount: paymentMode === "maicoins" ? coinsUsed : totalFee,
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
    await verifyTokenFromHeader(req.headers.authorization);
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
