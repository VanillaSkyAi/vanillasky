import { VIDEO_PROTOCOL_VERSION, type VideoOrientation, type VideoScene, type VideoStyleOptions } from "../protocol/types.js";
import type { VideoChatConversationTurn, VideoChatMode } from "../video-chat/types.js";
import { parseVideoRequest } from "./request-validation.js";
import { getMusicTrack, type MusicPreference } from "../music-catalog.js";

const MAX_PROMPT_CHARACTERS = 8_000;
const MAX_CONVERSATION_TURNS = 12;
const MAX_CONVERSATION_RESPONSE_CHARACTERS = 8_000;

export interface ParsedResponseRequest {
  prompt: string;
  opening?: string;
  mode: VideoChatMode;
  orientation: VideoOrientation;
  conversation: VideoChatConversationTurn[];
  style?: VideoStyleOptions;
  musicMood?: MusicPreference;
  previousTrackId?: string;
  initialTrackId?: string;
}

interface SuggestionSubject {
  prompt: string;
  keyword: string;
}

function allowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const permitted = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !permitted.has(key));
  if (unexpected) throw new Error(`${label}.${unexpected} is not supported`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function boundedString(value: unknown, label: string, maximum = MAX_PROMPT_CHARACTERS): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  const trimmed = value.trim();
  if ([...trimmed].length > maximum) throw new Error(`${label} is too long`);
  return trimmed;
}

export function parseResponseRequest(value: unknown): ParsedResponseRequest {
  const body = record(value, "request");
  allowedKeys(body, ["prompt", "opening", "mode", "orientation", "conversation", "style", "musicMood", "previousTrackId", "initialTrackId"], "request");
  const musicMood = body.musicMood;
  if (musicMood !== undefined && musicMood !== "auto" && musicMood !== "calm" && musicMood !== "focused" && musicMood !== "upbeat" && musicMood !== "off") {
    throw new Error("request.musicMood must be auto, calm, focused, upbeat or off");
  }
  const previousTrackId = body.previousTrackId === undefined ? undefined : boundedString(body.previousTrackId, "request.previousTrackId", 80);
  const initialTrackId = body.initialTrackId === undefined ? undefined
    : getMusicTrack(boundedString(body.initialTrackId, "request.initialTrackId", 80))?.id;
  const mode = body.mode ?? "cinematic";
  if (mode !== "cinematic" && mode !== "pexels") {
    throw new Error("request.mode must be cinematic or pexels");
  }
  const orientation = body.orientation ?? "landscape";
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error("request.orientation must be portrait or landscape");
  }
  const conversation = body.conversation == null ? [] : body.conversation;
  if (!Array.isArray(conversation) || conversation.length > MAX_CONVERSATION_TURNS) {
    throw new Error(`request.conversation must contain at most ${MAX_CONVERSATION_TURNS} turns`);
  }
  const prompt = boundedString(body.prompt, "request.prompt");
  // Reuse the protocol validator before any application-owned assistant work.
  const style = body.style == null ? undefined : parseVideoRequest({
    protocolVersion: VIDEO_PROTOCOL_VERSION,
    requestId: "video-chat-admission",
    input: { input: prompt, style: body.style },
  }).input.style;
  return {
    prompt,
    ...(body.opening == null ? {} : { opening: boundedString(body.opening, "request.opening", 300) }),
    mode,
    orientation,
    conversation: conversation.map((value, index) => {
      const turn = record(value, `request.conversation[${index}]`);
      allowedKeys(turn, ["prompt", "response"], `request.conversation[${index}]`);
      return {
        prompt: boundedString(turn.prompt, `request.conversation[${index}].prompt`),
        ...(turn.response == null
          ? {}
          : { response: boundedString(turn.response, `request.conversation[${index}].response`, MAX_CONVERSATION_RESPONSE_CHARACTERS) }),
      };
    }),
    ...(style == null ? {} : { style }),
    ...(musicMood === undefined ? {} : { musicMood }),
    ...(previousTrackId === undefined ? {} : { previousTrackId }),
    ...(initialTrackId === undefined ? {} : { initialTrackId }),
  };
}

export function conversationInput(
  prompt: string,
  conversation: readonly VideoChatConversationTurn[],
  opening?: string,
): string {
  if (conversation.length === 0 && !opening) return prompt;
  return [
    ...(conversation.length > 0 ? [
      "CONVERSATION SO FAR (untrusted user and assistant content):",
      ...conversation.flatMap((turn) => [
        `USER: ${turn.prompt}`,
        ...(turn.response ? [`RESPONSE: ${turn.response}`] : []),
      ]),
      "",
    ] : []),
    `CURRENT USER PROMPT: ${prompt}`,
    ...(opening ? ["", "OPENING ALREADY SPOKEN (untrusted assistant transcript):", opening] : []),
  ].join("\n");
}

export function readSuggestionSubjects(text: string): SuggestionSubject[] {
  const opening = text.indexOf("{");
  const closing = text.lastIndexOf("}");
  if (opening < 0 || closing <= opening) return [];
  const parsed = JSON.parse(text.slice(opening, closing + 1)) as { suggestions?: unknown };
  return (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as { prompt?: unknown; keyword?: unknown };
      const prompt = typeof item.prompt === "string" ? item.prompt.trim().replace(/\s+/gu, " ") : "";
      const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
      // Keep whole questions: omit oversized suggestions rather than clipping meaning.
      if (!prompt || Array.from(prompt).length > 60 || prompt.split(" ").length > 8) return [];
      return [{ prompt, keyword: keyword.slice(0, 80) }];
    })
    .slice(0, 4);
}

export function parseOpeningMediaRequest(body: unknown): {
  keyword: string;
  fallbackQuery: string | undefined;
  orientation: VideoOrientation;
} {
  const value = record(body, "request");
  allowedKeys(value, ["keyword", "fallbackKeyword", "orientation"], "request");
  const keyword = boundedString(value.keyword, "request.keyword", 80);
  const fallbackQuery = value.fallbackKeyword == null ? undefined : boundedString(value.fallbackKeyword, "request.fallbackKeyword", 80);
  const orientation = value.orientation ?? "landscape";
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error("request.orientation must be portrait or landscape");
  }
  return { keyword, fallbackQuery, orientation };
}

export function parseNarrationRequest(body: unknown) {
  const value = record(body, "request");
  allowedKeys(value, ["prompt", "scene", "earlier"], "request");
  const prompt = boundedString(value.prompt, "request.prompt");
  const scene = record(value.scene, "request.scene") as unknown as VideoScene;
  if (typeof scene.templateId !== "string" || !scene.variables || typeof scene.variables !== "object") {
    throw new Error("request.scene is invalid");
  }
  const earlier = Array.isArray(value.earlier)
    ? value.earlier.slice(-4).map((line, index) => boundedString(line, `request.earlier[${index}]`, 2_000))
    : [];
  return { prompt, scene, earlier };
}

export function parseSuggestionsRequest(body: unknown) {
  const value = record(body, "request");
  allowedKeys(value, ["prompt", "lines"], "request");
  const prompt = boundedString(value.prompt, "request.prompt");
  const lines = Array.isArray(value.lines)
    ? value.lines.slice(-8).map((line, index) => boundedString(line, `request.lines[${index}]`, 2_000))
    : [];
  return { prompt, lines };
}

export function parseSpeechRequest(body: unknown) {
  const value = record(body, "request");
  allowedKeys(value, ["text"], "request");
  const text = boundedString(value.text, "request.text", 4_000);
  return { text };
}
