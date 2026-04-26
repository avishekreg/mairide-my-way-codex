import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { getRuntimeSupabaseConfig } from "./_lib/supabaseRuntime.js";

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
    chatbotFallbackMessage: "Mai Kiara is temporarily unavailable. Please use the Support section if you need urgent help.",
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
  "You are MaiRide's official in-app assistant, Mai Kiara. When referring to yourself in conversation, use only the name Kiara. Speak like a warm, polite, emotionally intelligent Indian customer support specialist. Sound human, not robotic. Acknowledge user concerns briefly and then give practical next steps. Keep replies concise, clear, and supportive. Answer only about MaiRide topics: rides, pricing, booking flow, support, service regions, booking status, support tickets, and admin actions. Do not answer unrelated general knowledge questions. For non-admin users, do not provide admin actions or admin operational guidance. If the user asks for account-specific or live operational details you cannot securely verify, politely direct them to the relevant MaiRide screen or support workflow instead of guessing.";

const IRA_PERSONALITY_JSON = {
  assistant_config: {
    identity: "Kiara",
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

function buildSystemInstruction(config: Record<string, any>, language: string, userContext: { displayName: string; role: string }) {
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

function getProviderModel(config: Record<string, any>, provider: "gemini" | "openai" | "claude") {
  const configuredModel = String(config.llmModel || "").trim();

  if (provider === "gemini") {
    if (configuredModel.toLowerCase().startsWith("gemini")) return configuredModel;
    return "gemini-1.5-pro";
  }

  if (provider === "openai") {
    if (configuredModel.toLowerCase().startsWith("gpt")) return configuredModel;
    return "gpt-4o-mini";
  }

  if (configuredModel.toLowerCase().startsWith("claude")) return configuredModel;
  return "claude-3-5-haiku-latest";
}

function hasProviderCredentials(config: Record<string, any>, provider: "gemini" | "openai" | "claude") {
  switch (provider) {
    case "gemini":
      return Boolean(String(config.geminiApiKey || process.env.GEMINI_API_KEY || "").trim());
    case "openai":
      return Boolean(String(config.openaiApiKey || process.env.OPENAI_API_KEY || "").trim());
    case "claude":
      return Boolean(String(config.claudeApiKey || process.env.CLAUDE_API_KEY || "").trim());
    default:
      return false;
  }
}

function getProviderAttemptOrder(config: Record<string, any>) {
  const selectedProvider = String(config.llmProvider || "gemini").trim().toLowerCase() as "gemini" | "openai" | "claude";
  const providers: Array<"gemini" | "openai" | "claude"> = ["gemini", "openai", "claude"];
  const orderedProviders = [selectedProvider, ...providers.filter((provider) => provider !== selectedProvider)];

  return orderedProviders.filter((provider, index, source) => {
    if (source.indexOf(provider) !== index) return false;
    return hasProviderCredentials(config, provider);
  });
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

function buildStaticMaiRideReply(rawMessage: string, language?: string) {
  const normalizedLanguage = String(language || "en-IN").trim().toLowerCase();
  const message = String(rawMessage || "").trim().toLowerCase();
  const hindi = normalizedLanguage.startsWith("hi");
  const bengali = normalizedLanguage.startsWith("bn");
  const rideSearchIntent =
    /(search|find|look\s*for|book|get)\s+(a\s+)?ride/.test(message) ||
    /ride\s+for\s+me/.test(message) ||
    /can you search/.test(message) ||
    (message.includes("from") && message.includes("to"));
  const offerRideIntent =
    /(offer|post|publish|list)\s+(a\s+)?ride/.test(message) ||
    /become\s+a\s+driver/.test(message) ||
    /go\s+online/.test(message);
  const negotiationIntent =
    /counter\s*offer|negotiat|bargain|change\s+fare|lower\s+fare|raise\s+fare/.test(message);
  const paymentIntent =
    /payment|pay|razorpay|platform fee|gst|maicoin|wallet/.test(message);
  const cancellationIntent =
    /cancel|refund|reschedul|change\s+booking|modify\s+booking/.test(message);

  if (!message) {
    if (hindi) {
      return "नमस्ते, मैं Kiara हूँ। मैं MaiRide पर ride search, booking, fare negotiation, payment, support और booking status में आपकी मदद कर सकती हूँ।";
    }
    if (bengali) {
      return "নমস্কার, আমি Kiara। আমি MaiRide-এ ride search, booking, fare negotiation, payment, support আর booking status নিয়ে সাহায্য করতে পারি।";
    }
    return "Hi, I’m Kiara. I can help with ride search, bookings, fares, negotiation, payment, support, and booking status on MaiRide.";
  }

  if (/(^|\b)(hi|hello|hey|namaste|hola)(\b|$)/.test(message)) {
    if (hindi) {
      return "नमस्ते, मैं Kiara हूँ। आप ride search, booking, pricing, negotiation, payment या support में जो भी मदद चाहें, मैं साथ हूँ।";
    }
    if (bengali) {
      return "নমস্কার, আমি Kiara। আপনি ride search, booking, pricing, negotiation, payment বা support নিয়ে যেকোনো সাহায্য চাইলে আমি আছি।";
    }
    return "Hi, I’m Kiara. I can help you search rides, compare fares, negotiate, complete payments, and track bookings on MaiRide.";
  }

  if (rideSearchIntent) {
    if (hindi) {
      return "हाँ, मैं ride search में मदद कर सकती हूँ। कृपया अपना origin, destination, journey day और seats बताइए। अगर आप traveler dashboard पर हैं, तो Request a Ride खोलकर वही details भरें और मैं next step समझा दूँगी।";
    }
    if (bengali) {
      return "হ্যাঁ, আমি ride search-এ সাহায্য করতে পারি। আপনার origin, destination, journey day আর seats জানালে আমি next step বলব। আপনি যদি traveler dashboard-এ থাকেন, তাহলে Request a Ride খুলে ওই details দিন।";
    }
    return "Yes, I can help with that. Tell me your origin, destination, journey day, and seats needed. If you are already on the traveler dashboard, open Request a Ride and enter those details, and I’ll guide you with the next step.";
  }

  if (offerRideIntent) {
    if (hindi) {
      return "अगर आप ride offer करना चाहते हैं, तो driver dashboard में Go Online या Offer a Ride flow से route, seats, fare और departure time भरें। Offer live होते ही nearby matching travelers उसे देख पाएंगे।";
    }
    if (bengali) {
      return "আপনি যদি ride offer করতে চান, driver dashboard থেকে Go Online বা Offer a Ride flow ব্যবহার করে route, seats, fare আর departure time দিন। Offer live হলে nearby matching traveler-রা সেটা দেখতে পাবে।";
    }
    return "If you want to offer a ride, use Go Online or Offer a Ride from the driver dashboard and enter your route, seats, fare, and departure time. Once the offer goes live, nearby matching travelers can see it.";
  }

  if (negotiationIntent) {
    if (hindi) {
      return "MaiRide में traveler और driver दोनों counter offer भेज सकते हैं। Negotiation तभी तक खुला रहता है जब तक एक side accept, reject या cancel न कर दे। Accept होते ही payment flow शुरू हो जाता है।";
    }
    if (bengali) {
      return "MaiRide-এ traveler আর driver দুজনেই counter offer পাঠাতে পারে। Negotiation খোলা থাকে যতক্ষণ না এক পক্ষ accept, reject বা cancel করে। Accept হলেই payment flow শুরু হয়।";
    }
    return "On MaiRide, both traveler and driver can send counter offers. Negotiation stays open until one side accepts, rejects, or cancels. Once accepted, the payment flow starts automatically.";
  }

  if (paymentIntent) {
    if (hindi) {
      return "Payment step में listed ride fare, platform fee और GST अलग दिखते हैं। कुछ flows में MaiCoins या wallet balance भी apply हो सकता है। Successful payment के बाद booking आगे बढ़ती है और contact details unlock हो जाते हैं।";
    }
    if (bengali) {
      return "Payment step-এ listed fare, platform fee আর GST আলাদা করে দেখা যায়। কিছু flow-এ MaiCoins বা wallet balance-ও apply হতে পারে। Successful payment-এর পরে booking এগোয় আর contact details unlock হয়।";
    }
    return "In the payment step, the listed fare, platform fee, and GST are shown separately. In some flows, MaiCoins or wallet balance can also apply. After successful payment, the booking moves forward and contact details unlock.";
  }

  if (cancellationIntent) {
    if (hindi) {
      return "अगर booking cancel या modify करनी है, पहले उसकी current status check करें। Pending stage में changes आसान होते हैं, लेकिन confirmed या paid ride के लिए Support team की मदद लग सकती है।";
    }
    if (bengali) {
      return "Booking cancel বা modify করতে হলে আগে current status check করুন। Pending stage-এ change সহজ হয়, কিন্তু confirmed বা paid ride-এর জন্য Support team-এর সাহায্য লাগতে পারে।";
    }
    return "If you need to cancel or modify a booking, first check its current status. Changes are easier in the pending stage, but confirmed or paid rides may need help from the Support team.";
  }

  if (message.includes("price") || message.includes("fare") || message.includes("cost")) {
    if (hindi) {
      return "MaiRide ride card पर listed fare दिखता है। Confirmation से पहले platform fee और GST अलग दिखते हैं। Negotiation तब तक चलता है जब तक एक side accept या reject न कर दे।";
    }
    if (bengali) {
      return "MaiRide ride card-এ listed fare দেখা যায়। Confirmation-এর আগে platform fee আর GST আলাদা দেখানো হয়। Negotiation চলতে থাকে যতক্ষণ না এক পক্ষ accept বা reject করে।";
    }
    return "MaiRide shows the listed ride fare on each offer card. Platform fee and GST are shown separately before confirmation. During negotiation, both parties can counter until one side accepts or rejects.";
  }

  if (message.includes("book") || message.includes("booking flow") || message.includes("how do i book")) {
    if (hindi) {
      return "Ride book करने के लिए search करें, route और departure time check करें, फिर request या counter offer भेजें। किसी एक side के accept करते ही दोनों users platform fee complete करते हैं और contact details unlock हो जाती हैं।";
    }
    if (bengali) {
      return "Ride book করতে search করুন, route আর departure time check করুন, তারপর request বা counter offer পাঠান। এক পক্ষ accept করলে দুই user platform fee complete করে এবং contact details unlock হয়ে যায়।";
    }
    return "To book a ride, search available rides, open the ride card, review route and departure timing, then send a booking request or counter offer. Once one side accepts, both parties complete platform-fee payment and contact details unlock automatically.";
  }

  if (message.includes("status") || message.includes("booking status")) {
    if (hindi) {
      return "Booking status आप अपनी active booking या ride card से देख सकते हैं। Common states हैं: pending, counter offer, confirmed, paid, started और completed।";
    }
    if (bengali) {
      return "Booking status আপনি active booking বা ride card থেকে দেখতে পারবেন। Common states হলো: pending, counter offer, confirmed, paid, started আর completed।";
    }
    return "You can check booking status from your active booking or ride card. Common states are pending, counter offer, confirmed, paid, started, and completed.";
  }

  if (message.includes("support") || message.includes("ticket")) {
    if (hindi) {
      return "Support के लिए app के Support section का उपयोग करें ताकि MaiRide team issue ठीक से track कर सके। Confirmation के बाद cancellation के लिए support या admin action की जरूरत होती है।";
    }
    if (bengali) {
      return "Support-এর জন্য app-এর Support section ব্যবহার করুন যাতে MaiRide team ঠিকভাবে issue track করতে পারে। Confirmation-এর পরে cancellation-এর জন্য support বা admin action দরকার হয়।";
    }
    return "For support, please use the Support section in the app so the MaiRide team can track your issue properly. If a ride needs a forced cancellation after confirmation, customer support or admin action is required.";
  }

  if (message.includes("region") || message.includes("service area") || message.includes("service region")) {
    return "MaiRide currently supports route-based ride discovery where available offers are shown by search and timing match. If a route is not visible, it usually means there is no active approved driver offer for that route and time window.";
  }

  if (message.includes("admin")) {
    return "I can help with admin workflows only for verified admin accounts inside the Admin panel. If you’re not an admin, I can still help with rides, bookings, payments, and support.";
  }

  if (hindi) {
    return "मैं MaiRide पर ride search, booking, fare, negotiation, payment और support में मदद कर सकती हूँ। चाहें तो आप origin-destination या booking issue सीधे लिख दीजिए।";
  }
  if (bengali) {
    return "আমি MaiRide-এ ride search, booking, fare, negotiation, payment আর support নিয়ে সাহায্য করতে পারি। চাইলে আপনি origin-destination বা booking issue সরাসরি লিখে দিন।";
  }
  return "I can help with ride search, bookings, fares, negotiation, payments, and support on MaiRide. If you want, send me your route or booking issue directly and I’ll guide you.";
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

  const model = getProviderModel(config, "gemini");
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || apiKey });
  const systemInstruction = buildSystemInstruction(config, String(language || "en-IN"), userContext);
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

async function callOpenAI(
  config: Record<string, any>,
  messages: any[],
  language?: string,
  userContext: { displayName: string; role: string } = { displayName: "", role: "consumer" }
) {
  const apiKey = String(config.openaiApiKey || "").trim();
  if (!apiKey) throw new Error("OpenAI API key is not configured.");

  const model = getProviderModel(config, "openai");
  const systemPrompt = buildSystemInstruction(config, String(language || "en-IN"), userContext);
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

async function callClaude(
  config: Record<string, any>,
  messages: any[],
  language?: string,
  userContext: { displayName: string; role: string } = { displayName: "", role: "consumer" }
) {
  const apiKey = String(config.claudeApiKey || "").trim();
  if (!apiKey) throw new Error("Claude API key is not configured.");

  const model = getProviderModel(config, "claude");
  const systemPrompt = buildSystemInstruction(config, String(language || "en-IN"), userContext);
  const temperature = Number(config.chatbotTemperature ?? 0.3);
  const maxTokens = Number(config.chatbotMaxTokens ?? 400);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.CLAUDE_API_KEY || apiKey,
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
  const providerAttemptOrder = getProviderAttemptOrder(config);

  if (!providerAttemptOrder.length) {
    throw new Error("No configured LLM provider credentials found.");
  }

  const providerErrors: string[] = [];

  for (const provider of providerAttemptOrder) {
    try {
      switch (provider) {
        case "gemini":
          return await callGemini(config, messages, language, userContext);
        case "openai":
          return await callOpenAI(config, messages, language, userContext);
        case "claude":
          return await callClaude(config, messages, language, userContext);
      }
    } catch (error: any) {
      const messageText = String(error?.message || error || "Unknown provider error");
      providerErrors.push(`${provider}: ${messageText}`);
      console.error(`Chat provider ${provider} failed:`, error);
    }
  }

  throw new Error(`All configured chat providers failed. ${providerErrors.join(" | ")}`);
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
      reply = buildStaticMaiRideReply(latestUserMessage, language);
    }

    return res.status(200).json({ message: reply });
  } catch (error: any) {
    console.error("Chat route failed:", error);
    return res.status(500).json({
      error: error?.message || "A server error has occurred",
      message: error?.message || "Mai Kiara is temporarily unavailable. Please use the Support section if you need urgent help.",
    });
  }
}
