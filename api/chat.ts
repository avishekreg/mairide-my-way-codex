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

async function getGlobalConfig() {
  const { data, error } = await getSupabaseAdmin()
    .from("app_config")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  if (error) throw error;

  return {
    llmProvider: "gemini",
    llmModel: "gemini-2.5-flash",
    chatbotEnabled: true,
    chatbotTemperature: 0.3,
    chatbotMaxTokens: 400,
    chatbotSystemPrompt: DEFAULT_PROMPT,
    chatbotFallbackMessage: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiProjectId: process.env.GEMINI_PROJECT_ID || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiProjectId: process.env.OPENAI_PROJECT_ID || "",
    openaiOrgId: process.env.OPENAI_ORG_ID || "",
    claudeApiKey: process.env.CLAUDE_API_KEY || "",
    ...(((data?.data as Record<string, any>) || {}) as Record<string, any>),
  } as Record<string, any>;
}

const DEFAULT_PROMPT =
  "You are MaiRide's official in-app assistant. Answer only about MaiRide topics: rides, pricing, booking flow, support, service regions, booking status, support tickets, and admin actions. Do not answer unrelated general knowledge questions. If the user asks for account-specific or live operational details you cannot securely verify, politely direct them to the relevant MaiRide screen or support workflow instead of guessing. Keep responses concise, helpful, and action-oriented.";

function normalizeMessages(messages: any[] = []) {
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-8);
}

async function parseRequestBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

async function callGemini(config: Record<string, any>, messages: any[]) {
  const apiKey = String(config.geminiApiKey || "").trim();
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const model = String(config.llmModel || "gemini-2.5-flash").trim();
  const systemPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Gemini request failed");
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || "").join("").trim() || "";

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

async function callOpenAI(config: Record<string, any>, messages: any[]) {
  const apiKey = String(config.openaiApiKey || "").trim();
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const model = String(config.llmModel || "gpt-4o-mini").trim();
  const systemPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (config.openaiProjectId) headers["OpenAI-Project"] = String(config.openaiProjectId);
  if (config.openaiOrgId) headers["OpenAI-Organization"] = String(config.openaiOrgId);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      instructions: systemPrompt,
      input: messages.map((message) => ({
        role: message.role,
        content: [{ type: "input_text", text: message.content }],
      })),
      temperature,
      max_output_tokens: maxTokens,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenAI request failed");
  }

  const text =
    data?.output_text ||
    data?.output?.flatMap((item: any) => item?.content || []).map((part: any) => part?.text || "").join("").trim() ||
    "";

  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

async function callClaude(config: Record<string, any>, messages: any[]) {
  const apiKey = String(config.claudeApiKey || "").trim();
  if (!apiKey) throw new Error("Claude API key is not configured.");

  const model = String(config.llmModel || "claude-3-5-haiku-latest").trim();
  const systemPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      max_tokens: maxTokens,
      temperature,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || "Claude request failed");
  }

  const text = (data?.content || []).map((part: any) => part?.text || "").join("").trim();
  if (!text) throw new Error("Claude returned an empty response.");
  return text;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const config = await getGlobalConfig();
    if (config.chatbotEnabled === false || config.llmProvider === "disabled") {
      return res.status(503).json({
        error: "Chatbot is disabled",
        message: config.chatbotFallbackMessage || "The MaiRide assistant is currently unavailable.",
      });
    }

    const body = await parseRequestBody(req);
    const incomingMessages = normalizeMessages(body?.messages || []);
    const message = String(body?.message || "").trim();
    const messages =
      incomingMessages.length > 0
        ? incomingMessages
        : message
          ? [{ role: "user", content: message }]
          : [];

    if (!messages.length) {
      return res.status(400).json({ error: "Missing chat message" });
    }

    const provider = String(config.llmProvider || "gemini").trim().toLowerCase();
    let reply = "";

    switch (provider) {
      case "gemini":
        reply = await callGemini(config, messages);
        break;
      case "openai":
        reply = await callOpenAI(config, messages);
        break;
      case "claude":
        reply = await callClaude(config, messages);
        break;
      default:
        return res.status(400).json({ error: "Unsupported LLM provider" });
    }

    return res.status(200).json({ message: reply });
  } catch (error: any) {
    console.error("Chat route failed:", error);
    return res.status(500).json({
      error: error?.message || "A server error has occurred",
      message: error?.message || "I'm sorry, I'm having trouble connecting right now. Please try again later.",
    });
  }
}
