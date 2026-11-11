import OpenAI from "openai";

let client: OpenAI | undefined;

/** Any OpenAI-compatible Chat Completions endpoint: OpenAI by default, or OPENAI_BASE_URL (OpenRouter, Groq, a local server...). */
export function llm(): OpenAI {
  if (!client) {
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    // local servers often need no key, but the SDK insists on one
    const apiKey = process.env.OPENAI_API_KEY || (baseURL ? "not-needed" : undefined);
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set (see .env.example)");
    client = new OpenAI({ apiKey, baseURL, maxRetries: 2 });
  }
  return client;
}

export const models = {
  get main() { return process.env.MAIN_MODEL || "gpt-5"; },
  get note() { return process.env.NOTE_MODEL || "gpt-5-mini"; },
  get judge() { return process.env.JUDGE_MODEL || process.env.MAIN_MODEL || "gpt-5"; },
};

/** Only sent when set, since many compatible providers reject the field. */
export function reasoningParams(): { reasoning_effort?: OpenAI.ReasoningEffort } {
  const effort = process.env.REASONING_EFFORT?.trim();
  return effort ? { reasoning_effort: effort as OpenAI.ReasoningEffort } : {};
}
