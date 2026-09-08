import { useEffect, useState } from "react";
import { VideoChat } from "../../src/react";
import "../../styles/video-chat.css";
import "../home.css";

type Readiness = { ready: boolean; missing: string[]; videoMode: "cinematic" | "pexels" | null };
const labels: Record<string, string> = {
  ANTHROPIC_API_KEY: "AI planning: ANTHROPIC_API_KEY",
  PEXELS_API_KEY: "Footage: PEXELS_API_KEY or a configured AI-video provider",
  VIDEO_CHAT_QUOTAS: "Usage database: VIDEO_CHAT_QUOTAS",
  VIDEO_CHAT_QUOTA_SALT: "Usage identity: VIDEO_CHAT_QUOTA_SALT",
  VIDEO_CHAT_PAID_PROVIDERS: "AI providers are disabled for this deployment",
};

export function Home() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Readiness | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setStatus(null);
    setFailed(false);
    void fetch("/api/video-chat?action=status", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Configuration unavailable");
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("ready" in result) || typeof result.ready !== "boolean"
          || !("videoMode" in result) || !["cinematic", "pexels", null].includes(result.videoMode as string | null)
          || (result.ready && result.videoMode === null)
          || !("missing" in result) || !Array.isArray(result.missing) || !result.missing.every(item => typeof item === "string")) {
          throw new Error("Configuration unavailable");
        }
        if (!controller.signal.aborted) setStatus({ ready: result.ready, missing: result.missing, videoMode: result.videoMode as Readiness["videoMode"] });
      }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);

  return <main id="content" className="conversation-home" tabIndex={-1}>
    {status?.ready ? <VideoChat options={{ endpoint: "/api/video-chat", mode: status.videoMode ?? undefined }} /> :
      <section className="chat-setup" aria-labelledby="setup-title">
        <p className="chat-setup-brand">VanillaSky</p>
        <h1 id="setup-title">{failed ? "The chat server is unavailable" : status ? "Set up video chat" : "Connecting to video chat"}</h1>
        {status && <>
          <p>Configure the missing settings on the server to start a real AI conversation.</p>
          <ul>{status.missing.map(key => <li key={key}>{labels[key] ?? "Server configuration is incomplete"}</li>)}</ul>
          <p>For local setup, follow the repository README. Browser speech is included; generated voice is optional.</p>
        </>}
        {failed && <p>Check that the API server is running, then try again.</p>}
        {(status || failed) && <button type="button" onClick={() => setAttempt(value => value + 1)}>Check again</button>}
      </section>}
  </main>;
}
