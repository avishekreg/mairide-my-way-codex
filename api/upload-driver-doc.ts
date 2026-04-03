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

function parseDataUrlPayload(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Invalid data URL payload");
  }

  const [, contentType, base64] = match;
  return {
    contentType: contentType || "application/octet-stream",
    buffer: Buffer.from(base64, "base64"),
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = Array.isArray(req.headers?.authorization)
      ? req.headers.authorization[0]
      : req.headers?.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const accessToken = authHeader.slice("Bearer ".length);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { driverId, path, dataUrl } = req.body || {};
    if (!driverId || !path || !dataUrl) {
      return res.status(400).json({ error: "Missing driverId, path, or dataUrl" });
    }

    if (authData.user.id !== driverId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (String(path).includes("..") || String(path).includes("/")) {
      return res.status(400).json({ error: "Invalid upload path" });
    }

    const bucket = process.env.VITE_SUPABASE_STORAGE_BUCKET;
    if (!bucket) {
      throw new Error("Supabase storage bucket is not configured.");
    }

    const { contentType, buffer } = parseDataUrlPayload(String(dataUrl));
    const storagePath = `drivers/${driverId}/${path}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        upsert: true,
        contentType,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return res.status(200).json({ url: data.publicUrl });
  } catch (error: any) {
    console.error("Standalone upload driver doc failed:", error);
    return res.status(500).json({ error: error?.message || "Failed to upload driver document" });
  }
}
