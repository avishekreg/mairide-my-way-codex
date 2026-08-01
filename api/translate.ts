import type { Request, Response } from "express";
import { GoogleGenAI } from "@google/genai";

type TranslationPayload = {
  text?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
};

const DEFAULT_MODEL = process.env.GEMINI_TRANSLATION_MODEL || "gemini-2.5-flash";

function normalizeLanguageTag(value: string | undefined) {
  return String(value || "en").trim().toLowerCase() || "en";
}

function getApiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GOOGLE_GENAI_API_KEY ||
      ""
  ).trim();
}

export default async function translateHandler(req: Request, res: Response) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const body = (req.body || {}) as TranslationPayload;
  const text = String(body.text || "").trim();
  const sourceLanguage = normalizeLanguageTag(body.sourceLanguage);
  const targetLanguage = normalizeLanguageTag(body.targetLanguage);

  if (!text) {
    return res.status(400).json({ error: "Missing text to translate." });
  }

  if (sourceLanguage === targetLanguage) {
    return res.status(200).json({
      translatedText: text,
      sourceLanguage,
      targetLanguage,
      provider: "fallback",
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(200).json({
      translatedText: text,
      sourceLanguage,
      targetLanguage,
      provider: "fallback",
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = [
      "You are a transportation negotiation translator for the mAIRide app.",
      `Translate the user's message from ${sourceLanguage} to ${targetLanguage}.`,
      "Preserve meaning, bargaining tone, short-form transport slang, and route names.",
      "Do not add commentary, explanation, quotation marks, or labels.",
      "Return only the translated text.",
      "",
      text,
    ].join("\n");

    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: prompt,
    });

    const translatedText = String(response.text || "").trim();
    if (!translatedText) {
      return res.status(200).json({
        translatedText: text,
        sourceLanguage,
        targetLanguage,
        provider: "fallback",
      });
    }

    return res.status(200).json({
      translatedText,
      sourceLanguage,
      targetLanguage,
      provider: "gemini",
    });
  } catch (error: any) {
    console.warn("Translation fallback engaged:", error?.message || error);
    return res.status(200).json({
      translatedText: text,
      sourceLanguage,
      targetLanguage,
      provider: "fallback",
    });
  }
}
