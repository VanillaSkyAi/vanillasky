const URL = "https://api.anthropic.com/v1/messages";
// The model and ceilings are server-owned. Requests cannot choose providers,
// models, token ceilings, generated video, or speech services.
async function call(context, env, fetcher, stream) {
  if (context.systemPrompt.length + context.userPrompt.length > 60000)
    throw new Error("Provider input limit");
  const response = await fetcher(URL, {
    method: "POST",
    redirect: "manual",
    signal: context.signal,
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": env.ANTHROPIC_API_KEY,
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: stream ? 4096 : Math.min(context.maxOutputTokens, 512),
      stream,
      system: context.systemPrompt,
      messages: [{ role: "user", content: context.userPrompt }],
    }),
  });
  if (!response.ok) {
    console.warn("video_chat_provider_failure", { provider: "anthropic", status: response.status });
    throw new Error("Provider unavailable");
  }
  return response;
}
export async function providerText(context, env, fetcher) {
  const data = await (await call(context, env, fetcher, false)).json();
  return (
    data.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("") ?? ""
  );
}
export function providerStream(context, env, fetcher, onComplete) {
  return (async function* () {
    const response = await call(context, env, fetcher, true);
    if (!response.body) throw new Error("Provider stream unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let outcome = "complete";
    let stopReason = "unknown";
    let inputTokens = 0;
    let outputTokens = 0;
    const bounded = (value, max) => Number.isFinite(value) && value >= 0 ? Math.min(max, Math.floor(value)) : 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const records = buffer.split(/\r?\n\r?\n/);
        buffer = records.pop() ?? "";
        for (const record of records) {
          const line = record
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.slice(5));
          if (event.type === "message_start") inputTokens = bounded(event.message?.usage?.input_tokens, 100000);
          if (event.type === "message_delta") {
            if (["end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal"].includes(event.delta?.stop_reason)) stopReason = event.delta.stop_reason;
            outputTokens = bounded(event.usage?.output_tokens, 4096);
          }
          if (event.type === "error") throw new Error("Provider stream failed");
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
          )
            yield event.delta.text;
        }
        if (done) break;
      }
    } catch (error) {
      outcome = context.signal?.aborted ? "canceled" : "error";
      throw error;
    } finally {
      if (context.signal?.aborted) outcome = "canceled";
      try { onComplete?.({ outcome, stopReason, inputTokens, outputTokens }); } catch { /* Diagnostics cannot alter provider output. */ }
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  })();
}
