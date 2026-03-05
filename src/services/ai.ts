import { GoogleGenAI } from "@google/genai";

// Export models constant
export const MODELS = {
  TEXT: "gemini-3-flash-preview",
  VIDEO: "veo-3.1-fast-generate-preview",
};

// Helper to get AI client
// If key is provided, use it.
// If not, try to use the environment variable.
// If neither, it will eventually fail when called, but won't crash the app on load.
export const getAiClient = (apiKey?: string) => {
  const key = apiKey || process.env.GEMINI_API_KEY || "";
  return new GoogleGenAI({ apiKey: key });
};

// Deprecated: Default instance for backward compatibility, but safe
// We pass an empty string if no key is found to prevent constructor error
export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
