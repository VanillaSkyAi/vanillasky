import type { VideoEvent } from "./events.js";
import { VIDEO_PROTOCOL_VERSION } from "./types.js";
import { parseVideoEvent } from "./validation.js";

const VIDEO_STREAM_HEADER = "x-vanillasky-video-stream" as const;
const VIDEO_STREAM_CONTENT_TYPE = "text/event-stream; charset=utf-8" as const;

export function encodeVideoSseEvent(event: VideoEvent): string {
  const valid = parseVideoEvent(event);
  return `id: ${valid.eventId}\nevent: video\ndata: ${JSON.stringify(valid)}\n\n`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function* decodeVideoSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<VideoEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneMarker = false;

  const parseBlock = (block: string): VideoEvent | undefined => {
    const lines = block.split("\n");
    if (lines.every((line) => !line || line.startsWith(":"))) return undefined;
    let id: string | undefined;
    let eventName: string | undefined;
    const data: string[] = [];
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
      if (field === "id") id = value;
      else if (field === "event") eventName = value;
      else if (field === "data") data.push(value);
    }
    const payload = data.join("\n");
    if (payload === "[DONE]") {
      doneMarker = true;
      return undefined;
    }
    if (!payload) return undefined;
    if (doneMarker) throw new Error("Video response received an event after [DONE]");
    if (eventName && eventName !== "video") {
      throw new Error(`Unsupported SSE event ${eventName}`);
    }
    const event = parseVideoEvent(JSON.parse(payload));
    if (id && id !== event.eventId) throw new Error("SSE id does not match event.eventId");
    return event;
  };

  try {
    while (true) {
      const result = await reader.read();
      buffer += normalizeNewlines(decoder.decode(result.value, { stream: !result.done }));
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseBlock(block);
        if (event) yield event;
        boundary = buffer.indexOf("\n\n");
      }
      if (result.done) break;
    }
    if (buffer.trim()) {
      const event = parseBlock(buffer.trim());
      if (event) yield event;
    }
    if (!doneMarker) throw new Error("Video response SSE stream ended without [DONE]");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function videoSseHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Content-Type", VIDEO_STREAM_CONTENT_TYPE);
  result.set(VIDEO_STREAM_HEADER, VIDEO_PROTOCOL_VERSION);
  result.set("Cache-Control", "no-cache, no-transform");
  result.set("X-Accel-Buffering", "no");
  result.set("X-Content-Type-Options", "nosniff");
  const exposed = result.get("Access-Control-Expose-Headers");
  if (!exposed) result.set("Access-Control-Expose-Headers", VIDEO_STREAM_HEADER);
  else if (!exposed.toLowerCase().split(",").map((value) => value.trim()).includes(VIDEO_STREAM_HEADER)) {
    result.set("Access-Control-Expose-Headers", `${exposed}, ${VIDEO_STREAM_HEADER}`);
  }
  return result;
}
