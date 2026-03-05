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
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.API_KEY || "";
  return new GoogleGenAI({ apiKey: key });
};

// Helper to generate content with retry logic for 503 errors
export const generateContentWithRetry = async (client: GoogleGenAI, params: any, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await client.models.generateContent(params);
    } catch (error: any) {
      // Check for 503 Service Unavailable or "high demand"
      if (error?.status === 503 || error?.message?.includes('high demand') || error?.message?.includes('overloaded')) {
        console.warn(`Attempt ${i + 1} failed with 503/Overloaded. Retrying...`);
        if (i === retries - 1) throw error;
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to generate content after retries");
};
