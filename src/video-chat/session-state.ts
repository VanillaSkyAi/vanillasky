import type { Video, VideoAudio, VideoOrientation, VideoScene } from "../protocol/types.js";
import type { VideoEvent } from "../protocol/events.js";
import type { VideoError } from "../player/video-error.js";
import type {
  VideoChatCapabilities,
  VideoChatConversationTurn,
  VideoChatMedia,
  VideoChatMode,
  VideoChatSuggestion,
  VideoChatWelcome,
} from "./types.js";

export type VideoChatStatus = "idle" | "composing" | "playing" | "paused" | "ended" | "cancelled" | "error";

export interface VideoChatTurn {
  id: string;
  prompt: string;
  /** True only after the complete response has been received. */
  completed: boolean;
  opening?: string;
  /** Concise notices for recovered optional failures. */
  warnings?: readonly string[];
  /** Optional stock footage held behind the opening hook until playback starts. */
  openingMedia?: VideoChatMedia;
  orientation: VideoOrientation;
  /** Generated footage keeps the orientation it was created in. */
  fixedOrientation: boolean;
  /** Footage source selected for this answer; omitted in older saved turns. */
  mode?: VideoChatMode;
  video?: Video;
  /** Provisional music starts on Ask while the answer brief is still loading. */
  initialSoundtrack?: VideoAudio;
  /** Explicit viewer override, retained while the server finishes streaming. */
  soundtrack?: VideoAudio | false;
  /** The initial choice restores Auto without another selection or model call. */
  originalSoundtrack?: VideoAudio | false;
  suggestions: readonly VideoChatSuggestion[];
}

interface Playback {
  kind: "stream" | "video";
  stream?: AsyncIterable<VideoEvent>;
  video?: Video;
}

interface SessionState {
  turns: VideoChatTurn[];
  shownTurnId?: string;
  capabilities?: VideoChatCapabilities;
  welcome?: VideoChatWelcome;
  status: VideoChatStatus;
  resumeStatus: Exclude<VideoChatStatus, "paused">;
  error?: VideoError;
  caption?: string;
  spokenUpTo: number;
  muted: boolean;
  playbackEnded: boolean;
  playerKey: number;
  playback?: Playback;
  openingSpeaking: boolean;
}

type SessionAction =
  | { type: "capabilities"; value: VideoChatCapabilities }
  | { type: "welcome"; value: VideoChatWelcome }
  | { type: "resolved-mode"; id: string; mode: VideoChatMode }
  | { type: "start"; turn: VideoChatTurn }
  | { type: "opening-start"; id: string; line: string }
  | { type: "opening-media"; id: string; media: VideoChatMedia }
  | { type: "opening-end"; id: string }
  | { type: "player"; id: string; stream: AsyncIterable<VideoEvent> }
  | { type: "partial"; id: string; video: Video }
  | { type: "complete"; id: string; video: Video; suggestions: VideoChatSuggestion[] }
  | { type: "suggestions"; id: string; suggestions: VideoChatSuggestion[] }
  | { type: "scene"; key: number; scene: VideoScene; index: number }
  | { type: "playback-end"; key: number }
  | { type: "warning"; id: string; message: string }
  | { type: "error"; id: string; error: VideoError }
  | { type: "cancelled" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "mute"; value: boolean }
  | { type: "soundtrack"; id: string; audio: VideoAudio | false | undefined }
  | { type: "select"; id: string }
  | { type: "replay" }
  | { type: "reset" }
  | { type: "restore"; turns: VideoChatTurn[] };

export function initialState(muted: boolean): SessionState {
  return {
    turns: [],
    status: "idle",
    resumeStatus: "idle",
    spokenUpTo: -1,
    muted,
    playbackEnded: false,
    playerKey: 0,
    openingSpeaking: false,
  };
}

function replaceTurn(
  turns: VideoChatTurn[],
  id: string,
  update: (turn: VideoChatTurn) => VideoChatTurn,
): VideoChatTurn[] {
  return turns.map((turn) => turn.id === id ? update(turn) : turn);
}

function withSoundtrack(video: Video, audio: VideoAudio | false | undefined): Video {
  if (audio === undefined) return video;
  const { audio: _previous, ...rest } = video;
  return audio === false ? rest : { ...rest, audio };
}

export function soundtrackForTurn(turn?: VideoChatTurn): VideoAudio | undefined {
  if (!turn || turn.soundtrack === false) return undefined;
  return turn.soundtrack ?? (turn.video ? turn.video.audio : turn.initialSoundtrack);
}

export function reducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "capabilities": return { ...state, capabilities: action.value };
    case "welcome": return { ...state, welcome: action.value };
    case "resolved-mode":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return { ...state, turns: replaceTurn(state.turns, action.id, turn => ({ ...turn, mode: action.mode })) };
    case "start": return {
      ...state,
      turns: [...state.turns, action.turn],
      playerKey: state.playerKey + 1,
      shownTurnId: action.turn.id,
      status: "composing",
      resumeStatus: "composing",
      error: undefined,
      caption: undefined,
      spokenUpTo: -1,
      playbackEnded: false,
      playback: undefined,
      openingSpeaking: false,
    };
    case "opening-start":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({
          ...turn,
          opening: turn.opening ? `${turn.opening} ${action.line}` : action.line,
        })),
        status: state.status === "paused" ? "paused" : "playing",
        resumeStatus: "playing",
        caption: action.line,
        openingSpeaking: true,
      };
    case "opening-media":
      if (state.turns.at(-1)?.id !== action.id || state.playback) return state;
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn, openingMedia: action.media })),
      };
    case "opening-end":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: state.status === "paused" ? "paused" : state.playback ? "playing" : "composing",
        resumeStatus: state.playback ? "playing" : "composing",
        openingSpeaking: false,
      };
    case "player":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: state.status === "paused" ? "paused" : "playing",
        resumeStatus: "playing",
        playback: { kind: "stream", stream: action.stream },
        playerKey: state.playerKey + 1,
        playbackEnded: false,
      };
    case "partial":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn,
        originalSoundtrack: turn.originalSoundtrack ?? action.video.audio ?? false,
        video: withSoundtrack(action.video, turn.soundtrack),
      })) };
    case "complete":
      return {
        ...state,
        turns: replaceTurn(state.turns, action.id, (turn) => ({
          ...turn,
          completed: true,
          originalSoundtrack: turn.originalSoundtrack ?? action.video.audio ?? false,
          video: withSoundtrack(action.video, turn.soundtrack),
          suggestions: action.suggestions,
        })),
      };
    case "suggestions":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({ ...turn, suggestions: action.suggestions })) };
    case "scene":
      if (state.playerKey !== action.key) return state;
      return {
        ...state,
        caption: action.scene.narration?.trim() || state.caption,
        spokenUpTo: Math.max(state.spokenUpTo, action.index),
      };
    case "playback-end":
      if (state.playerKey !== action.key) return state;
      return { ...state, status: "ended", resumeStatus: "ended", playbackEnded: true, openingSpeaking: false };
    case "warning":
      return { ...state, turns: replaceTurn(state.turns, action.id, (turn) => ({
        ...turn, warnings: [...new Set([...(turn.warnings ?? []), action.message])],
      })) };
    case "error":
      if (state.turns.at(-1)?.id !== action.id) return state;
      return {
        ...state,
        status: "error",
        resumeStatus: "error",
        error: action.error,
        openingSpeaking: false,
        playback: undefined,
      };
    case "cancelled":
      return {
        ...state,
        status: "cancelled",
        resumeStatus: "cancelled",
        openingSpeaking: false,
        playback: undefined,
      };
    case "pause":
      if (state.status === "idle" || state.status === "paused" || state.status === "ended" || state.status === "cancelled" || state.status === "error") return state;
      return { ...state, resumeStatus: state.status, status: "paused" };
    case "resume":
      return state.status === "paused" ? { ...state, status: state.resumeStatus } : state;
    case "mute": return { ...state, muted: action.value };
    case "soundtrack": return { ...state, turns: replaceTurn(state.turns, action.id, turn => ({
      ...turn, soundtrack: action.audio,
      ...(turn.video ? { video: withSoundtrack(turn.video, action.audio ?? turn.originalSoundtrack ?? false) } : {}),
    })) };
    case "select": {
      const turn = state.turns.find((entry) => entry.id === action.id);
      if (!turn?.video) return state;
      return {
        ...state,
        shownTurnId: turn.id,
        playback: { kind: "video", video: turn.video },
        status: "playing",
        resumeStatus: "playing",
        playerKey: state.playerKey + 1,
        playbackEnded: false,
        spokenUpTo: -1,
        caption: turn.opening,
        error: undefined,
      };
    }
    case "replay": {
      const turn = state.turns.find((entry) => entry.id === state.shownTurnId);
      if (!turn?.video) return state;
      return {
        ...state,
        playback: { kind: "video", video: turn.video },
        status: "playing",
        resumeStatus: "playing",
        playerKey: state.playerKey + 1,
        playbackEnded: false,
        spokenUpTo: -1,
        caption: turn.opening,
        error: undefined,
      };
    }
    case "restore": {
      const restored = {
        ...initialState(state.muted),
        capabilities: state.capabilities,
        welcome: state.welcome,
        turns: action.turns,
        playerKey: state.playerKey,
      };
      const latest = action.turns.at(-1);
      return latest ? reducer(restored, { type: "select", id: latest.id }) : restored;
    }
    case "reset": return { ...initialState(state.muted), capabilities: state.capabilities, welcome: state.welcome };
  }
}

export function transcriptFor(turn: VideoChatTurn): string[] {
  return [
    ...(turn.opening ? [turn.opening] : []),
    ...(turn.video?.scenes.flatMap((entry) => entry.narration?.trim() ? [entry.narration.trim()] : []) ?? []),
  ];
}

export function conversationFor(turns: readonly VideoChatTurn[]): VideoChatConversationTurn[] {
  return turns.filter((turn) => turn.completed && turn.video).slice(-12).map((turn) => ({
    prompt: turn.prompt,
    response: [...transcriptFor(turn).join(" ")].slice(0, 8_000).join(""),
  }));
}
