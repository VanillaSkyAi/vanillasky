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

it("offers an optional word style without interrupting playback or shortening the transcript", () => {
  const { container } = render(<VideoChat />);
  expect(container.querySelector(".word-captions")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const classic = screen.getByRole<HTMLInputElement>("radio", { name: "Classic" });
  expect(classic.checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
  expect(container.querySelector(".word-captions")?.textContent).toBe("The tide rises,");
  expect(session.current.pause).not.toHaveBeenCalled();
  expect(session.current.ask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand subtitles" }));
  expect(screen.getByRole("region", { name: "Expanded subtitles" }).textContent).toContain("The tide rises, then the water falls.");
  fireEvent.click(screen.getByRole("button", { name: "Collapse subtitles" }));
  expect(container.querySelector(".word-captions")).toBeTruthy();
});

it("remembers the style while the subtitles switch stays independent", () => {
  let view = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
  fireEvent.click(screen.getByRole("switch", { name: /Subtitles/ }));
  expect(view.container.querySelector(".caption-slot")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Word by word" }).checked).toBe(true);
  view.unmount();
  view = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Word by word" }).checked).toBe(true);
  expect(view.container.querySelector(".word-captions")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Classic" }));
  expect(view.container.querySelector(".word-captions")).toBeNull();
});

it("still changes style when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  const { container } = render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("radio", { name: "Word by word" }));
  expect(container.querySelector(".word-captions")).toBeTruthy();
});
