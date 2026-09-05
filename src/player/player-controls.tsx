import type { CSSProperties, ReactElement } from "react";
import type { Video } from "../protocol/types.js";

type PlayerIconName = "enter-fullscreen" | "exit-fullscreen" | "pause" | "play" | "replay" | "volume" | "volume-off";

function PlayerIcon({ name, size = 22 }: { name: PlayerIconName; size?: number }): ReactElement {
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (name === "play") {
    return <svg {...shared}><path d="M8 5v14l11-7z" fill="currentColor" stroke="none" /></svg>;
  }
  if (name === "pause") {
    return <svg {...shared}><path d="M7 5h4v14H7zm6 0h4v14h-4z" fill="currentColor" stroke="none" /></svg>;
  }
  if (name === "replay") {
    return <svg {...shared}><path d="M4.5 9A8 8 0 1 1 5 16" /><path d="M4.5 4.5V9H9" /></svg>;
  }
  if (name === "volume-off") {
    return <svg {...shared}><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="m16 9 5 5M21 9l-5 5" /></svg>;
  }
  if (name === "volume") {
    return <svg {...shared}><path d="M11 5 6.5 9H3v6h3.5L11 19z" /><path d="M15 9.5a4 4 0 0 1 0 5M17.8 7a7.5 7.5 0 0 1 0 10" /></svg>;
  }
  if (name === "exit-fullscreen") {
    return <svg {...shared}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>;
  }
  return <svg {...shared}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>;
}

const startButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  minHeight: 60,
  padding: "14px 22px",
  border: "1px solid rgba(9, 7, 18, 0.08)",
  borderRadius: 999,
  backgroundColor: "#ffffff",
  color: "#090712",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.24)",
  font: "700 16px/1 system-ui, sans-serif",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const startButtonPositionStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  zIndex: 3,
  transform: "translate(-50%, -50%)",
};

function playLabel(config: Video | undefined, isMuted: boolean): string {
  return config?.audio && !isMuted ? "Play with sound" : "Play video";
}

function playAriaLabel(config: Video | undefined, isMuted: boolean): string {
  return config?.audio && !isMuted ? "Play video with sound" : "Play video response";
}

interface GenerationCoverProps {
  visible: boolean;
  config?: Video;
  isMuted: boolean;
  startRequested: boolean;
  isPlaying: boolean;
  onStart: () => void;
}

export function GenerationCover({
  visible,
  config,
  isMuted,
  startRequested,
  isPlaying,
  onStart,
}: GenerationCoverProps): ReactElement | null {
  if (!visible) return null;

  return (
    <div
      data-testid="video-generation-cover"
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        padding: "12%",
        textAlign: "center",
        color: "#fff",
        background: "#000",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, Arial, sans-serif',
      }}
    >
      <div style={{ position: "absolute", top: "28%", left: "10%", right: "10%" }}>
        <div aria-hidden="true" style={{ fontSize: "clamp(28px, 8vw, 72px)", opacity: 0.9 }}>✦</div>
        <strong style={{ display: "block", marginTop: 18, fontSize: "clamp(24px, 5vw, 56px)", lineHeight: 1.08 }}>
          Creating your video…
        </strong>
        <span style={{ display: "block", marginTop: 14, fontSize: "clamp(14px, 2vw, 22px)", lineHeight: 1.4, opacity: 0.78 }}>
          Choosing the best scenes for your content.
        </span>
      </div>
      {!startRequested && !isPlaying ? (
        <button
          type="button"
          aria-label={playAriaLabel(config, isMuted)}
          onClick={onStart}
          style={{ ...startButtonStyle, ...startButtonPositionStyle }}
        >
          <PlayerIcon name="play" size={20} />
          {playLabel(config, isMuted)}
        </button>
      ) : null}
    </div>
  );
}

export function StartPosterButton({
  visible,
  config,
  isMuted,
  onStart,
}: {
  visible: boolean;
  config?: Video;
  isMuted: boolean;
  onStart: () => void;
}): ReactElement | null {
  if (!visible) return null;
  return (
    <button
      type="button"
      data-testid="video-start-button"
      aria-label={playAriaLabel(config, isMuted)}
      onClick={onStart}
      style={{ ...startButtonStyle, ...startButtonPositionStyle }}
    >
      <PlayerIcon name="play" size={20} />
      {playLabel(config, isMuted)}
    </button>
  );
}

export function EndedOverlay({ ended, onReplay }: { ended: boolean; onReplay: () => void }): ReactElement | null {
  if (!ended) return null;
  return <>
    <div
      data-testid="video-ended-scrim"
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        pointerEvents: "none",
        background: "rgba(4, 3, 18, 0.52)",
        backdropFilter: "blur(4px)",
      }}
    />
    <button
      type="button"
      data-testid="video-replay-button"
      aria-label="Replay video response"
      onClick={onReplay}
      style={{ ...startButtonStyle, ...startButtonPositionStyle, zIndex: 3 }}
    >
      <PlayerIcon name="replay" size={21} />
      Replay
    </button>
  </>;
}

interface PlayerControlsProps {
  visible: boolean;
  displayWidth: number;
  ended: boolean;
  isPlaying: boolean;
  isMuted: boolean;
  isFullscreen: boolean;
  hasAudio: boolean;
  onTogglePlayback: () => void;
  onToggleMuted: () => void;
  onToggleFullscreen: () => void;
}

export function PlayerControls({
  visible,
  displayWidth,
  ended,
  isPlaying,
  isMuted,
  isFullscreen,
  hasAudio,
  onTogglePlayback,
  onToggleMuted,
  onToggleFullscreen,
}: PlayerControlsProps): ReactElement | null {
  if (!visible) return null;
  const size = Math.max(40, Math.min(52, Math.round(displayWidth * 0.15)));
  const inset = Math.max(10, Math.min(20, Math.round(displayWidth * 0.056)));
  const buttonStyle: CSSProperties = {
    display: "inline-grid",
    placeItems: "center",
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    padding: 0,
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    color: "#ffffff",
    boxShadow: "0 5px 18px rgba(0, 0, 0, 0.16)",
    backdropFilter: "blur(12px)",
    cursor: "pointer",
  };

  return <div
    data-testid="video-controls"
    style={{ position: "absolute", inset: 0, zIndex: 4, pointerEvents: "none" }}
  >
    <div
      data-testid="video-primary-controls"
      style={{ position: "absolute", left: inset, bottom: inset, display: "flex", pointerEvents: "auto" }}
    >
      <button
        type="button"
        aria-label={ended ? "Play video response from beginning" : isPlaying ? "Pause video response" : "Play video response"}
        onClick={onTogglePlayback}
        style={buttonStyle}
      >
        <PlayerIcon name={isPlaying ? "pause" : "play"} />
      </button>
    </div>
    <div
      data-testid="video-secondary-controls"
      style={{ position: "absolute", right: inset, bottom: inset, display: "flex", gap: 10, pointerEvents: "auto" }}
    >
      {hasAudio ? (
        <button
          type="button"
          aria-label={isMuted ? "Unmute video response" : "Mute video response"}
          aria-pressed={!isMuted}
          onClick={onToggleMuted}
          style={buttonStyle}
        >
          <PlayerIcon name={isMuted ? "volume-off" : "volume"} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        onClick={onToggleFullscreen}
        style={buttonStyle}
      >
        <PlayerIcon name={isFullscreen ? "exit-fullscreen" : "enter-fullscreen"} />
      </button>
    </div>
  </div>;
}
