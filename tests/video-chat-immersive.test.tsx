// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UseVideoChatResult } from "../src/video-chat/use-video-chat";
import { VideoChat } from "../src/video-chat/video-chat";

const session = vi.hoisted(() => ({ current: {} as UseVideoChatResult }));
vi.mock("../src/video-chat/use-video-chat", () => ({ useVideoChatSession: () => ({ chat: session.current, restoreSession: vi.fn() }) }));

vi.mock("../src/player/video-player", () => ({ VideoPlayer: (props: { orientation?: string }) => <div data-testid="player" data-orientation={props.orientation} /> }));

beforeEach(() => {
  const turn = { id: "one", prompt: "Explain tides", completed: true, orientation: "landscape" as const, fixedOrientation: false, suggestions: [], opening: "The Moon moves our oceans." };
  session.current = {
    ask: vi.fn(async () => undefined), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), replay: vi.fn(), selectTurn: vi.fn(), reset: vi.fn(), setMuted: vi.fn(),
    turns: [turn], currentTurn: turn, shownTurn: turn, availableModes: ["cinematic"], status: "playing", warnings: [], suggestions: [],
    caption: "The tide rises.", transcript: ["The Moon moves our oceans.", "The tide rises.", "Then the tide falls."], speaking: true, muted: false, playbackEnded: false, playerKey: 0,
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("replaces full-response and appearance controls with subtitle preferences", () => {
  render(<VideoChat />);
  expect(screen.queryByRole("button", { name: "Full response" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.queryByText("Appearance")).toBeNull();
  expect(screen.getByRole("switch", { name: "Subtitles Read along with the answer" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Keep controls visible Keep the input bar on screen" })).toBeTruthy();
});

it("expands the available transcript, hides it and restores subtitles", () => {
  render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Expand subtitles" }));
  const transcript = screen.getByRole("region", { name: "Expanded subtitles" });
  expect(transcript.textContent).toContain("The Moon moves our oceans.");
  expect(transcript.textContent).toContain("Then the tide falls.");
  fireEvent.click(screen.getByRole("button", { name: "Hide subtitles" }));
  expect(screen.queryByRole("region", { name: "Expanded subtitles" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("switch", { name: "Subtitles Read along with the answer" }));
  expect(screen.getByRole("button", { name: "Expand subtitles" })).toBeTruthy();
});

it("pauses to type a follow-up and resumes on canceling the question", () => {
  render(<VideoChat />);
  fireEvent.focus(screen.getByRole("textbox", { name: "Prompt" }));
  expect(session.current.pause).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Why twice daily?" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel question" }));
  expect(session.current.resume).toHaveBeenCalledOnce();
  expect(session.current.ask).not.toHaveBeenCalled();
});

it("submits a follow-up without resuming the previous answer", () => {
  render(<VideoChat />);
  fireEvent.focus(screen.getByRole("textbox", { name: "Prompt" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Why twice daily?" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  expect(session.current.ask).toHaveBeenCalledWith("Why twice daily?", undefined);
  expect(session.current.resume).not.toHaveBeenCalled();
});


it("keeps a deliberately paused answer paused when canceling a follow-up", () => {
  session.current.status = "paused";
  render(<VideoChat />);
  fireEvent.focus(screen.getByRole("textbox", { name: "Prompt" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel question" }));
  expect(session.current.pause).not.toHaveBeenCalled();
  expect(session.current.resume).not.toHaveBeenCalled();
});


it.each([
  { fixedPortrait: false, expected: "landscape" },
  { fixedPortrait: true, expected: "portrait" },
])("matches player and frame orientation on a landscape phone (fixed portrait=$fixedPortrait)", ({ fixedPortrait, expected }) => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") && !query.includes("orientation: portrait"),
    addEventListener() {}, removeEventListener() {},
  }));
  window.matchMedia = globalThis.matchMedia;
  session.current.shownTurn = { ...session.current.shownTurn!, fixedOrientation: fixedPortrait, orientation: fixedPortrait ? "portrait" : "landscape" };
  session.current.playerProps = { orientation: "auto" };
  const { container } = render(<VideoChat />);
  expect(container.querySelector(".vanillasky-video-chat")?.getAttribute("data-orientation")).toBe(expected);
  expect(screen.getByTestId("player").getAttribute("data-orientation")).toBe(expected);
  expect(container.querySelector<HTMLElement>(".player-fit")?.style.width).toContain(fixedPortrait ? "56.25" : "177.7778");
});

it("offers SDK discovery without leaving the current conversation", () => {
  render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const links = [
    ["Docs", "https://github.com/VanillaSkyAi/video/blob/main/docs/getting-started.md"],
    ["GitHub", "https://github.com/VanillaSkyAi/video"],
  ];
  for (const [name, href] of links) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toBe(href);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  }
  const about = screen.getByRole("button", { name: "About" });
  expect(about.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("region", { name: "About VanillaSky" })).toBeNull();
  fireEvent.click(about);
  expect(about.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("region", { name: "About VanillaSky" }).textContent).toContain("open-source SDK");
  fireEvent.click(about);
  expect(screen.queryByRole("region", { name: "About VanillaSky" })).toBeNull();
  expect(session.current.reset).not.toHaveBeenCalled();
});


it("restores the follow-up input after playback, keeps it visible through late suggestions, and hides again on replay", () => {
  vi.useFakeTimers();
  try {
    const { container, rerender } = render(<VideoChat />);
    const inputVisible = () => container.querySelector(".panel")?.getAttribute("data-input-visible");
    act(() => vi.advanceTimersByTime(3000));
    expect(inputVisible()).toBe("false");

    session.current = { ...session.current, playbackEnded: true, speaking: false, status: "ended" };
    rerender(<VideoChat />);
    expect(inputVisible()).toBe("true");
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Prompt" }));
    act(() => vi.advanceTimersByTime(5000));
    expect(inputVisible()).toBe("true");

    session.current = { ...session.current, suggestions: [{ prompt: "Why does the Moon pull on water?", media: null }], caption: "Then the tide falls." };
    rerender(<VideoChat />);
    act(() => vi.advanceTimersByTime(5000));
    expect(inputVisible()).toBe("true");

    session.current = { ...session.current, playbackEnded: false, speaking: true, status: "playing", playerKey: 1 };
    rerender(<VideoChat />);
    act(() => vi.advanceTimersByTime(3000));
    expect(inputVisible()).toBe("false");
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("does not let a final caption hide the input after playback has already ended", () => {
  vi.useFakeTimers();
  try {
    session.current = { ...session.current, caption: undefined, shownTurn: { ...session.current.shownTurn!, opening: undefined } };
    const { container, rerender } = render(<VideoChat />);
    session.current = { ...session.current, playbackEnded: true, speaking: false, status: "ended", caption: "The final words arrive." };
    rerender(<VideoChat />);
    act(() => vi.advanceTimersByTime(5000));
    expect(container.querySelector(".panel")?.getAttribute("data-input-visible")).toBe("true");
    expect(document.activeElement).not.toBe(screen.getByRole("textbox", { name: "Prompt" }));
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});

it("shows the spoken opening as a held chapter when opening media is absent", () => {
  session.current = { ...session.current, caption: session.current.shownTurn!.opening };
  const { container, rerender } = render(<VideoChat />);
  const title = container.querySelector('[data-opening-chapter] [data-title-composition="centered"]');
  expect(title?.textContent).toBe("The Moon moves our oceans.");
  expect(container.querySelector('.line')?.textContent).toBe("");
  expect(screen.getByRole("button", { name: "Expand subtitles" })).toBeTruthy();
  session.current = { ...session.current, playerProps: { video: { schemaVersion: "0.2", scenes: [], style: {} } } };
  rerender(<VideoChat />);
  expect(container.querySelector('[data-opening-chapter]')).toBeNull();
});

it.each(["video", "image"] as const)("returns broken opening %s media to the exact chapter hook", (type) => {
  const turn = { ...session.current.shownTurn!, openingMedia: {type, url:"https://media.example.test/broken"} };
  session.current = { ...session.current, shownTurn:turn, currentTurn:turn, turns:[turn] };
  const { container } = render(<VideoChat />);
  fireEvent.error(container.querySelector(type === "video" ? '.stage > video' : '.stage > img')!);
  expect(container.querySelector('[data-opening-chapter]')?.textContent).toBe(turn.opening);
  expect(container.querySelector('.stage > .frame-media')).toBeNull();
});

it("holds the chapter until late relevant media can actually paint", () => {
  const { container, rerender } = render(<VideoChat />);
  const turn = { ...session.current.shownTurn!, openingMedia: {type:"video" as const, url:"https://media.example.test/ocean.mp4"} };
  session.current = { ...session.current, shownTurn:turn, currentTurn:turn, turns:[turn] };
  rerender(<VideoChat />);
  expect(container.querySelector('[data-opening-chapter]')).not.toBeNull();
  fireEvent.playing(container.querySelector('.stage > video')!);
  expect(container.querySelector('[data-opening-chapter]')).toBeNull();
});
