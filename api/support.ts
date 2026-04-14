import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAction(req: any) {
  const action = req.query?.action;
  if (typeof action === "string") return action;
  if (Array.isArray(action) && action[0]) return action[0];
  return req.body?.action || "";
}

function getAuthHeader(req: any) {
  return Array.isArray(req.headers?.authorization)
    ? req.headers.authorization[0]
    : req.headers?.authorization;
}

function normalizeTicket(row: any) {
  const data = (row?.data as Record<string, any>) || {};
  return {
    id: row.id,
    userId: row.user_id || data.userId || "",
    userName: data.userName || "",
    userEmail: data.userEmail || "",
    subject: data.subject || "",
    message: data.message || "",
    status: row.status || data.status || "open",
    priority: row.priority || data.priority || "medium",
    responses: Array.isArray(data.responses) ? data.responses : [],
    feedback: data.feedback || undefined,
    createdAt: row.created_at || data.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || data.updatedAt || row.created_at || new Date().toISOString(),
  };
}

async function getRequestIdentity(req: any) {
  const authHeader = getAuthHeader(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const supabaseAdmin = getSupabaseAdmin();
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

  if (authError || !authData.user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  return {
    supabaseAdmin,
    authUser: authData.user,
    profile,
    isAdmin: profile.role === "admin",
  };
}

async function listTickets(req: any, res: any) {
  const identity = await getRequestIdentity(req);
  const includeAll = Boolean(req.query?.all) || Boolean(req.body?.all);

  const query = identity.supabaseAdmin
    .from("support_tickets")
    .select("*")
    .order("updated_at", { ascending: false });

  if (!identity.isAdmin || !includeAll) {
    query.eq("user_id", identity.authUser.id);
  }

  const { data, error } = await query;
  if (error) throw error;

  return res.status(200).json({ tickets: (data || []).map(normalizeTicket) });
}

async function createTicket(req: any, res: any) {
  const identity = await getRequestIdentity(req);
  const { subject, message, priority } = req.body || {};
  const normalizedSubject = String(subject || "").trim();
  const normalizedMessage = String(message || "").trim();
  const normalizedPriority = ["low", "medium", "high"].includes(String(priority || ""))
    ? String(priority)
    : "medium";

  if (!normalizedSubject || !normalizedMessage) {
    return res.status(400).json({ error: "Subject and message are required." });
  }

  const now = new Date().toISOString();
  const id = `${identity.authUser.id}-${Date.now()}`;
  const payload = {
    id,
    user_id: identity.authUser.id,
    status: "open",
    priority: normalizedPriority,
    updated_at: now,
    data: {
      id,
      userId: identity.authUser.id,
      userName: identity.profile.display_name || identity.profile.data?.displayName || "User",
      userEmail: identity.profile.email || identity.authUser.email || "",
      subject: normalizedSubject,
      message: normalizedMessage,
      status: "open",
      priority: normalizedPriority,
      responses: [],
      createdAt: now,
      updatedAt: now,
    },
  };

  const { data, error } = await identity.supabaseAdmin
    .from("support_tickets")
    .upsert(payload, { onConflict: "id" })
    .select("*")
    .single();

  if (error) throw error;
  return res.status(200).json({ ticket: normalizeTicket(data) });
}

async function respondTicket(req: any, res: any) {
  const identity = await getRequestIdentity(req);
  const { ticketId, message } = req.body || {};
  const normalizedTicketId = String(ticketId || "").trim();
  const normalizedMessage = String(message || "").trim();

  if (!normalizedTicketId || !normalizedMessage) {
    return res.status(400).json({ error: "ticketId and message are required." });
  }

  const { data: row, error: fetchError } = await identity.supabaseAdmin
    .from("support_tickets")
    .select("*")
    .eq("id", normalizedTicketId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!row) return res.status(404).json({ error: "Ticket not found." });

  const ticket = normalizeTicket(row);
  const isOwner = ticket.userId === identity.authUser.id;
  if (!identity.isAdmin && !isOwner) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const now = new Date().toISOString();
  const response = {
    senderId: identity.authUser.id,
    senderName: identity.isAdmin ? "MaiRide Support" : (identity.profile.display_name || identity.profile.data?.displayName || "User"),
    message: normalizedMessage,
    createdAt: now,
  };
  const nextResponses = [...(ticket.responses || []), response];
  const nextStatus = identity.isAdmin ? "in-progress" : ticket.status;

  const { data: updated, error: updateError } = await identity.supabaseAdmin
    .from("support_tickets")
    .update({
      status: nextStatus,
      updated_at: now,
      data: {
        ...(row.data || {}),
        responses: nextResponses,
        status: nextStatus,
        updatedAt: now,
      },
    })
    .eq("id", normalizedTicketId)
    .select("*")
    .single();

  if (updateError) throw updateError;
  return res.status(200).json({ ticket: normalizeTicket(updated) });
}

async function updateTicketStatus(req: any, res: any) {
  const identity = await getRequestIdentity(req);
  if (!identity.isAdmin) {
    return res.status(403).json({ error: "Forbidden: Admin access required" });
  }

  const { ticketId, status } = req.body || {};
  const normalizedTicketId = String(ticketId || "").trim();
  const normalizedStatus = String(status || "").trim();
  if (!normalizedTicketId || !["open", "in-progress", "resolved", "closed"].includes(normalizedStatus)) {
    return res.status(400).json({ error: "ticketId and valid status are required." });
  }

  const now = new Date().toISOString();
  const { data: row, error: fetchError } = await identity.supabaseAdmin
    .from("support_tickets")
    .select("*")
    .eq("id", normalizedTicketId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!row) return res.status(404).json({ error: "Ticket not found." });

  const { data: updated, error: updateError } = await identity.supabaseAdmin
    .from("support_tickets")
    .update({
      status: normalizedStatus,
      updated_at: now,
      data: {
        ...(row.data || {}),
        status: normalizedStatus,
        updatedAt: now,
      },
    })
    .eq("id", normalizedTicketId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return res.status(200).json({ ticket: normalizeTicket(updated) });
}

async function submitFeedback(req: any, res: any) {
  const identity = await getRequestIdentity(req);
  const { ticketId, rating, tags, comment } = req.body || {};
  const normalizedTicketId = String(ticketId || "").trim();
  const normalizedRating = Number(rating);
  const normalizedTags = Array.isArray(tags)
    ? tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
    : [];
  const normalizedComment = String(comment || "").trim();

  if (!normalizedTicketId || !Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    return res.status(400).json({ error: "ticketId and rating (1-5) are required." });
  }

  const { data: row, error: fetchError } = await identity.supabaseAdmin
    .from("support_tickets")
    .select("*")
    .eq("id", normalizedTicketId)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!row) return res.status(404).json({ error: "Ticket not found." });

  const ticket = normalizeTicket(row);
  if (ticket.userId !== identity.authUser.id) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const now = new Date().toISOString();
  const feedback = {
    rating: normalizedRating,
    tags: normalizedTags,
    comment: normalizedComment,
    createdAt: now,
  };

  const { data: updated, error: updateError } = await identity.supabaseAdmin
    .from("support_tickets")
    .update({
      updated_at: now,
      data: {
        ...(row.data || {}),
        feedback,
        updatedAt: now,
      },
    })
    .eq("id", normalizedTicketId)
    .select("*")
    .single();
  if (updateError) throw updateError;

  return res.status(200).json({ ticket: normalizeTicket(updated) });
}

export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  try {
    const action = getAction(req);

    if (action === "list-tickets" && req.method === "GET") return listTickets(req, res);
    if (action === "create-ticket" && req.method === "POST") return createTicket(req, res);
    if (action === "respond-ticket" && req.method === "POST") return respondTicket(req, res);
    if (action === "update-ticket-status" && req.method === "POST") return updateTicketStatus(req, res);
    if (action === "submit-ticket-feedback" && req.method === "POST") return submitFeedback(req, res);

    return res.status(404).json({ error: "Support route not found" });
  } catch (error: any) {
    console.error("Support API error:", error);
    return res.status(error?.status || 500).json({
      error: error?.message || "A server error has occurred",
    });
  }
}
