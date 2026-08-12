import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

export const config = {
  runtime: "edge",
};

function applyCors(request: Request, headers: Headers) {
  const requestOrigin = String(request.headers.get("origin") || "").trim();
  headers.set("Access-Control-Allow-Origin", requestOrigin || "*");
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
}

function jsonResponse(request: Request, status: number, body: Record<string, unknown>) {
  const headers = new Headers({ "Content-Type": "application/json" });
  applyCors(request, headers);
  return new Response(JSON.stringify(body), { status, headers });
}

export default async function handler(request: Request) {
  if (request.method === "OPTIONS") {
    const headers = new Headers();
    applyCors(request, headers);
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "Method not allowed" });
  }

  try {
    const body = await request.json().catch(() => ({} as any));
    const email = String(body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(body?.password || "");

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email)) {
      return jsonResponse(request, 400, { error: "A valid email is required." });
    }
    if (!password) {
      return jsonResponse(request, 400, { error: "Password is required." });
    }

    const { supabaseUrl, anonKey } = getRuntimeSupabaseConfig();
    if (!supabaseUrl || !anonKey) {
      return jsonResponse(request, 500, { error: "Supabase runtime config is incomplete." });
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    let upstream: Response;
    try {
      upstream = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
    } catch (error: any) {
      const timedOut = /abort|timeout|timed out/i.test(String(error?.name || error?.message || ""));
      return jsonResponse(request, timedOut ? 504 : 500, {
        error: timedOut
          ? "Authentication service timed out. Please retry."
          : error?.message || "Failed to login",
        code: timedOut ? "AUTH_UPSTREAM_TIMEOUT" : "AUTH_LOGIN_FAILED",
        runtime: "edge",
        upstreamMs: Date.now() - started,
      });
    } finally {
      clearTimeout(timer);
    }

    const payload = await upstream.json().catch(() => ({} as any));
    if (!upstream.ok) {
      const msg =
        payload?.error_description ||
        payload?.msg ||
        payload?.error ||
        "Invalid login credentials";
      return jsonResponse(request, upstream.status || 400, {
        error: String(msg),
        runtime: "edge",
        upstreamMs: Date.now() - started,
      });
    }

    return jsonResponse(request, 200, {
      session: {
        access_token: payload?.access_token || "",
        refresh_token: payload?.refresh_token || "",
      },
      user: payload?.user || null,
      runtime: "edge",
      upstreamMs: Date.now() - started,
    });
  } catch (error: any) {
    return jsonResponse(request, 500, {
      error: error?.message || "Failed to login",
      code: "AUTH_LOGIN_FAILED",
      runtime: "edge",
    });
  }
}
