// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UseVideoChatResult } from "../src/video-chat/use-video-chat";
import { VideoChat } from "../src/video-chat/video-chat";

const session = vi.hoisted(() => ({ current: {} as UseVideoChatResult }));
vi.mock("../src/video-chat/use-video-chat", () => ({ useVideoChatSession: () => ({ chat: session.current, restoreSession: vi.fn(), getCaptionProgress: () => ({ text: session.current.caption, elapsedSeconds: 0, durationSeconds: 4, timing: "estimated" }) }) }));
vi.mock("../src/player/video-player", () => ({ VideoPlayer: () => null }));

beforeEach(() => {
  localStorage.clear();
  const turn = { id: "one", prompt: "Explain tides", completed: true, orientation: "landscape" as const, fixedOrientation: false, suggestions: [], opening: "The Moon moves our oceans." };
  session.current = {
    ask: vi.fn(async () => undefined), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), replay: vi.fn(), selectTurn: vi.fn(), reset: vi.fn(), setMuted: vi.fn(),
    turns: [turn], currentTurn: turn, shownTurn: turn, availableModes: ["cinematic"], status: "playing", warnings: [], suggestions: [],
    caption: "The tide rises, then the water falls.", transcript: ["The Moon moves our oceans.", "The tide rises, then the water falls."], speaking: true, muted: false, playbackEnded: false, playerKey: 0,
  };
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("defaults to word captions and reserves the full transcript for the ending", () => {
  const { container, rerender } = render(<VideoChat />);
  expect(container.querySelector(".word-captions")?.textContent).toBe("The tide rises,");
  expect(screen.queryByRole("button", { name: "Expand subtitles" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show transcript" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Word by word" }).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
  expect(container.querySelector(".word-captions")).toBeNull();
  expect(screen.queryByRole("button", { name: "Expand subtitles" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Transcript" })).toBeNull();
  expect(session.current.pause).not.toHaveBeenCalled();
  expect(session.current.ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  session.current = { ...session.current, playbackEnded: true, speaking: false, status: "ended" };
  rerender(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Show transcript" }));
  expect(screen.getByRole("region", { name: "Transcript" }).textContent).toContain("The tide rises, then the water falls.");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Hide transcript" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide transcript" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show transcript" }));
  expect(screen.queryByRole("region", { name: "Transcript" })).toBeNull();
  expect(screen.getByRole("button", { name: "Show transcript" })).toBeTruthy();
});

it.each([null, "unexpected", "words", "classic"])("respects an explicit Classic preference and otherwise defaults to words (%s)", (stored) => {
  if (stored !== null) localStorage.setItem("vanillasky:caption-style", stored);
  const { container } = render(<VideoChat />);
  expect(Boolean(container.querySelector(".word-captions"))).toBe(stored !== "classic");
});

it("makes the finished transcript available even with subtitles switched off", () => {
  const { rerender } = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Hide subtitles" }));
  expect(screen.queryByRole("button", { name: "Show transcript" })).toBeNull();
  session.current = { ...session.current, playbackEnded: true, speaking: false, status: "ended" };
  rerender(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Show transcript" }));
  expect(screen.getByRole("region", { name: "Transcript" }).textContent).toContain("The tide rises, then the water falls.");
  session.current = { ...session.current, playbackEnded: false, speaking: true, status: "playing", playerKey: 1 };
  rerender(<VideoChat />);
  expect(screen.queryByRole("region", { name: "Transcript" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Show transcript" })).toBeNull();
});

it("remembers an explicit Classic choice while the subtitles switch stays independent", () => {
  let view = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
  fireEvent.click(screen.getByRole("switch", { name: /Subtitles/ }));
  expect(view.container.querySelector(".caption-slot")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Classic" }).checked).toBe(true);
  view.unmount();
  view = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Classic" }).checked).toBe(true);
  expect(view.container.querySelector(".word-captions")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
  expect(view.container.querySelector(".word-captions")).toBeTruthy();
});

it("still changes style when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  const { container } = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Word by word" }).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
  expect(container.querySelector(".word-captions")).toBeNull();
});
