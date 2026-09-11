import type { VideoEvent } from "../protocol/events.js";
import type { Video, VideoOrientation } from "../protocol/types.js";
import { checksumVideo } from "../protocol/checksum.js";
import { stableJson } from "../protocol/stable-json.js";
import { parseVideoEvent } from "../protocol/validation.js";
import { parseVideo } from "../protocol/persistence.js";
import { chooseAnswerMusic, createMusicAudio, getMusicTrack, type MusicPreference } from "../music-catalog.js";
import type { VideoChatConversationTurn } from "../video-chat/types.js";
import { parseResponseRequest, parseSpeechRequest, parseSuggestionsRequest } from "./video-chat-input.js";

/**
 * Owner-recorded answers replayed for identical public requests.
 *
 * A recording is the decoded outer event stream of one real answer, with its
 * generated clips copied behind the application's own media route. Replay
 * rewrites only what a live answer would decide per request: media origin,
 * the viewer's soundtrack preference and the snapshot checksum.
 */
const RECORDED_ANSWER_VERSION = 1;
const MEDIA_ROUTE = "/api/media/";
export const MAX_RECORDED_ANSWER_BYTES = 512_000;
export const MAX_CACHED_SPEECH_BYTES = 2_000_000;
const MAX_RECORDED_EVENTS = 200;
const OPENING_EVENT = "data.video-chat-opening";

export interface AnswerCacheMaterial {
  prompt: string;
  orientation: VideoOrientation;
  conversation: VideoChatConversationTurn[];
}

export interface RecordedAnswer {
  version: typeof RECORDED_ANSWER_VERSION;
  recordedAt: string;
  commit?: string;
  request: AnswerCacheMaterial;
  /** Exactly what the client sends to `suggestions` after this answer. */
  lines: string[];
  events: VideoEvent[];
}

export interface ReplayMusic {
  preference?: MusicPreference;
  initialTrackId?: string;
  previousTrackId?: string;
}

/** The request fields a recording answers; null when the request cannot be served from a recording. */
export function answerCacheMaterial(body: unknown): AnswerCacheMaterial | null {
  let parsed;
  try { parsed = parseResponseRequest(body); } catch { return null; }
  // A supplied opening or style changes the answer; Pexels mode never replays generated footage.
  if (parsed.opening !== undefined || parsed.style !== undefined || parsed.mode === "pexels") return null;
  return {
    prompt: parsed.prompt,
    orientation: parsed.orientation,
    conversation: parsed.conversation.map((turn) => ({ prompt: turn.prompt, ...(turn.response === undefined ? {} : { response: turn.response }) })),
  };
}

export function replayMusic(body: unknown): ReplayMusic {
  const parsed = parseResponseRequest(body);
  return {
    ...(parsed.musicMood === undefined ? {} : { preference: parsed.musicMood }),
    ...(parsed.initialTrackId === undefined ? {} : { initialTrackId: parsed.initialTrackId }),
    ...(parsed.previousTrackId === undefined ? {} : { previousTrackId: parsed.previousTrackId }),
  };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function answerObjectKey(material: AnswerCacheMaterial): Promise<string> {
  return `answers/${await sha256Hex(stableJson(material))}/events.json`;
}

export async function suggestionsObjectKey(body: unknown): Promise<string | null> {
  let parsed;
  try { parsed = parseSuggestionsRequest(body); } catch { return null; }
  return `suggestions/${await sha256Hex(stableJson(parsed))}.json`;
}

export async function speechObjectKey(body: unknown): Promise<string | null> {
  let parsed;
  try { parsed = parseSpeechRequest(body); } catch { return null; }
  return `speech/${await sha256Hex(parsed.text)}.json`;
}

export function clipObjectKey(sha256: string): string {
  return `clips/${sha256}.mp4`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new Error(`${label} must be a string list`);
  return value as string[];
}

function containsText(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (Array.isArray(value)) return value.some((entry) => containsText(entry, needle));
  if (value && typeof value === "object") return Object.values(value).some((entry) => containsText(entry, needle));
  return false;
}

function mapStrings(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, map)]));
  }
  return value;
}

function completion(events: readonly VideoEvent[]): Extract<VideoEvent, { type: "response.complete" }> | undefined {
  const last = events.at(-1);
  return last?.type === "response.complete" ? last : undefined;
}

/** Validate an untrusted stored recording before any of it reaches a viewer. */
export function parseRecordedAnswer(value: unknown): RecordedAnswer {
  const recording = record(value, "recording");
  if (recording.version !== RECORDED_ANSWER_VERSION) throw new Error("recording.version is unsupported");
  if (typeof recording.recordedAt !== "string") throw new Error("recording.recordedAt must be a string");
  if (recording.commit !== undefined && typeof recording.commit !== "string") throw new Error("recording.commit must be a string");
  const request = answerCacheMaterial(recording.request);
  if (!request) throw new Error("recording.request is not replayable");
  const lines = stringList(recording.lines, "recording.lines");
  if (!Array.isArray(recording.events) || recording.events.length === 0 || recording.events.length > MAX_RECORDED_EVENTS) {
    throw new Error("recording.events is invalid");
  }
  const events = recording.events.map((event) => parseVideoEvent(event));
  const complete = completion(events);
  if (!complete || complete.data.finishReason !== "stop") throw new Error("recording is not a complete answer");
  if (events[0]?.type !== "response.start") throw new Error("recording must start with response.start");
  if (containsText(events, "fal.media")) throw new Error("recording still references provider media");
  return {
    version: RECORDED_ANSWER_VERSION,
    recordedAt: recording.recordedAt,
    ...(recording.commit === undefined ? {} : { commit: recording.commit }),
    request,
    lines,
    events,
  };
}

function resequence(events: readonly VideoEvent[]): VideoEvent[] {
  return events.map((event, sequence) => ({ ...event, sequence, eventId: `${event.runId}:${sequence}` }) as VideoEvent);
}

/** Events for one viewer: absolute media URLs, their soundtrack choice and a matching checksum. */
export function replayAnswerEvents(recorded: RecordedAnswer, options: { origin: string; music: ReplayMusic }): VideoEvent[] {
  const absolute = (text: string) => text.startsWith(MEDIA_ROUTE) ? `${options.origin}${text}` : text;
  const recordedAudio = recorded.events.find((event) => event.type === "audio.set");
  const briefMood = recordedAudio ? getMusicTrack(recordedAudio.data.audio.trackId)?.mood : undefined;
  const track = chooseAnswerMusic({ ...options.music, briefMood: briefMood ?? "off" });
  const audio = track ? createMusicAudio(track) : undefined;
  const events = recorded.events.flatMap((event): VideoEvent[] => {
    if (event.type === "audio.set") return audio ? [{ ...event, data: { audio } }] : [];
    if (event.type === "response.complete") {
      const { audio: _recordedAudio, ...rest } = mapStrings(event.data.snapshot, absolute) as Video;
      const snapshot = parseVideo({ ...rest, ...(audio ? { audio } : {}) });
      return [{ ...event, data: { ...event.data, snapshot, checksum: checksumVideo(snapshot) } }];
    }
    return [{ ...event, data: mapStrings(event.data, absolute) } as VideoEvent];
  });
  if (audio && !recordedAudio) events.splice(1, 0, { ...events[0]!, type: "audio.set", data: { audio } });
  return resequence(events);
}

/** Generated media the recording script must copy before the answer can be stored. */
export function answerMediaUrls(events: readonly VideoEvent[]): string[] {
  const urls = new Set<string>();
  for (const event of events) {
    if (event.type !== "scene.add") continue;
    const url = event.data.scene.variables.mediaUrl;
    if (typeof url === "string") urls.add(url);
  }
  return [...urls];
}

/** Only a complete, fully generated answer is worth serving to everyone. */
export function isCleanAnswer(events: readonly VideoEvent[]): boolean {
  const complete = completion(events);
  if (!complete || complete.data.finishReason !== "stop" || events[0]?.type !== "response.start") return false;
  if (events.some((event) => ["response.warning", "response.error", "response.abort"].includes(event.type))) return false;
  const scenes = events.filter((event) => event.type === "scene.add");
  return scenes.length > 0 && scenes.every((event) => {
    const url = event.data.scene.variables.mediaUrl;
    return event.data.scene.templateId === "cinemaMedia" && typeof url === "string" && /^https:\/\/([a-z0-9-]+\.)*fal\.media\//.test(url);
  });
}

/** The `lines` the client sends after this stream: the opening, then every scene narration. */
export function linesFromEvents(events: readonly VideoEvent[]): string[] {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === OPENING_EVENT) {
      const payload = event.data && typeof event.data === "object" ? event.data as { line?: unknown } : {};
      const line = typeof payload.line === "string" ? payload.line.trim().slice(0, 300) : "";
      if (line && lines.length === 0) lines.push(line);
    }
    if (event.type === "scene.add") {
      const narration = event.data.scene.narration?.trim();
      if (narration) lines.push(narration);
    }
  }
  return lines;
}

export function recordAnswer(events: readonly VideoEvent[], options: {
  request: AnswerCacheMaterial;
  recordedAt: string;
  commit?: string;
  /** Provider media URL → stored object key. */
  media: ReadonlyMap<string, string>;
}): RecordedAnswer {
  if (!isCleanAnswer(events)) throw new Error("Only a complete generated answer can be recorded");
  const relocate = (text: string) => {
    const key = options.media.get(text);
    if (key) return `${MEDIA_ROUTE}${key}`;
    if (text.includes("fal.media")) throw new Error(`Provider media was not copied: ${text}`);
    return text;
  };
  const relocated = events.map((event) => event.type === "response.complete"
    ? { ...event, data: { ...event.data, snapshot: mapStrings(event.data.snapshot, relocate) as Video } }
    : { ...event, data: mapStrings(event.data, relocate) } as VideoEvent);
  return parseRecordedAnswer({
    version: RECORDED_ANSWER_VERSION,
    recordedAt: options.recordedAt,
    ...(options.commit === undefined ? {} : { commit: options.commit }),
    request: options.request,
    lines: linesFromEvents(events),
    events: relocated,
  });
}

/** The completed turn as the client would remember it, for building follow-up conversations. */
export function recordedTurn(recorded: RecordedAnswer): { prompt: string; opening?: string; video: Video } {
  const complete = completion(recorded.events)!;
  const opening = recorded.events.find((event) => event.type === OPENING_EVENT);
  const payload = opening?.data && typeof opening.data === "object" ? opening.data as { line?: unknown } : {};
  const line = typeof payload.line === "string" ? payload.line.trim().slice(0, 300) : "";
  return { prompt: recorded.request.prompt, ...(line ? { opening: line } : {}), video: complete.data.snapshot };
}
