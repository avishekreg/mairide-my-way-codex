import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase admin environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function handleSubmitReview(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers?.authorization;
    if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = String(authHeader).slice("Bearer ".length);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !authData.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { bookingId, rating, comment, traits } = req.body || {};
    const normalizedRating = Number(rating);
    const normalizedTraits = Array.isArray(traits)
      ? traits
          .filter((trait) => typeof trait === "string")
          .map((trait) => trait.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];

    if (!bookingId || !Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
      return res.status(400).json({ error: "A valid booking ID and rating between 1 and 5 are required." });
    }

    const { data: bookingRow, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;
    if (!bookingRow) {
      return res.status(404).json({ error: "Booking not found." });
    }

    const bookingData = { ...((bookingRow.data as Record<string, any>) || {}) };
    const booking = {
      id: bookingRow.id,
      consumerId: bookingRow.consumer_id || bookingData.consumerId,
      driverId: bookingRow.driver_id || bookingData.driverId,
      status: bookingRow.status || bookingData.status,
      rideLifecycleStatus: bookingData.rideLifecycleStatus,
      consumerReview: bookingData.consumerReview,
      driverReview: bookingData.driverReview,
    };

    const userId = authData.user.id;
    const reviewerRole =
      userId === booking.consumerId ? "consumer" : userId === booking.driverId ? "driver" : null;

    if (!reviewerRole) {
      return res.status(403).json({ error: "You are not a participant in this booking." });
    }

    const bookingCompleted =
      booking.status === "completed" || booking.rideLifecycleStatus === "completed";
    if (!bookingCompleted) {
      return res.status(400).json({ error: "Reviews can only be submitted after the ride is completed." });
    }

    const reviewField = reviewerRole === "consumer" ? "consumerReview" : "driverReview";
    if (booking[reviewField]) {
      return res.status(400).json({ error: "You have already submitted a review for this ride." });
    }

    const targetUserId = reviewerRole === "consumer" ? booking.driverId : booking.consumerId;
    const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetProfileError) throw targetProfileError;
    if (!targetProfile) {
      return res.status(404).json({ error: "The user being reviewed could not be found." });
    }

    const now = new Date().toISOString();
    const reviewPayload = {
      rating: normalizedRating,
      comment: typeof comment === "string" ? comment.trim() : "",
      traits: normalizedTraits,
      createdAt: now,
    };

    const updatedBookingData = {
      ...bookingData,
      [reviewField]: reviewPayload,
    };

    const { error: updateBookingError } = await supabaseAdmin
      .from("bookings")
      .update({
        data: updatedBookingData,
        updated_at: now,
      })
      .eq("id", bookingId);

    if (updateBookingError) throw updateBookingError;

    const targetData = { ...((targetProfile.data as Record<string, any>) || {}) };
    const existingStats = targetData.reviewStats || {};
    const currentCount = Number(existingStats.ratingCount || 0);
    const currentAverage = Number(existingStats.averageRating || 0);
    const nextCount = currentCount + 1;
    const nextAverage = Number((((currentAverage * currentCount) + normalizedRating) / nextCount).toFixed(1));

    targetData.reviewStats = {
      averageRating: nextAverage,
      ratingCount: nextCount,
      lastReviewAt: now,
    };

    const updatePayload: Record<string, any> = {
      data: targetData,
      updated_at: now,
    };

    if (targetProfile.role === "driver") {
      updatePayload.driver_details = {
        ...((targetProfile.driver_details as Record<string, any>) || {}),
        rating: nextAverage,
      };
    }

    const { error: updateUserError } = await supabaseAdmin
      .from("users")
      .update(updatePayload)
      .eq("id", targetUserId);

    if (updateUserError) throw updateUserError;

    return res.status(200).json({
      message: "Review submitted successfully",
      review: reviewPayload,
      reviewStats: targetData.reviewStats,
    });
  } catch (error: any) {
    console.error("Error submitting ride review:", error);
    return res.status(500).json({ error: error.message || "Failed to submit review" });
  }
}
