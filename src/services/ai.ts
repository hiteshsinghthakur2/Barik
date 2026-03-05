import { GoogleGenAI } from "@google/genai";

// Initialize Gemini API
// Note: For Veo (video generation), we need to ensure we use the correct model and handling.
// The key is injected via process.env.GEMINI_API_KEY in the Vite config.

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const MODELS = {
  TEXT: "gemini-3-flash-preview",
  VIDEO: "veo-3.1-fast-generate-preview",
};
