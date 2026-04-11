import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime";

const FALLBACK_GEMINI_PROJECT_ID = "";
const FALLBACK_GEMINI_API_KEY = "";

function getSupabaseAdmin() {
  const { supabaseUrl, serviceRoleKey } = getRuntimeSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getGlobalConfig() {
  const defaults = {
    llmProvider: "gemini",
    llmModel: "gemini-1.5-pro",
    chatbotEnabled: true,
    chatbotTemperature: 0.3,
    chatbotMaxTokens: 400,
    chatbotSystemPrompt: DEFAULT_PROMPT,
    chatbotFallbackMessage: "Mai Ira is temporarily unavailable. Please use the Support section if you need urgent help.",
    chatbotDefaultLanguage: "en-IN",
    chatbotVoiceOutputEnabled: false,
    chatbotVoiceInputEnabled: true,
    chatbotTtsRate: 0.95,
    chatbotTtsPitch: 1.02,
    geminiApiKey: process.env.GEMINI_API_KEY || FALLBACK_GEMINI_API_KEY,
    geminiProjectId: process.env.GEMINI_PROJECT_ID || FALLBACK_GEMINI_PROJECT_ID,
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiProjectId: process.env.OPENAI_PROJECT_ID || "",
    openaiOrgId: process.env.OPENAI_ORG_ID || "",
    claudeApiKey: process.env.CLAUDE_API_KEY || "",
  } as Record<string, any>;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("app_config")
      .select("*")
      .eq("id", "global")
      .maybeSingle();

    if (error) throw error;

    return {
      ...defaults,
      ...(((data?.data as Record<string, any>) || {}) as Record<string, any>),
    } as Record<string, any>;
  } catch (error) {
    console.warn("Chat config fallback engaged:", error);
    return defaults;
  }
}

const DEFAULT_PROMPT =
  "You are MaiRide's official in-app assistant, Mai Ira. Speak like a warm, polite, emotionally intelligent Indian customer support specialist. Sound human, not robotic. Acknowledge user concerns briefly and then give practical next steps. Keep replies concise, clear, and supportive. Answer only about MaiRide topics: rides, pricing, booking flow, support, service regions, booking status, support tickets, and admin actions. Do not answer unrelated general knowledge questions. For non-admin users, do not provide admin actions or admin operational guidance. If the user asks for account-specific or live operational details you cannot securely verify, politely direct them to the relevant MaiRide screen or support workflow instead of guessing.";

const IRA_PERSONALITY_JSON = {
  assistant_config: {
    identity: "Ira",
    brand: "MaiRide",
    persona: "Professional, Warm, Soft-spoken (Makhmali), and Highly Intelligent.",
    language_style: "Hinglish (Natural mix of Hindi and English).",
    core_expertise: "Logistics, Empty-Leg trip optimization, and customer relationship management.",
  },
  behavioral_rules: [
    "Never start responses with 'As an AI language model' or 'I am an AI'.",
    "Address the user by name if available in the database/context.",
    "Use empathetic phrases like 'Main samajh sakti hoon' or 'Zaroor Abhishek ji'.",
    "Focus on solving the user's specific travel query: Finding empty-leg rides, pricing, or booking status.",
    "Keep replies concise yet deeply helpful and human-like.",
  ],
  example_interaction: {
    user: "Is there a car from Siliguri to Kolkata tomorrow?",
    ira_response:
      "Bilkul! Kal subah ek premium sedan Siliguri se Kolkata ke liye empty-leg par hai. Ye aapko normal fare se kaafi kam mein mil jayegi. Kya main aapke liye booking process start karun?",
  },
} as const;

function isAdminIntent(rawMessage: string) {
  const message = String(rawMessage || "").toLowerCase();
  return /(admin|super admin|verify driver|approve driver|reject driver|delete user|config|platform settings|force cancel|override|admin panel|transactions dashboard|revenue panel)/i.test(
    message
  );
}

function getHumanStyleInstruction() {
  return "Write in a natural, human, supportive way. Keep it conversational and warm, not robotic. Use short sentences and practical steps. Avoid sounding like a policy bot.";
}

async function getUserContext(userId?: string) {
  if (!userId) return { displayName: "", role: "consumer" };
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("display_name, role, data")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return {
      displayName: String(data?.display_name || data?.data?.displayName || "").trim(),
      role: String(data?.role || data?.data?.role || "consumer").toLowerCase(),
    };
  } catch {
    return { displayName: "", role: "consumer" };
  }
}

function buildGeminiSystemInstruction(config: Record<string, any>, language: string, userContext: { displayName: string; role: string }) {
  const customPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const languageInstruction = getLanguageInstruction(language);
  const humanStyleInstruction = getHumanStyleInstruction();
  const adminGuardInstruction =
    userContext.role === "admin"
      ? "User is an authenticated admin. Admin actions can be discussed."
      : "User is not an admin. Do not provide admin actions or admin panel guidance.";
  const personalizationInstruction = userContext.displayName
    ? `User name available: ${userContext.displayName}. Address respectfully when helpful.`
    : "User name is not available. Use respectful but neutral address.";

  return [
    customPrompt,
    languageInstruction,
    humanStyleInstruction,
    adminGuardInstruction,
    personalizationInstruction,
    "Inject and follow this persona JSON strictly:",
    JSON.stringify(IRA_PERSONALITY_JSON),
  ].join("\n\n");
}

function getLanguageInstruction(language?: string) {
  const normalized = String(language || "en-IN").trim().toLowerCase();
  if (normalized.startsWith("hi")) {
    return "Reply in natural Hindi suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("bn")) {
    return "Reply in natural Bengali suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("ta")) {
    return "Reply in natural Tamil suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("te")) {
    return "Reply in natural Telugu suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("mr")) {
    return "Reply in natural Marathi suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("gu")) {
    return "Reply in natural Gujarati suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("kn")) {
    return "Reply in natural Kannada suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("ml")) {
    return "Reply in natural Malayalam suitable for Indian riders and drivers.";
  }
  if (normalized.startsWith("pa")) {
    return "Reply in natural Punjabi suitable for Indian riders and drivers.";
  }
  return "Reply in Indian English with a friendly, supportive tone.";
}

function normalizeMessages(messages: any[] = []) {
  return messages
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(-8);
}

function buildStaticMaiRideReply(rawMessage: string) {
  const message = String(rawMessage || "").trim().toLowerCase();

  if (!message) {
    return "Hi, I’m Mai Ira. I can help with MaiRide rides, pricing, booking flow, support, service regions, booking status, support tickets, and admin actions.";
  }

  if (/(^|\b)(hi|hello|hey|namaste|hola)(\b|$)/.test(message)) {
    return "Hi, I’m Mai Ira. I can help with ride booking, pricing, negotiation flow, payment steps, support, and booking status.";
  }

  if (message.includes("price") || message.includes("fare") || message.includes("cost")) {
    return "MaiRide shows the listed ride fare on each offer card. Platform fee and GST are shown separately before confirmation. During negotiation, both parties can counter until one side accepts or rejects.";
  }

  if (message.includes("book") || message.includes("booking flow") || message.includes("how do i book")) {
    return "To book a ride, search available rides, open the ride card, review route and departure timing, then send a booking request or counter offer. Once one side accepts, both parties complete platform-fee payment and contact details unlock automatically.";
  }

  if (message.includes("status") || message.includes("booking status")) {
    return "You can check booking status from your active booking or ride card. Common states are pending, counter offer, confirmed, paid, started, and completed.";
  }

  if (message.includes("support") || message.includes("ticket")) {
    return "For support, please use the Support section in the app so the MaiRide team can track your issue properly. If a ride needs a forced cancellation after confirmation, customer support or admin action is required.";
  }

  if (message.includes("region") || message.includes("service area") || message.includes("service region")) {
    return "MaiRide currently supports route-based ride discovery where available offers are shown by search and timing match. If a route is not visible, it usually means there is no active approved driver offer for that route and time window.";
  }

  if (message.includes("admin")) {
    return "I can help with admin workflows only for verified admin accounts inside the Admin panel. If you’re not an admin, I can still help with rides, bookings, payments, and support.";
  }

  return "I can help with MaiRide rides, pricing, booking flow, booking status, support tickets, service regions, and admin actions. Please ask a MaiRide-specific question and I’ll help.";
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

async function callGemini(
  config: Record<string, any>,
  messages: any[],
  language?: string,
  userContext: { displayName: string; role: string } = { displayName: "", role: "consumer" }
) {
  const apiKey = String(config.geminiApiKey || FALLBACK_GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("Gemini API key is not configured.");

  const model = "gemini-1.5-pro";
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
  const systemInstruction = buildGeminiSystemInstruction(config, String(language || "en-IN"), userContext);
  const contents = messages.slice(-10).map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: String(message.content || "") }],
  }));

  const response = await ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      temperature,
      maxOutputTokens: maxTokens,
    },
  });
  const text = String(response?.text || "").trim();

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

async function callOpenAI(config: Record<string, any>, messages: any[], language?: string) {
  const apiKey = String(config.openaiApiKey || "").trim();
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const model = String(config.llmModel || "gpt-4o-mini").trim();
  const systemPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const languageInstruction = getLanguageInstruction(language);
  const humanStyleInstruction = getHumanStyleInstruction();
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
      instructions: `${systemPrompt}\n\n${languageInstruction}\n\n${humanStyleInstruction}`,
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

async function callClaude(config: Record<string, any>, messages: any[], language?: string) {
  const apiKey = String(config.claudeApiKey || "").trim();
  if (!apiKey) throw new Error("Claude API key is not configured.");

  const model = String(config.llmModel || "claude-3-5-haiku-latest").trim();
  const systemPrompt = String(config.chatbotSystemPrompt || DEFAULT_PROMPT).trim();
  const languageInstruction = getLanguageInstruction(language);
  const humanStyleInstruction = getHumanStyleInstruction();
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
      system: `${systemPrompt}\n\n${languageInstruction}\n\n${humanStyleInstruction}`,
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

async function handleUserMessage(
  userId: string,
  message: string,
  options: {
    config: Record<string, any>;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    language: string;
    userRole: string;
  }
) {
  const { config, history, language, userRole } = options;
  const userContext = await getUserContext(userId);
  const effectiveRole = userContext.role || userRole;

  if (effectiveRole !== "admin" && isAdminIntent(message)) {
    return "I can help with rides, booking, fares, status, and support. Admin actions are available only inside the verified Admin panel.";
  }

  const messages = normalizeMessages([...(history || []), { role: "user", content: message }]).slice(-10);
  const provider = String(config.llmProvider || "gemini").trim().toLowerCase();

  switch (provider) {
    case "gemini":
      return callGemini(config, messages, language, userContext);
    case "openai":
      return callOpenAI(config, messages, language);
    case "claude":
      return callClaude(config, messages, language);
    default:
      throw new Error("Unsupported LLM provider");
  }
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
    const language = String(body?.language || config.chatbotDefaultLanguage || "en-IN");
    const userRole = String(body?.userRole || "consumer").toLowerCase();
    const userId = String(body?.userId || "").trim();
    const incomingMessages = normalizeMessages(body?.messages || []);
    const message = String(body?.message || "").trim();
    const latestUserMessage =
      message || [...incomingMessages].reverse().find((entry) => entry.role === "user")?.content || "";
    if (!latestUserMessage) {
      return res.status(400).json({ error: "Missing chat message" });
    }

    let reply = "";
    try {
      reply = await handleUserMessage(userId, latestUserMessage, {
        config,
        history: incomingMessages,
        language,
        userRole,
      });
    } catch (providerError) {
      console.error("Chat provider failed, using static fallback:", providerError);
      reply = buildStaticMaiRideReply(latestUserMessage);
    }

    return res.status(200).json({ message: reply });
  } catch (error: any) {
    console.error("Chat route failed:", error);
    return res.status(500).json({
      error: error?.message || "A server error has occurred",
      message: error?.message || "Mai Ira is temporarily unavailable. Please use the Support section if you need urgent help.",
    });
  }
}
