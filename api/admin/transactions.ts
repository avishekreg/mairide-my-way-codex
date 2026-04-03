import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function requireAdminStaff(req: any, res: any) {
  const authHeader = Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const configuredSuperAdmin = String(process.env.VITE_SUPER_ADMIN_EMAIL || "").toLowerCase();
  const effectiveRole =
    profile?.admin_role ||
    profile?.data?.adminRole ||
    (authData.user.email && configuredSuperAdmin && authData.user.email.toLowerCase() === configuredSuperAdmin
      ? "super_admin"
      : null);

  if (!profile || profile.role !== "admin" || !effectiveRole) {
    res.status(403).json({ error: "Forbidden: Admin access required" });
    return null;
  }

  return { user: authData.user, profile };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const auth = await requireAdminStaff(req, res);
    if (!auth) return;

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("transactions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const existing = data || [];
    const existingIds = new Set(existing.map((row: any) => row.id));

    const { data: bookingRows, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });

    if (bookingError) throw bookingError;

    const synthesizedRows: any[] = [];
    for (const booking of bookingRows || []) {
      const bookingData = (booking.data as Record<string, any>) || {};
      const serviceFee = Number(bookingData.serviceFee || 0);
      const gstAmount = Number(bookingData.gstAmount || 0);
      const totalFee = serviceFee + gstAmount;

      const maybeBuildRow = (payer: "consumer" | "driver") => {
        const isConsumer = payer === "consumer";
        const paid = isConsumer ? bookingData.feePaid : bookingData.driverFeePaid;
        const paymentMode = isConsumer ? bookingData.consumerPaymentMode : bookingData.driverPaymentMode;
        if (!paid || !paymentMode) return null;

        const txId = `platform_fee_${booking.id}_${payer}`;
        if (existingIds.has(txId)) return null;

        return {
          id: txId,
          user_id: isConsumer ? booking.consumer_id || bookingData.consumerId : booking.driver_id || bookingData.driverId,
          type: "maintenance_fee_payment",
          status: bookingData.paymentStatus === "proof_submitted" ? "pending" : "completed",
          data: {
            id: txId,
            userId: isConsumer ? booking.consumer_id || bookingData.consumerId : booking.driver_id || bookingData.driverId,
            type: "maintenance_fee_payment",
            amount: paymentMode === "maicoins"
              ? Number(isConsumer ? bookingData.maiCoinsUsed || 0 : bookingData.driverMaiCoinsUsed || 0)
              : totalFee,
            currency: paymentMode === "maicoins" ? "MAICOIN" : "INR",
            status: bookingData.paymentStatus === "proof_submitted" ? "pending" : "completed",
            description: `Platform fee payment for ${bookingData.origin || "ride"} to ${bookingData.destination || "destination"}`,
            relatedId: booking.id,
            createdAt: isConsumer
              ? bookingData.consumerPaymentSubmittedAt || booking.created_at
              : bookingData.driverPaymentSubmittedAt || booking.created_at,
            metadata: {
              bookingId: booking.id,
              rideId: booking.ride_id || bookingData.rideId || null,
              payer,
              payerName: isConsumer ? bookingData.consumerName || null : bookingData.driverName || null,
              paymentMode,
              gateway: isConsumer
                ? bookingData.consumerPaymentGateway || (paymentMode === "online" ? "razorpay" : "manual")
                : bookingData.driverPaymentGateway || (paymentMode === "online" ? "razorpay" : "manual"),
              transactionId: isConsumer ? bookingData.consumerPaymentTransactionId || null : bookingData.driverPaymentTransactionId || null,
              orderId: isConsumer ? bookingData.consumerPaymentOrderId || null : bookingData.driverPaymentOrderId || null,
              receiptUrl: isConsumer ? bookingData.consumerPaymentReceiptUrl || null : bookingData.driverPaymentReceiptUrl || null,
              serviceFee,
              gstAmount,
              totalFee,
              coinsUsed: paymentMode === "maicoins"
                ? Number(isConsumer ? bookingData.maiCoinsUsed || 0 : bookingData.driverMaiCoinsUsed || 0)
                : 0,
              route: `${bookingData.origin || "Unknown"} -> ${bookingData.destination || "Unknown"}`,
            },
          },
        };
      };

      const consumerRow = maybeBuildRow("consumer");
      if (consumerRow) {
        synthesizedRows.push(consumerRow);
        existingIds.add(consumerRow.id);
      }

      const driverRow = maybeBuildRow("driver");
      if (driverRow) {
        synthesizedRows.push(driverRow);
        existingIds.add(driverRow.id);
      }
    }

    const allRows = [...existing, ...synthesizedRows].sort(
      (a: any, b: any) =>
        new Date(b.created_at || b.data?.createdAt || 0).getTime() -
        new Date(a.created_at || a.data?.createdAt || 0).getTime()
    );

    const transactions = allRows.map((row: any) => ({
      ...((row.data as Record<string, any>) || {}),
      id: row.id,
      userId: row.user_id ?? row.data?.userId ?? null,
      type: row.type ?? row.data?.type ?? null,
      status: row.status ?? row.data?.status ?? null,
      createdAt: row.created_at ?? row.data?.createdAt ?? null,
      updatedAt: row.updated_at ?? row.data?.updatedAt ?? null,
    }));

    return res.status(200).json({ transactions });
  } catch (error: any) {
    console.error("Standalone admin transactions failed:", error);
    return res.status(500).json({ error: error?.message || "Failed to fetch transactions" });
  }
}
