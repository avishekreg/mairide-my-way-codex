import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

type ReqLike = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
  body?: any;
};

type ResLike = {
  setHeader?: (key: string, value: string) => void;
  status: (code: number) => ResLike;
  json: (payload: any) => void;
};

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAction(req: ReqLike) {
  const action = req.query?.action;
  if (typeof action === "string") return action;
  if (Array.isArray(action) && action[0]) return action[0];
  return "";
}

function getAuthHeader(req: ReqLike) {
  return Array.isArray(req.headers?.authorization)
    ? req.headers?.authorization?.[0]
    : req.headers?.authorization;
}

async function getOptionalAuthUser(req: ReqLike, supabaseAdmin: ReturnType<typeof getSupabaseAdmin>) {
  const authHeader = getAuthHeader(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function getAuthenticatedAdmin(req: ReqLike, supabaseAdmin: ReturnType<typeof getSupabaseAdmin>) {
  const authHeader = getAuthHeader(req);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const token = authHeader.slice("Bearer ".length);
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return { error: { status: 401, message: "Unauthorized" } };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!profile || profile.role !== "admin") {
    return { error: { status: 403, message: "Forbidden: Admin access required" } };
  }

  return { user: authData.user, profile };
}

function decodeDataUrl(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid verification document payload.");
  }

  return {
    mimeType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64"),
  };
}

function sanitizeEmail(email: string) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function sanitizeFileExtension(fileName: string, mimeType: string) {
  const fileExtension = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  if (fileExtension && /^[a-z0-9]{1,8}$/.test(fileExtension)) {
    return fileExtension;
  }

  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "jpg";
}

function normalizePartnerRow(row: any) {
  return {
    id: String(row.id),
    authUserId: row.auth_user_id || null,
    businessName: String(row.business_name || ""),
    type: row.type,
    gstNumber: row.gst_number || null,
    contactPerson: String(row.contact_person || ""),
    phone: String(row.phone || ""),
    email: String(row.email || ""),
    documentUrl: String(row.document_url || ""),
    signupLatitude: row.signup_latitude == null ? null : Number(row.signup_latitude),
    signupLongitude: row.signup_longitude == null ? null : Number(row.signup_longitude),
    commissionPercentage: Number(row.commission_percentage || 0),
    razorpayLinkedAccountId: row.razorpay_linked_account_id || null,
    status: row.status || "pending",
    verifiedAt: row.verified_at || null,
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || row.created_at || new Date().toISOString()),
    data: row.data && typeof row.data === "object" ? row.data : {},
  };
}

async function handleSubmitApplication(req: ReqLike, res: ResLike) {
  const supabaseAdmin = getSupabaseAdmin();
  const authUser = await getOptionalAuthUser(req, supabaseAdmin);
  const body = req.body || {};

  const partnerType = String(body.partnerType || "").trim();
  const businessName = String(body.businessName || "").trim();
  const contactPerson = String(body.contactPerson || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || authUser?.email || "").trim().toLowerCase();
  const gstNumber = String(body.gstNumber || "").trim() || null;
  const documentDataUrl = String(body.documentDataUrl || "").trim();
  const documentName = String(body.documentName || "").trim();
  const signupLatitude = body.signupLatitude == null ? null : Number(body.signupLatitude);
  const signupLongitude = body.signupLongitude == null ? null : Number(body.signupLongitude);

  if (!["fleet_owner", "hotel_partner"].includes(partnerType)) {
    return res.status(400).json({ error: "Invalid partner type." });
  }
  if (!businessName || !contactPerson || !phone || !email || !documentDataUrl || !documentName) {
    return res.status(400).json({ error: "Please complete all required business details and upload a verification document." });
  }

  const { mimeType, buffer } = decodeDataUrl(documentDataUrl);
  const extension = sanitizeFileExtension(documentName, mimeType);
  const bucket = String(process.env.VITE_SUPABASE_STORAGE_BUCKET || "mairide-assets").trim() || "mairide-assets";
  const safeEmail = sanitizeEmail(email);
  const documentPath = `b2b-partners/${partnerType}/${safeEmail}-${Date.now()}.${extension}`;

  const uploadResult = await supabaseAdmin.storage.from(bucket).upload(documentPath, buffer, {
    upsert: true,
    contentType: mimeType,
  });
  if (uploadResult.error) {
    return res.status(500).json({ error: uploadResult.error.message || "Failed to upload verification document." });
  }

  const publicUrlResult = supabaseAdmin.storage.from(bucket).getPublicUrl(documentPath);
  const documentUrl = String(publicUrlResult.data.publicUrl || "").trim();
  if (!documentUrl) {
    return res.status(500).json({ error: "Verification document URL could not be generated." });
  }

  const { data: existingPartner, error: existingError } = await supabaseAdmin
    .from("b2b_partners")
    .select("*")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return res.status(500).json({ error: existingError.message || "Failed to check existing partner records." });
  }

  const writePayload = {
    auth_user_id: authUser?.id || existingPartner?.auth_user_id || null,
    business_name: businessName,
    type: partnerType,
    gst_number: gstNumber,
    contact_person: contactPerson,
    phone,
    email,
    document_url: documentUrl,
    signup_latitude: Number.isFinite(signupLatitude) ? signupLatitude : null,
    signup_longitude: Number.isFinite(signupLongitude) ? signupLongitude : null,
    status: "pending",
    verified_at: null,
  };

  if (existingPartner?.status === "approved") {
    return res.status(409).json({ error: "This business is already approved. Please sign in to the partner workspace." });
  }

  const writeResult = existingPartner?.id
    ? await supabaseAdmin.from("b2b_partners").update(writePayload).eq("id", existingPartner.id).select("*").single()
    : await supabaseAdmin.from("b2b_partners").insert(writePayload).select("*").single();

  if (writeResult.error || !writeResult.data) {
    return res.status(500).json({ error: writeResult.error?.message || "Failed to submit partner application." });
  }

  return res.status(200).json({
    partner: normalizePartnerRow(writeResult.data),
  });
}

async function handleListPartners(req: ReqLike, res: ResLike) {
  const supabaseAdmin = getSupabaseAdmin();
  const admin = await getAuthenticatedAdmin(req, supabaseAdmin);
  if ("error" in admin) {
    return res.status(admin.error.status).json({ error: admin.error.message });
  }

  const { data, error } = await supabaseAdmin
    .from("b2b_partners")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message || "Failed to load partner list." });
  }

  return res.status(200).json({ partners: (data || []).map(normalizePartnerRow) });
}

async function handleUpdateStatus(req: ReqLike, res: ResLike) {
  const supabaseAdmin = getSupabaseAdmin();
  const admin = await getAuthenticatedAdmin(req, supabaseAdmin);
  if ("error" in admin) {
    return res.status(admin.error.status).json({ error: admin.error.message });
  }

  const partnerId = String(req.body?.partnerId || "").trim();
  const status = String(req.body?.status || "").trim();
  if (!partnerId || !["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid partner status request." });
  }

  const { data, error } = await supabaseAdmin
    .from("b2b_partners")
    .update({
      status,
      verified_at: status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", partnerId)
    .select("*")
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message || "Failed to update partner status." });
  }

  return res.status(200).json({ partner: normalizePartnerRow(data) });
}

export default async function partnerHandler(req: ReqLike, res: ResLike) {
  try {
    const action = getAction(req);

    if (req.method === "POST" && action === "submit-application") {
      return await handleSubmitApplication(req, res);
    }

    if (req.method === "GET" && action === "list") {
      return await handleListPartners(req, res);
    }

    if (req.method === "POST" && action === "set-status") {
      return await handleUpdateStatus(req, res);
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error: any) {
    return res.status(500).json({
      error: String(error?.message || "Unexpected partner API error."),
    });
  }
}
