import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";

// Native Gemini REST example; the SDK only needs strings/AsyncIterable<string>.
// https://ai.google.dev/gemini-api/docs/generate-content/text-generation
const MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
type TextInput = { systemPrompt: string; userPrompt: string; signal: AbortSignal; maxOutputTokens?: number };
type GeminiOutput = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]; error?: unknown };

function outputText(output: GeminiOutput): string {
  if (output.error) throw new Error("Text provider failed");
  return (output.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? "").join("");
}

async function request(input: TextInput, streaming: boolean): Promise<Response> {
  if (!process.env.GEMINI_API_KEY) throw new Error("Configure GEMINI_API_KEY for the native text adapter");
  const response = await fetch(`${BASE}/models/${MODEL}:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`, {
    method: "POST", signal: input.signal,
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: input.systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: input.userPrompt }] }],
      generationConfig: { maxOutputTokens: input.maxOutputTokens ?? 8192, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  if (!response.ok) throw new Error(`Text provider HTTP ${response.status}`);
  return response;
}

async function* stream(input: TextInput): AsyncGenerator<string> {
  const response = await request(input, true);
  if (!response.body) throw new Error("Text provider returned no stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? "" : lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const text = outputText(JSON.parse(data) as GeminiOutput);
        if (text) yield text;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export const textProvider: Pick<VideoChatHandlerOptions, "streamText" | "generateText"> = {
  streamText: (input) => ({ textStream: stream(input) }),
  generateText: async (input) => outputText(await (await request(input, false)).json() as GeminiOutput),
};
