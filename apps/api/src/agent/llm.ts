import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export type LLMProvider = "claude" | "ollama" | "gemini";

export function getProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER ?? "claude";
  if (provider === "ollama") return "ollama";
  if (provider === "gemini") return "gemini";
  return "claude";
}

let cachedLLM: BaseChatModel | undefined;

export function getLLM(): BaseChatModel {
  if (cachedLLM) return cachedLLM;

  const provider = getProvider();

  if (provider === "ollama") {
    cachedLLM = new ChatOllama({
      model: process.env.OLLAMA_MODEL ?? "llama3.1",
      baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      temperature: 0,
    });
  } else if (provider === "gemini") {
    cachedLLM = new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
      apiKey: process.env.GOOGLE_API_KEY,
      temperature: 0,
    });
  } else {
    cachedLLM = new ChatAnthropic({
      model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5",
      maxTokens: 1024,
    });
  }

  return cachedLLM;
}
