import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server";

describe("bounded video chat transport", () => {
  it("stops reading a streamed body as soon as its byte budget is exceeded", async () => {
    const cancel = vi.fn(); let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (++reads > 100) controller.close(); else controller.enqueue(new Uint8Array(8)); }, cancel,
    });
    const generateText = vi.fn(() => "");
    const handler = createVideoChatHandler({ authorize: "none", maxBodyBytes: 16, generateText, streamText: async function* () {} });
    const request = new Request("https://app.test/video?action=response", { method: "POST", body, duplex: "half" } as RequestInit);
    expect((await handler(request)).status).toBe(413);
    expect(reads).toBeLessThanOrEqual(4);
    expect(cancel).toHaveBeenCalledOnce();
    expect(generateText).not.toHaveBeenCalled();
  });
  it("applies the byte budget to recorded audio as it arrives", async () => {
    const cancel = vi.fn(); let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (++reads > 100) controller.close(); else controller.enqueue(new Uint8Array(8)); }, cancel,
    });
    const transcribe = vi.fn(() => "");
    const handler = createVideoChatHandler({ authorize: "none", maxAudioBytes: 16, transcribe, generateText: () => "", streamText: async function* () {} });
    expect((await handler(new Request("https://app.test/video?action=transcription", { method: "POST", body, duplex: "half" } as RequestInit))).status).toBe(413);
    expect(reads).toBeLessThanOrEqual(4);
    expect(cancel).toHaveBeenCalledOnce(); expect(transcribe).not.toHaveBeenCalled();
  });
});
