import { parseVideo } from "../protocol/persistence.js";
import type { VideoChatTurn } from "./session-state.js";

const VIDEO_CHAT_SESSIONS_KEY = "vanillasky:sessions";
const MAX_SESSIONS = 10;
const MAX_TURNS = 100;
const MAX_ID_LENGTH = 200;
const MAX_PROMPT_LENGTH = 8_000;
const MAX_OPENING_LENGTH = 16_000;

export interface SavedVideoChatSession {
  id: string;
  turns: readonly VideoChatTurn[];
}

function boundedText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= maximum ? text : undefined;
}

function savedTurn(value: unknown): VideoChatTurn | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const turn = value as Record<string, unknown>;
  const id = boundedText(turn.id, MAX_ID_LENGTH);
  const prompt = boundedText(turn.prompt, MAX_PROMPT_LENGTH);
  if (!id || !prompt || turn.completed !== true || (turn.orientation !== "portrait" && turn.orientation !== "landscape")
    || typeof turn.fixedOrientation !== "boolean") return undefined;
  try {
    const video = parseVideo(turn.video);
    const opening = boundedText(turn.opening, MAX_OPENING_LENGTH);
    const mode = turn.mode === "cinematic" || turn.mode === "pexels" ? turn.mode : undefined;
    return {
      id,
      prompt,
      completed: true,
      orientation: turn.orientation,
      fixedOrientation: turn.fixedOrientation,
      suggestions: [],
      video,
      ...(opening ? { opening } : {}),
      ...(mode ? { mode } : {}),
      ...(turn.fallback === "credits" ? { fallback: "credits" as const } : {}),
    };
  } catch {
    return undefined;
  }
}

export function mergeSavedSessions(sessions: readonly SavedVideoChatSession[]): SavedVideoChatSession[] {
  const seen = new Set<string>();
  const result: SavedVideoChatSession[] = [];
  for (const session of sessions) {
    const turns = session.turns.filter(turn => turn.completed && turn.video).slice(-MAX_TURNS);
    const id = turns[0]?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, turns });
    if (result.length === MAX_SESSIONS) break;
  }
  return result;
}

export function readSavedSessions(): SavedVideoChatSession[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(VIDEO_CHAT_SESSIONS_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return mergeSavedSessions(stored.slice(0, MAX_SESSIONS).flatMap((value): SavedVideoChatSession[] => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const turnsValue = (value as Record<string, unknown>).turns;
      if (!Array.isArray(turnsValue)) return [];
      const turns = turnsValue.slice(-MAX_TURNS).map(savedTurn).filter((turn): turn is VideoChatTurn => Boolean(turn));
      return turns.length ? [{ id: turns[0]!.id, turns }] : [];
    }));
  } catch {
    return [];
  }
}

export function saveSessions(sessions: readonly SavedVideoChatSession[]): void {
  try { sessionStorage.setItem(VIDEO_CHAT_SESSIONS_KEY, JSON.stringify(mergeSavedSessions(sessions))); }
  catch { /* The in-memory session remains available when browser storage is unavailable. */ }
}
