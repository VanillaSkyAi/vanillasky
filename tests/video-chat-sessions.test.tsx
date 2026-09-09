// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UseVideoChatResult } from "../src/video-chat/use-video-chat";
import { VideoChat } from "../src/video-chat/video-chat";

const session = vi.hoisted(() => ({ current: {} as UseVideoChatResult }));
vi.mock("../src/video-chat/use-video-chat", () => ({ useVideoChatSession: () => ({ chat: session.current, restoreSession: vi.fn(), getCaptionProgress: () => undefined }) }));

vi.mock("../src/player/video-player", () => ({ VideoPlayer: (props: { orientation?: string }) => <div data-testid="player" data-orientation={props.orientation} /> }));

beforeEach(() => {
  const turn = { id: "one", prompt: "Explain tides", completed: true, orientation: "landscape" as const, fixedOrientation: false, suggestions: [], opening: "The Moon moves our oceans." };
  session.current = {
    audioPreferences: { musicMood: "auto", voiceVolume: 1, musicVolume: .2, sceneVolume: .2 },
    backgroundDucked: false, backgroundWaiting: false,
    setAudioPreferences: vi.fn(), resetAudioPreferences: vi.fn(), shuffleMusic: vi.fn(),
    ask: vi.fn(async () => undefined), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), replay: vi.fn(), selectTurn: vi.fn(), reset: vi.fn(), setMuted: vi.fn(),
    turns: [turn], currentTurn: turn, shownTurn: turn, availableModes: ["cinematic"], status: "playing", warnings: [], suggestions: [],
    caption: "The tide rises.", transcript: ["The Moon moves our oceans.", "The tide rises.", "Then the tide falls."], speaking: true, muted: false, playbackEnded: false, playerKey: 0,
  };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });


it("combines new session and history in one Sessions control", () => {
  render(<VideoChat />);
  expect(screen.queryByRole("button", {name:"New session"})).toBeNull();
  expect(screen.queryByRole("button", {name:"History"})).toBeNull();
  fireEvent.click(screen.getByRole("button", {name:"Sessions"}));
  expect(screen.getByRole("dialog", {name:"Sessions"})).toBeTruthy();
  expect(screen.getByText("Current session")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"New session"}));
  expect(session.current.reset).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", {name:"Sessions"})).toBeNull();
});

it("closes Sessions when starting from an empty welcome screen", () => {
  session.current.turns=[];
  render(<VideoChat />);
  fireEvent.click(screen.getByRole("button", {name:"Sessions"}));
  fireEvent.click(screen.getByRole("button", {name:"New session"}));
  expect(screen.queryByRole("dialog", {name:"Sessions"})).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("textbox", {name:"Prompt"}));
});

it.each([undefined, { name: "Acme" }])("keeps the Home/reset shortcut without an explicit home URL (%s)", (branding) => {
  render(<VideoChat branding={branding} />);
  fireEvent.click(screen.getByRole("link", { name: branding ? "Acme home" : "Home" }));
  expect(session.current.reset).toHaveBeenCalledOnce();
});

it("leaves navigation to an explicit app home URL without resetting first", () => {
  render(<VideoChat branding={{ name: "Acme", homeUrl: "/app" }} />);
  const home = screen.getByRole("link", { name: "Acme home" });
  home.addEventListener("click", event => event.preventDefault());
  fireEvent.click(home);
  expect(session.current.reset).not.toHaveBeenCalled();
});
