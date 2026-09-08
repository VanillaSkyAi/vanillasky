import React from "react";
import { createRoot } from "react-dom/client";
import type { Video } from "../../../src/protocol/types";
import { VideoPlayer } from "../../../src/player/video-player";
import { TEST_VIDEO_STYLE as style } from "../../semantic-brand-fixture";

const audioUrl = "data:audio/wav;base64,UklGRg==";

function playerVideo(duration: number): Video {
  return {
    schemaVersion: "0.2",
    orientation: "portrait",
    scenes: [{
      id: "activation",
      templateId: "chapterTitle",
      variables: {
        title: "Lasting retention",
      },
      timing: { fixedDuration: duration },
    }],
    style,
    audio: {
      trackId: "player-state-demo",
      audioUrl,
      duration,
      beatDetection: { sensitivity: 0.5 },
      beatMarkers: [],
      volume: 1,
      fadeOutMs: 500,
    },
  };
}

const states = [
  { id: "idle", label: "IDLE", caption: "Poster frame with a neutral “Play with sound” overlay.", duration: 30 },
  { id: "playing", label: "PLAYING", caption: "Circular pause, mute, and fullscreen controls.", duration: 30 },
  { id: "paused", label: "PAUSED", caption: "The same controls restore the play icon.", duration: 6 },
  { id: "ended", label: "ENDED", caption: "A dimmed frame centers the replay action.", duration: 0.6 },
] as const;

function Fixture() {
  return <main className="state-showcase">
    {states.map((state) => <section key={state.id} data-player-state={state.id}>
      <span className="state-label">{state.label}</span>
      <VideoPlayer
        video={playerVideo(state.duration)}
        width={360}
        playbackMode="manual"
        startMuted={false}
        ariaLabel={state.label.toLowerCase() + " player state"}
      />
      <p>{state.caption}</p>
    </section>)}
  </main>;
}

const styleElement = document.createElement("style");
styleElement.textContent = [
  "* { box-sizing: border-box; }",
  "body { margin: 0; color: #fff; background: linear-gradient(135deg, #23102e, #080719 65%); font-family: Inter, system-ui, sans-serif; }",
  ".state-showcase { width: max-content; min-width: 100vw; min-height: 100vh; display: grid; grid-template-columns: repeat(4, 360px); gap: 46px; padding: 42px 46px; align-items: start; }",
  "section { display: grid; gap: 22px; }",
  "section > [data-testid='video-player'] { border: 1px solid rgba(224, 79, 138, .9); border-radius: 28px; }",
  ".state-label { width: max-content; padding: 9px 13px; border-radius: 999px; color: #c1bdcd; background: rgba(255,255,255,.05); font: 700 14px/1 ui-monospace, monospace; letter-spacing: .17em; }",
  "p { width: 360px; margin: 0; color: #aaa5b8; font-size: 17px; line-height: 1.55; }",
].join("\n");
document.head.append(styleElement);

createRoot(document.getElementById("root")!).render(<Fixture />);
