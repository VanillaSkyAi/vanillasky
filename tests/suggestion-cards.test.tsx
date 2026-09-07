// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SuggestionCards } from "../src/video-chat/suggestion-cards";

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
it("keeps video posters available for inactive cards and denied autoplay", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new DOMException("Autoplay blocked", "NotAllowedError"));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const { container } = render(<SuggestionCards label="Suggested prompts" onAsk={() => {}} suggestions={[
    {prompt:"Why do atoms bond?",media:{type:"video",url:"https://media.example/atom.mp4",posterUrl:"https://media.example/atom.jpg"}},
    {prompt:"Why did dinosaurs disappear?",media:{type:"video",url:"https://media.example/dinosaur.mp4",posterUrl:"https://media.example/dinosaur.jpg"}},
  ]} />);
  await Promise.resolve();
  const videos = container.querySelectorAll("video");
  expect(videos[0]!.poster).toBe("https://media.example/atom.jpg");
  expect(videos).toHaveLength(1);
  expect(container.querySelector('img[src="https://media.example/dinosaur.jpg"]')).toBeTruthy();
  expect(container.querySelectorAll("img.frame-poster")).toHaveLength(2);
  fireEvent.playing(videos[0]!);
  expect(container.querySelectorAll("img.frame-poster")).toHaveLength(1);
  fireEvent.error(videos[0]!);
  expect(container.querySelectorAll("img.frame-poster")).toHaveLength(2);
  fireEvent.pointerEnter(container.querySelectorAll(".cards button")[1]!);
  expect(container.querySelectorAll("video")).toHaveLength(1);
  expect(container.querySelector("video")!.src).toBe("https://media.example/dinosaur.mp4");
  expect(container.querySelector('img[src="https://media.example/atom.jpg"]')).toBeTruthy();
});

it("never advances the selected card without interaction", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({matches: false}));
  const { container } = render(<SuggestionCards label="Suggested prompts" onAsk={() => {}} suggestions={Array.from({length: 8}, (_, index) => ({prompt: `Prompt ${index + 1}`, media: null}))} />);
  act(() => { vi.advanceTimersByTime(16000); });
  expect(container.querySelector("button[data-active]")?.textContent).toBe("Prompt 1");
});

it("hover changes the preview without scrolling the rail", () => {
  const scrollTo = vi.fn();
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1500);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(390);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {value: scrollTo, configurable: true});
  const { container } = render(<SuggestionCards label="Suggested prompts" onAsk={() => {}} suggestions={Array.from({length: 8}, (_, index) => ({prompt: `Prompt ${index + 1}`, media: null}))} />);
  scrollTo.mockClear();
  fireEvent.pointerEnter(container.querySelectorAll(".cards button")[1]!);
  expect(scrollTo).not.toHaveBeenCalled();
  expect(container.querySelector("button[data-active]")?.textContent).toBe("Prompt 2");
});
