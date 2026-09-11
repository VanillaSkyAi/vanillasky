// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { UseVideoChatOptions } from "../src/react";

function chatFetcher(
  requests: Array<{ action: string | null; body?: unknown }> = [],
  storyMedia: { url: string; type: "video" } | null = null,
): typeof fetch {
  return vi.fn(async (input, init) => {
    const url = new URL(String(input), "https://app.example");
    const action = url.searchParams.get("action");
    requests.push({
      action,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (action === "capabilities") {
      return Response.json({
        templates: true,
        generatedSpeech: false,
        generatedVideo: false,
        stockMedia: false,
        transcription: false,
        modes: ["cinematic"],
      });
    }
    if (action === "welcome") {
      return Response.json({
        hero: null,
        cards: [
          { prompt: "Explain why the sky changes colour", media: null },
          {
            prompt: "Invent a surreal bedtime story",
            opening: "Tonight, the impossible feels close enough to touch.",
            media: storyMedia,
          },
        ],
      });
    }
    if (action === "opening-media") return Response.json({ media: null });
    return new Response("Unavailable in this UI test", { status: 503 });
  });
}

describe("VideoChat", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([undefined, "Playful clay animation in an imaginary world."])("preserves optional visual direction without imposing a documentary style (%s)", async (generatedLook) => {
    const { VideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    render(<VideoChat options={{ fetcher: chatFetcher(requests), ...(generatedLook ? { style: { generatedLook } } : {}) }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    await waitFor(() => expect(requests.some(({ action }) => action === "response")).toBe(true));
    const body = requests.find(({ action }) => action === "response")?.body as { style?: { generatedLook?: string } };
    expect(body.style?.generatedLook).toBe(generatedLook);
  });

  it.each([false, true])("reflects a resolved Pexels response without overriding a later user choice (completed: %s)", async (completed) => {
    const { VideoChat } = await import("../src/react");
    const base = chatFetcher();
    render(<VideoChat options={{ mode: "cinematic", fetcher: async (input, init) => {
      const action = new URL(String(input), "https://app.example").searchParams.get("action");
      if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: false, generatedVideo: true, stockMedia: true, transcription: false, modes: ["cinematic", "pexels"] });
      if (action === "response") {
        const { checksumVideo } = await import("../src/protocol/checksum");
        const { TEST_VIDEO_STYLE } = await import("./helpers/video-style");
        const scene = { id: "ready", templateId: "chapterTitle", variables: { title: "A complete answer" }, narration: "The sky changes colour.", timing: { fixedDuration: 1 } };
        const snapshot = { schemaVersion: "0.2" as const, orientation: "landscape" as const, style: TEST_VIDEO_STYLE, scenes: [scene] };
        const events = [
          { type: "response.start", data: { requestId: "mode", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
          { type: "scene.add", data: { scene, position: 0 } },
          { type: "response.complete", data: { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) } },
        ];
        const body = completed ? events.map((event, sequence) => `data: ${JSON.stringify({ protocolVersion: "0.6", eventId: `mode:${sequence}`, runId: "mode", sequence, ...event })}\n\n`).join("") : new ReadableStream();
        return new Response(body, { headers: { "content-type": "text/event-stream", "x-vanillasky-resolved-video-mode": "pexels" } });
      }
      return base(input, init);
    } }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Explain why the sky changes colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const pexels = await screen.findByRole("radio", { name: /Pexels/ });
    await waitFor(() => expect((pexels as HTMLInputElement).checked).toBe(true));
    expect(screen.queryByRole("link", { name: "Pexels" })).toBeNull();
    const generated = screen.getByRole("radio", { name: /AI video/ });
    fireEvent.click(generated);
    fireEvent.click(screen.getByRole("switch", { name: /Subtitles/ }));
    expect((generated as HTMLInputElement).checked).toBe(true);
  });

  it("announces preparation one second after opening speech finishes", async () => {
    const { VideoChat } = await import("../src/react");
    const base = chatFetcher();
    let finishOpening = () => {};
    render(<VideoChat options={{ fetcher: (input, init) => new URL(String(input), "https://app.example").searchParams.get("action") === "response"
      ? new Promise<Response>(() => {}) : base(input, init),
      voice: { prepare: async () => ({seconds: 1}), speak: (_text, { onStart }) => new Promise<void>(resolve => { onStart?.("browser"); finishOpening = resolve; }),
        pause() {}, resume() {}, setMuted() {} },
    }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    await waitFor(() => expect(screen.getByText("Tonight,", { selector: ".caption-word" })).toBeTruthy());
    expect(screen.queryByRole("status", { name: "Video preparation" })).toBeNull();
    await act(async () => { finishOpening(); });
    expect(screen.queryByRole("status", { name: "Video preparation" })).toBeNull();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 800)); });
    expect(screen.queryByRole("status", { name: "Video preparation" })).toBeNull();
    expect((await screen.findByRole("status", { name: "Video preparation" })).textContent).toContain("Preparing your video…");
  });

  it("renders the complete general-purpose experience from the React entry", async () => {
    const { VideoChat } = await import("../src/react");
    const options: UseVideoChatOptions = { fetcher: chatFetcher() };

    const { container } = render(<VideoChat options={options} className="customer-shell" />);

    expectTypeOf(VideoChat).toBeFunction();
    expect(screen.getByRole("link", {name: "Home"}).getAttribute("href")).toBe("/");
    expect(screen.getByRole("img", { name: "VanillaSky" })).toBeTruthy();
    const root = container.querySelector(".vanillasky-video-chat");
    expect(root?.hasAttribute("data-theme")).toBe(false);
    expect(root?.classList.contains("customer-shell")).toBe(true);
    expect(await screen.findByText("in video, not text.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Explain why the sky changes colour" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("accepts an app identity without changing the welcome or session controls", async () => {
    const { VideoChat } = await import("../src/react");
    render(<VideoChat branding={{ name: "Acme", logo: <svg data-testid="acme-logo" width="120" height="30" />, homeUrl: "/app", showDeveloperLinks: false }} options={{ fetcher: chatFetcher() }} />);
    expect(screen.getByRole("link", { name: "Acme home" }).getAttribute("href")).toBe("/app");
    expect(screen.getByTestId("acme-logo")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "VanillaSky" })).toBeNull();
    expect(await screen.findByText("in video, not text.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sessions" }));
    expect(screen.getByRole("button", { name: "New session" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("navigation", { name: "Build with VanillaSky" })).toBeNull();
    expect(screen.getByRole("switch", { name: /Subtitles/ })).toBeTruthy();
  });

  it("uses the app name without a logo and rejects executable home URLs", async () => {
    const { VideoChat } = await import("../src/react");
    render(<VideoChat branding={{ name: "Acme", homeUrl: "javascript:alert(1)" }} options={{ fetcher: chatFetcher() }} />);
    const home = screen.getByRole("link", { name: "Acme home" });
    expect(home.textContent).toBe("Acme");
    expect(home.getAttribute("href")).toBe("/");
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("navigation", { name: "Build with VanillaSky" })).toBeTruthy();
  });

  it.each([false, true])("shows a dismissible recovery notice only when opted in (%s)", async (showRecoveryNotice) => {
    const { VideoChat } = await import("../src/react");
    const { checksumVideo } = await import("../src/protocol/checksum");
    const { TEST_VIDEO_STYLE } = await import("./helpers/video-style");
    const baseFetcher = chatFetcher();
    const scene = { id: "recovered", templateId: "chapterTitle", variables: { title: "A playable answer" }, narration: "The ocean brings a new wave to the shore every moment.", timing: { fixedDuration: 4 } };
    const snapshot = { schemaVersion: "0.2" as const, orientation: "landscape" as const, scenes: [scene], style: TEST_VIDEO_STYLE };
    const parts = [
      { type: "response.start", data: { requestId: "recover", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
      { type: "scene.add", data: { scene, position: 0 } },
      { type: "response.warning", data: { warning: { code: "provider_warning", category: "provider", message: "Some visuals were replaced so your response can continue.", recoverable: true } } },
      { type: "response.complete", data: { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) } },
    ];
    const response = new Response(parts.map((part, sequence) => `data: ${JSON.stringify({ protocolVersion: "0.6", eventId: `recover:${sequence}`, runId: "recover", sequence, ...part })}\n\n`).join(""), { headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6" } });
    const { container } = render(<VideoChat showRecoveryNotice={showRecoveryNotice} options={{
      fetcher: async (input, init) => new URL(String(input), "https://app.example").searchParams.get("action") === "response"
        ? response.clone()
        : baseFetcher(input, init),
      voice: { prepare: async () => ({ seconds: 1 }), speak: async () => {}, pause() {}, resume() {}, setMuted() {} },
    }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    await waitFor(() => expect(container.querySelector('.caption-slot[data-captions="true"] .line-row')).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Hide subtitles" })).toBeNull();
    if (showRecoveryNotice) {
      expect(screen.getByRole("status").textContent).toContain("Some visuals were replaced");
      fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    }
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.textContent).not.toMatch(/simplified|private-provider-detail|Some visuals/);
  });

  it("shows a subtle dismissible notice when exhausted AI credits select Pexels", async () => {
    const { VideoChat } = await import("../src/react");
    const { checksumVideo } = await import("../src/protocol/checksum");
    const { TEST_VIDEO_STYLE } = await import("./helpers/video-style");
    const baseFetcher = chatFetcher();
    const scene = { id: "pexels-fallback", templateId: "chapterTitle", variables: { title: "A Pexels answer" }, narration: "Stock footage keeps the answer moving.", timing: { fixedDuration: 4 } };
    const snapshot = { schemaVersion: "0.2" as const, orientation: "landscape" as const, scenes: [scene], style: TEST_VIDEO_STYLE };
    const parts = [
      { type: "response.start", data: { requestId: "fallback", format: { orientation: "landscape" }, style: TEST_VIDEO_STYLE, capabilities: { templates: ["chapterTitle"] } } },
      { type: "scene.add", data: { scene, position: 0 } },
      { type: "response.complete", data: { finishReason: "stop", snapshot, checksum: checksumVideo(snapshot) } },
    ];
    render(<VideoChat options={{
      fetcher: async (input, init) => {
        if (new URL(String(input), "https://app.example").searchParams.get("action") !== "response") return baseFetcher(input, init);
        return new Response(parts.map((part, sequence) => `data: ${JSON.stringify({ protocolVersion: "0.6", eventId: `fallback:${sequence}`, runId: "fallback", sequence, ...part })}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream", "x-vanillasky-video-stream": "0.6", "x-vanillasky-resolved-video-mode": "pexels", "x-vanillasky-video-fallback": "credits" },
        });
      },
      voice: { prepare: async () => ({ seconds: 1 }), speak: async () => {}, pause() {}, resume() {}, setMuted() {} },
    }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    expect((await screen.findByRole("status")).textContent).toBe("AI video credits are used up. Using Pexels footage instead.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Pexels fallback notice" }));
    expect(screen.queryByText(/AI video credits are used up/)).toBeNull();
  });

  it("does not expose removed source modes or brand controls", async () => {
    const { VideoChat } = await import("../src/react");
    render(<VideoChat options={{fetcher: chatFetcher()}} />);
    fireEvent.click(screen.getByRole("button", {name: "Settings"}));
    expect(screen.queryByText("Templates only")).toBeNull();
    expect(screen.queryByText("Full AI video")).toBeNull();
    expect(screen.queryByText("Brand kit")).toBeNull();
  });

  it("still shows an error when no playable response can be produced", async () => {
    const { VideoChat } = await import("../src/react");
    render(<VideoChat options={{ fetcher: chatFetcher() }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Explain the ocean" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect((await screen.findByRole("status")).textContent).toBeTruthy();
  });

  it("shows a quota error and usable input after a suggested opening even with recovery notices disabled", async () => {
    const { VideoChat } = await import("../src/react");
    const base = chatFetcher();
    render(<VideoChat showRecoveryNotice={false} options={{
      fetcher: async (input, init) => new URL(String(input), "https://app.example").searchParams.get("action") === "response"
        ? new Response("private quota details", { status: 429 }) : base(input, init),
      voice: { prepare: async () => ({ seconds: 1 }), speak: async () => {}, pause() {}, resume() {}, setMuted() {} },
    }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    expect((await screen.findByRole("status")).textContent).toContain("Too many requests right now. Please try again shortly.");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Prompt" }).closest(".panel")?.getAttribute("data-input-visible")).toBe("true"));
    expect(document.body.textContent).not.toContain("private quota details");
  });

  it("hydrates when voice input exists only in the browser", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { VideoChat } = await import("../src/react");
    const browser = window as unknown as Record<string, unknown>;
    const originalRecognition = browser.SpeechRecognition;
    delete browser.SpeechRecognition;
    const html = renderToString(<VideoChat options={{ fetcher: chatFetcher() }} />);
    browser.SpeechRecognition = class {};
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = hydrateRoot(container, <VideoChat options={{ fetcher: chatFetcher() }} />);
    try {
      await waitFor(() => expect(container.querySelector('[aria-label="Ask by voice"]')).toBeTruthy());
      expect(consoleError.mock.calls.flat().join(" ")).not.toMatch(/hydration failed/i);
    } finally {
      root.unmount();
      container.remove();
      if (originalRecognition === undefined) delete browser.SpeechRecognition;
      else browser.SpeechRecognition = originalRecognition;
    }
  });

  it("uses unique control ids and keeps playback preferences on each component root", async () => {
    const { VideoChat } = await import("../src/react");
    const { container } = render(<><VideoChat options={{ fetcher: chatFetcher() }} /><VideoChat options={{ fetcher: chatFetcher() }} /></>);
    const settings = await screen.findAllByRole("button", { name: "Settings" });
    const controlIds = settings.map((button) => button.getAttribute("aria-controls"));
    expect(new Set(controlIds).size).toBe(2);

    fireEvent.click(settings[0]!);
    fireEvent.click(await screen.findByRole("switch", { name: "Subtitles Read along with the answer" }));

    const roots = container.querySelectorAll(".vanillasky-video-chat");
    expect(roots[0]?.hasAttribute("data-theme")).toBe(false);
    expect(roots[1]?.hasAttribute("data-theme")).toBe(false);
    expect(screen.queryByRole("radio", { name: "Light" })).toBeNull();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    const source = readFileSync(join(process.cwd(), "src/video-chat/video-chat.tsx"), "utf8");
    expect(source).not.toContain('aria-haspopup="menu"');
  });

  it("submits welcome cards through the configured endpoint", async () => {
    const { VideoChat } = await import("../src/react");
    const requests: Array<{ action: string | null; body?: unknown }> = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { container } = render(<VideoChat options={{
      endpoint: "/my/video",
      fetcher: chatFetcher(requests, { url: "https://media.example/surreal-story.mp4", type: "video" }),
    }} />);

    fireEvent.click(await screen.findByRole("button", { name: "Invent a surreal bedtime story" }));
    await waitFor(() => expect(container.querySelector("[data-opening-chapter]")?.textContent)
      .toBe("Tonight, the impossible feels close enough to touch."));
    expect(container.querySelector(".stage video")).toBeNull();
    await waitFor(() => expect(requests).toContainEqual({
      action: "response",
      body: expect.objectContaining({
        prompt: "Invent a surreal bedtime story",
        opening: "Tonight, the impossible feels close enough to touch.",
      }),
    }));
    expect(requests.some(({ action }) => action === "opening-media")).toBe(false);
  });
});
