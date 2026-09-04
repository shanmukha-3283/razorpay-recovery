import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const SAVED_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED_ENV };
  vi.resetModules();
});

async function loadLlm() {
  return await import("./llm.js");
}

describe("getProvider", () => {
  it("parses all providers and defaults unknown to claude", async () => {
    process.env.LLM_PROVIDER = "gemini";
    expect((await loadLlm()).getProvider()).toBe("gemini");

    process.env.LLM_PROVIDER = "ollama";
    expect((await loadLlm()).getProvider()).toBe("ollama");

    process.env.LLM_PROVIDER = "something-else";
    expect((await loadLlm()).getProvider()).toBe("claude");

    delete process.env.LLM_PROVIDER;
    expect((await loadLlm()).getProvider()).toBe("claude");
  });
});

describe("getLLM", () => {
  it("builds a Google model for the gemini provider", async () => {
    process.env.LLM_PROVIDER = "gemini";
    process.env.GOOGLE_API_KEY = "test-key";
    const { getLLM } = await loadLlm();
    expect(getLLM()).toBeInstanceOf(ChatGoogleGenerativeAI);
  });

  it("builds an Ollama model for the ollama provider", async () => {
    process.env.LLM_PROVIDER = "ollama";
    const { getLLM } = await loadLlm();
    expect(getLLM()).toBeInstanceOf(ChatOllama);
  });

  it("builds a Claude model by default", async () => {
    delete process.env.LLM_PROVIDER;
    process.env.ANTHROPIC_API_KEY = "test-key";
    const { getLLM } = await loadLlm();
    expect(getLLM()).toBeInstanceOf(ChatAnthropic);
  });
});
