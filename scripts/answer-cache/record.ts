import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeVideoSse } from "../../src/protocol/sse.js";
import type { VideoEvent } from "../../src/protocol/events.js";
import {
  answerMediaUrls, answerObjectKey, clipObjectKey, isCleanAnswer, parseRecordedAnswer, recordAnswer, recordedTurn,
  speechObjectKey, suggestionsObjectKey, type AnswerCacheMaterial, type RecordedAnswer,
} from "../../src/server/answer-cache.js";
import { conversationFor } from "../../src/video-chat/session-state.js";
import type { VideoChatSuggestion } from "../../src/video-chat/types.js";

/**
 * Records real local answers into an export directory laid out exactly like
 * the bucket, so publishing is a plain upload and every object is reviewable.
 */
export interface RecorderOptions {
  /** The local API origin; the loopback flag there grants the owner allowance. */
  api: string;
  exportDir: string;
  commit?: string;
  depth: 0 | 1;
  maxSuggestions: number;
  attempts: number;
  log: (message: string) => void;
  fetcher?: typeof fetch;
}

const BYPASS_HEADERS = { "x-vanillasky-answer-cache": "bypass" };

export function exportPath(exportDir: string, key: string): string {
  return join(exportDir, ...key.split("/"));
}

function writeObject(exportDir: string, key: string, bytes: Uint8Array | string): void {
  const path = exportPath(exportDir, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

export function speechObject(mediaType: string | null, body: Uint8Array): string {
  if (mediaType?.split(";")[0]?.trim().toLowerCase() === "application/json") {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { audio?: unknown; mediaType?: unknown; wordTimings?: unknown };
    if (typeof parsed.audio !== "string" || parsed.mediaType !== "audio/mpeg") throw new Error("Unexpected speech response");
    return JSON.stringify({ audio: parsed.audio, mediaType: "audio/mpeg", ...(parsed.wordTimings === undefined ? {} : { wordTimings: parsed.wordTimings }) });
  }
  if (mediaType?.split(";")[0]?.trim().toLowerCase() !== "audio/mpeg") throw new Error("Unexpected speech response");
  return JSON.stringify({ audio: Buffer.from(body).toString("base64"), mediaType: "audio/mpeg" });
}

export class AnswerRecorder {
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: RecorderOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  /** POST to the local API, honoring its per-minute admission when it throttles. */
  private async post(action: string, body: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetcher(`${this.options.api}/api/video-chat?action=${action}`, {
        method: "POST",
        headers: { origin: this.options.api, "content-type": "application/json", accept: "text/event-stream", ...BYPASS_HEADERS },
        body: JSON.stringify(body),
      });
      if (response.status !== 429 || attempt >= 5) return response;
      const wait = Math.max(1, Number(response.headers.get("retry-after")) || 60);
      await response.body?.cancel();
      this.options.log(`throttled; waiting ${wait}s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }

  private async liveAnswer(material: AnswerCacheMaterial): Promise<VideoEvent[]> {
    for (let attempt = 1; attempt <= this.options.attempts; attempt += 1) {
      const response = await this.post("response", { prompt: material.prompt, mode: "cinematic", orientation: material.orientation, conversation: material.conversation });
      if (!response.ok || !response.body) throw new Error(`Answer request failed with ${response.status}: ${await response.text()}`);
      if (response.headers.get("x-vanillasky-resolved-video-mode") !== "cinematic") throw new Error("The local API is not generating video; configure FAL_KEY in .dev.vars");
      const events: VideoEvent[] = [];
      for await (const event of decodeVideoSse(response.body)) events.push(event);
      if (isCleanAnswer(events)) return events;
      this.options.log(`attempt ${attempt} was not a clean generated answer`);
    }
    throw new Error(`No clean answer for "${material.prompt}" after ${this.options.attempts} attempts`);
  }

  private async copyClips(events: readonly VideoEvent[]): Promise<Map<string, string>> {
    const media = new Map<string, string>();
    for (const url of answerMediaUrls(events)) {
      const response = await this.fetcher(url);
      if (!response.ok) throw new Error(`Clip download failed with ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const key = clipObjectKey(createHash("sha256").update(bytes).digest("hex"));
      if (!existsSync(exportPath(this.options.exportDir, key))) writeObject(this.options.exportDir, key, bytes);
      media.set(url, key);
    }
    return media;
  }

  private async recordSpeech(lines: readonly string[]): Promise<void> {
    for (const line of new Set(lines.map((line) => line.trim()).filter(Boolean))) {
      const key = await speechObjectKey({ text: line });
      if (!key || existsSync(exportPath(this.options.exportDir, key))) continue;
      const response = await this.post("speech", { text: line });
      if (response.status === 204) { this.options.log("generated voice is not configured; speech not recorded"); return; }
      if (!response.ok) throw new Error(`Speech request failed with ${response.status}`);
      writeObject(this.options.exportDir, key, speechObject(response.headers.get("content-type"), new Uint8Array(await response.arrayBuffer())));
    }
  }

  private async recordSuggestions(material: AnswerCacheMaterial, lines: readonly string[]): Promise<VideoChatSuggestion[]> {
    const key = await suggestionsObjectKey({ prompt: material.prompt, lines });
    if (!key) return [];
    const path = exportPath(this.options.exportDir, key);
    if (!existsSync(path)) {
      const response = await this.post("suggestions", { prompt: material.prompt, lines });
      if (!response.ok) throw new Error(`Suggestions request failed with ${response.status}`);
      const payload = await response.json() as { suggestions?: VideoChatSuggestion[] };
      if (!Array.isArray(payload.suggestions) || payload.suggestions.length === 0) throw new Error("No follow-up suggestions were returned");
      writeObject(this.options.exportDir, key, JSON.stringify({ suggestions: payload.suggestions }));
    }
    return (JSON.parse(readFileSync(path, "utf8")) as { suggestions: VideoChatSuggestion[] }).suggestions;
  }

  /** Record one answer with its speech and follow-ups, reusing anything already exported. */
  async record(material: AnswerCacheMaterial, depth = this.options.depth): Promise<RecordedAnswer> {
    const key = await answerObjectKey(material);
    const path = exportPath(this.options.exportDir, key);
    let recorded: RecordedAnswer;
    if (existsSync(path)) {
      recorded = parseRecordedAnswer(JSON.parse(readFileSync(path, "utf8")));
      this.options.log(`kept "${material.prompt}" (${material.orientation})`);
    } else {
      this.options.log(`recording "${material.prompt}" (${material.orientation})`);
      const events = await this.liveAnswer(material);
      const media = await this.copyClips(events);
      recorded = recordAnswer(events, { request: material, recordedAt: new Date().toISOString(), commit: this.options.commit, media });
      writeObject(this.options.exportDir, key, JSON.stringify(recorded));
    }
    await this.recordSpeech(recorded.lines);
    const suggestions = await this.recordSuggestions(material, recorded.lines);
    if (depth === 0) return recorded;
    for (const suggestion of suggestions.slice(0, this.options.maxSuggestions)) {
      await this.record(followUpMaterial(recorded, suggestion.prompt), 0);
    }
    return recorded;
  }
}

/** A follow-up carries the conversation exactly as the client rebuilds it from the completed turn. */
export function followUpMaterial(recorded: RecordedAnswer, prompt: string): AnswerCacheMaterial {
  const { orientation } = recorded.request;
  const turn = { ...recordedTurn(recorded), id: "recorded", completed: true, orientation, fixedOrientation: true, suggestions: [] as VideoChatSuggestion[] };
  return { prompt, orientation, conversation: [...recorded.request.conversation, ...conversationFor([turn])] };
}
