import type { VideoChatHandlerOptions } from "@vanillaskyai/video/server";

// Native Gemini REST example; the SDK only needs strings/AsyncIterable<string>.
// https://ai.google.dev/gemini-api/docs/generate-content/text-generation
const MODEL = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";
type TextInput = { systemPrompt: string; userPrompt: string; signal: AbortSignal; maxOutputTokens?: number };
type GeminiOutput = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: unknown;
};
type Completion = { finishReason: "stop" | "length" | "content-filter" | "error"; rawFinishReason?: string };

function completion(output: GeminiOutput): Completion | undefined {
  const raw = output.promptFeedback?.blockReason ?? output.candidates?.[0]?.finishReason;
  if (!raw) return undefined;
  const filtered = output.promptFeedback?.blockReason || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"].includes(raw);
  return { rawFinishReason: raw, finishReason: filtered ? "content-filter" : raw === "STOP" ? "stop" : raw === "MAX_TOKENS" ? "length" : "error" };
}

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

async function* stream(input: TextInput, settle: (value: Completion) => void): AsyncGenerator<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const decoder = new TextDecoder();
  let pending = "";
  try {
    const response = await request(input, true);
    if (!response.body) throw new Error("Text provider returned no stream");
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = done ? "" : lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        const output = JSON.parse(data) as GeminiOutput;
        const text = outputText(output);
        const finished = completion(output);
        if (finished) settle(finished);
        if (text) yield text;
        if (finished) return;
      }
      if (done) break;
    }
  } finally {
    // Also settle transport errors, missing terminal events and iterator close.
    // Promises resolve (never reject together) so diagnostics cannot hang or
    // create unhandled rejections when the text iterator itself fails.
    settle({ finishReason: "error" });
    void reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export const textProvider: Pick<VideoChatHandlerOptions, "streamText" | "generateText"> = {
  streamText: (input) => {
    let settle!: (value: Completion) => void;
    const finished = new Promise<Completion>(resolve => { settle = resolve; });
    const iterator = stream(input, settle);
    // An async generator's finally does not run when closed before first next().
    const textStream: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({
      next: () => iterator.next(),
      return: () => { settle({ finishReason: "error" }); return iterator.return(undefined); },
    }) };
    return { textStream, finishReason: finished.then(value => value.finishReason),
      rawFinishReason: finished.then(value => value.rawFinishReason) };
  },
  generateText: async (input) => {
    const output = await (await request(input, false)).json() as GeminiOutput;
    if (completion(output)?.finishReason !== "stop") throw new Error("Text provider did not return a complete unblocked answer");
    return outputText(output);
  },
};
