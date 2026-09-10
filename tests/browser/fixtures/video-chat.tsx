import React from "react";
import "../../../styles/video-chat.css";
import { createRoot } from "react-dom/client";
import { VideoChat, type VideoChatVoice } from "../../../src/react";

// Predictable silent voice keeps this browser test independent of OS voices.
// Generated-voice recovery is exercised separately by the voice suite.
const holdOpening = new URLSearchParams(location.search).has("hold-opening");
let releaseOpening = () => {};
let firstLine = true;
const voice: VideoChatVoice = {
  prepare: async () => ({ seconds: 1 }),
  speak: async (_text, { signal }) => new Promise<void>((resolve) => {
    if (holdOpening && firstLine) {
      firstLine = false;
      releaseOpening = resolve;
      signal.addEventListener("abort", () => resolve(), { once: true });
      return;
    }
    const timer = setTimeout(resolve, 250);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  }),
  pause() {}, resume() {}, setMuted() {},
};

createRoot(document.getElementById("root")!).render(
  <>
    {holdOpening && <button onClick={() => releaseOpening()}>Finish opening</button>}
    <VideoChat
      branding={new URLSearchParams(location.search).has("branding") ? { name: "Acme", homeUrl: "/app", showDeveloperLinks: false } : undefined}
      showRecoveryNotice={new URLSearchParams(location.search).has("recovery-notice")} options={{ endpoint: "/api/video-chat", mode: "cinematic", voice }} />
  </>,
);
