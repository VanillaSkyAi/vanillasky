// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoChat, useVideoChat } from "../src/react";
import { createSceneTimeline } from "../src/protocol/scene-timeline";
import { encodeVideoSseEvent } from "../src/protocol/sse";
import type { VideoAudio } from "../src/protocol/types";
import { TEST_VIDEO_STYLE } from "./helpers/video-style";
import * as voiceModule from "../src/video-chat/voice";

const music: VideoAudio = { trackId: "cue", audioUrl: "https://app.example/audio-library/cue.mp3", duration: 146.6,
  sourceDuration: 146.6, volume: .15, beatDetection: { sensitivity: .5 }, beatMarkers: [], fadeOutMs: 1500 };
function voice() {
  return { prepare: vi.fn(async () => ({ seconds: 1 })), speak: vi.fn(async (_text: string, options: { onStart?: () => void }) => { options.onStart?.(); }),
    pause: vi.fn(), resume: vi.fn(), setMuted: vi.fn(), setVolume: vi.fn() };
}
function fetcher(requests: Array<Record<string, unknown>> = [], sceneAudio = true): typeof fetch {
  return vi.fn(async (input, init) => {
    const action = new URL(String(input), "https://app.example").searchParams.get("action");
    if (action === "capabilities") return Response.json({ templates: true, generatedSpeech: true,
      generatedVideo: true, generatedVideoAudio: sceneAudio, stockMedia: false, transcription: false, modes: ["cinematic"] });
    if (action === "welcome") return Response.json({ hero: null, cards: [] });
    if (action === "suggestions") return Response.json({ suggestions: [] });
    if (action === "response") {
      requests.push(JSON.parse(String(init?.body)));
      const timeline = createSceneTimeline({ style: TEST_VIDEO_STYLE, orientation: "landscape", audio: music });
      timeline.add({ id: "answer", templateId: "chapterTitle", variables: { title: "Ocean waves" },
        narration: "Waves carry energy toward the shore.", timing: { fixedDuration: 3 } });
      timeline.complete();
      let body = "";
      for await (const event of timeline.stream) body += encodeVideoSseEvent(event);
      return new Response(body + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(null, { status: 404 });
  });
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("keeps backgrounds ducked while the voice reports an audible line after a volume change", async () => {
  let reportActivity: ((active: boolean) => unknown) | undefined;
  const speech = voice();
  vi.spyOn(voiceModule, "createVideoChatVoice").mockImplementation(options => {
    reportActivity = options?.onActivityChange;
    return speech;
  });
  const request = fetcher();
  const { result } = renderHook(() => useVideoChat({ fetcher: request }));
  await act(async () => { await result.current.ask("Explain waves"); });
  act(() => { reportActivity?.(true); });
  act(() => result.current.setAudioPreferences({ voiceVolume: 0 }));
  expect(result.current.playerProps?.backgroundDucked).toBe(true);
  act(() => { reportActivity?.(false); });
  expect(result.current.playerProps?.backgroundDucked).toBe(false);
});

it("retains the selected soundtrack in paced playback and replay without another request", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const speech = voice();
  const request = fetcher(requests);
  const { result } = renderHook(() => useVideoChat({ fetcher: request, voice: speech }));
  await act(async () => { await result.current.ask("Explain waves"); });
  expect(result.current.shownTurn?.video?.audio).toEqual(music);
  const events = [];
  for await (const event of result.current.playerProps!.stream!) events.push(event);
  expect(events.find(event => event.type === "audio.set")?.data).toEqual({ audio: music });
  const selected = result.current.shownTurn?.video?.audio?.trackId;
  act(() => result.current.replay());
  expect(result.current.playerProps?.video?.audio?.trackId).toBe(selected);
  expect(requests).toHaveLength(1);
});

it("changes volume without changing speech timing, restarting playback or requesting generation", async () => {
  const speech = voice();
  const requests: Array<Record<string, unknown>> = [];
  const { result } = renderHook(() => useVideoChat({ fetcher: fetcher(requests), voice: speech }));
  await act(async () => { await result.current.ask("Explain waves"); });
  const key = result.current.playerKey;
  act(() => result.current.setAudioPreferences({ voiceVolume: 0, musicVolume: .3, sceneVolume: .12 }));
  expect(speech.setVolume).toHaveBeenLastCalledWith(0);
  expect(result.current.playerProps?.soundtrackVolume).toBe(.3);
  expect(result.current.playerProps?.nativeMediaAudio).toMatchObject({ volume: .12, ambientOnly: true });
  expect(result.current.playerKey).toBe(key);
  act(() => result.current.setMuted(true));
  expect(result.current.playerProps?.muted).toBe(true);
  act(() => result.current.setMuted(false));
  expect(result.current.audioPreferences.musicVolume).toBe(.3);
  expect(requests).toHaveLength(1);
});

it("saves explicit track changes across completion and replay without redrawing on volume changes", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const speech = voice();
  const { result } = renderHook(() => useVideoChat({ fetcher: fetcher(requests), voice: speech }));
  await act(async () => { await result.current.ask("Explain waves"); });
  const key = result.current.playerKey;
  act(() => result.current.setAudioPreferences({ musicMood: "calm" }));
  const chosen = result.current.shownTurn?.video?.audio?.trackId;
  expect(["countryside", "florist", "rainy-forest"]).toContain(chosen);
  act(() => result.current.shuffleMusic());
  expect(result.current.shownTurn?.video?.audio?.trackId).not.toBe(chosen);
  const shuffled = result.current.shownTurn?.video?.audio?.trackId;
  act(() => result.current.setAudioPreferences({ musicVolume: .2 }));
  expect(result.current.shownTurn?.video?.audio?.trackId).toBe(shuffled);
  expect(result.current.playerKey).toBe(key);
  act(() => result.current.replay());
  expect(result.current.playerProps?.video?.audio?.trackId).toBe(shuffled);
  expect(requests).toHaveLength(1);
  await act(async () => { await result.current.ask("Explain tides"); });
  expect(requests[1]).toMatchObject({ musicMood: "calm", previousTrackId: shuffled });
});

it("offers accessible music and voice sliders, remembers settings, and gates scene sound", async () => {
  const first = render(<VideoChat options={{ fetcher: fetcher([], false), voice: voice() }} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect((screen.getByRole("slider", { name: "Voice volume" }) as HTMLInputElement).value).toBe("100");
  expect((screen.getByRole("slider", { name: "Music volume" }) as HTMLInputElement).value).toBe("15");
  expect(screen.queryByRole("slider", { name: "Sound from video" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "Music mood" }), { target: { value: "focused" } });
  fireEvent.change(screen.getByRole("slider", { name: "Music volume" }), { target: { value: "22" } });
  first.unmount();
  render(<VideoChat options={{ fetcher: fetcher(), voice: voice() }} />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect((screen.getByRole("slider", { name: "Music volume" }) as HTMLInputElement).value).toBe("22");
  expect((screen.getByRole("combobox", { name: "Music mood" }) as HTMLSelectElement).value).toBe("focused");
  await waitFor(() => expect(screen.getByRole("slider", { name: "Sound from video" })).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Reset sound settings" }));
  expect((screen.getByRole("slider", { name: "Music volume" }) as HTMLInputElement).value).toBe("15");
});

it("keeps music off when replaying a different saved answer", async () => {
  const speech = voice();
  const request = fetcher();
  const { result } = renderHook(() => useVideoChat({ fetcher: request, voice: speech }));
  await act(async () => { await result.current.ask("Explain waves"); });
  const first = result.current.shownTurn!.id;
  await act(async () => { await result.current.ask("Explain tides"); });
  act(() => result.current.setAudioPreferences({ musicMood: "off" }));
  act(() => result.current.selectTurn(first));
  expect(result.current.playerProps?.soundtrack).toBe(false);
});

it("ignores malformed saved preferences and keeps controls usable when storage is blocked", () => {
  localStorage.setItem("vanillasky.audio", JSON.stringify({ voiceVolume: -1, musicVolume: "loud", sceneVolume: 4, musicMood: "untrusted" }));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  const { result } = renderHook(() => useVideoChat({ fetcher: fetcher(), voice: voice() }));
  expect(result.current.audioPreferences).toEqual({ musicMood: "auto", voiceVolume: 1, musicVolume: .15, sceneVolume: .15 });
  act(() => result.current.setAudioPreferences({ musicVolume: .2 }));
  expect(result.current.audioPreferences.musicVolume).toBe(.2);
});

it.each(["replay", "select"])("clears a previous audio wait on %s", async (action) => {
  const speech = voice();
  const request = fetcher();
  const { result } = renderHook(() => useVideoChat({ fetcher: request, voice: speech }));
  await act(async () => { await result.current.ask("Explain waves"); });
  act(() => result.current.playerProps?.onStallChange?.(true, "media-decoding"));
  expect(result.current.playerProps?.backgroundWaiting).toBe(true);
  act(() => action === "replay" ? result.current.replay() : result.current.selectTurn(result.current.shownTurn!.id));
  expect(result.current.playerProps?.backgroundWaiting).toBe(false);
});
