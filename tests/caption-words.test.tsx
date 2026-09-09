// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptionWords } from "../src/video-chat/caption-words";
import { captionWordAt, splitCaptionPhrases } from "../src/video-chat/caption-phrases";
import type { CaptionProgress } from "../src/video-chat/caption-progress";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("short caption phrases", () => {
  it("preserves every word and punctuation in readable two-to-four word phrases", () => {
    const text = "The tide rises, then the water falls. Watch the ocean find its rhythm.";
    const phrases = splitCaptionPhrases(text);
    expect(phrases[0]?.words.join(" ")).toBe("The tide rises,");
    expect(phrases.flatMap(phrase => phrase.words).join(" ")).toBe(text);
    expect(phrases.every(phrase => phrase.words.length >= 2 && phrase.words.length <= 4)).toBe(true);
    expect(phrases.map(phrase => phrase.start)).toEqual([0, 3, 7, 10]);
  });

  it("keeps Unicode, single-word answers, and very long words intact", () => {
    for (const text of ["Yes!", "🌻 Sunflowers face east.", "Pneumonoultramicroscopicsilicovolcanoconiosis is an unusually long word.", "光に向かって成長します。"])
      expect(splitCaptionPhrases(text).flatMap(phrase => phrase.words).join(" ")).toBe(text);
    expect(splitCaptionPhrases(" \n ")).toEqual([]);
    expect(splitCaptionPhrases("One two three four five").map(phrase => phrase.words.length)).toEqual([3, 2]);
  });
});

describe("word highlighting", () => {
  it("keeps short word phrases progressing when muted speech provides no clock", () => {
    vi.useFakeTimers();
    const text = "First we see the water flowing through the ancient city.";
    const getter = () => undefined;
    const view = render(<CaptionWords text={text} getProgress={getter} silent />);
    expect(view.container.textContent).toBe("First we see");
    act(() => { vi.advanceTimersByTime(1200); });
    const active = view.container.querySelector('[data-active="true"]')?.textContent;
    view.rerender(<CaptionWords text={text} getProgress={getter} silent paused />);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(view.container.querySelector('[data-active="true"]')?.textContent).toBe(active);
    view.rerender(<CaptionWords text={text} getProgress={getter} silent />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.container.textContent).toContain("ancient city.");
    expect(view.container.textContent).not.toBe(text);
    expect(view.container.querySelector(".word-captions")?.getAttribute("data-caption-alignment")).toBe("estimated");
  });

  it("holds the final native phrase when speech ends before its estimated duration", () => {
    vi.useFakeTimers();
    const text = "First we see the water flowing through the ancient city.";
    let state: CaptionProgress | undefined = { text, elapsedSeconds: 2, durationSeconds: 8, timing: "estimated", alignment: "browser", wordIndex: 9 };
    const getter = () => state;
    const view = render(<CaptionWords text={text} getProgress={getter} />);
    const finalPhrase = view.container.textContent;
    expect(finalPhrase).toContain("city.");
    state = undefined;
    view.rerender(<CaptionWords text={text} getProgress={getter} silent />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(view.container.textContent).toBe(finalPhrase);
    expect(view.container.querySelector('[data-active="true"]')).toBeNull();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(view.container.textContent).toBe(finalPhrase);
  });

  it("continues muted native speech without rewinding the current word", () => {
    vi.useFakeTimers();
    const text = "First we see the water flowing through the ancient city.";
    let state: CaptionProgress | undefined = { text, elapsedSeconds: 1, durationSeconds: 8, timing: "estimated", alignment: "browser", wordIndex: 5 };
    const getter = () => state;
    const view = render(<CaptionWords text={text} getProgress={getter} />);
    expect(view.container.querySelector('[data-active="true"]')?.textContent).toBe("flowing");
    state = undefined;
    view.rerender(<CaptionWords text={text} getProgress={getter} silent muted />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(view.container.querySelector('[data-active="true"]')?.textContent).toBe("flowing");
    view.rerender(<CaptionWords text={text} getProgress={getter} silent />);
    act(() => { vi.advanceTimersByTime(8000); });
    expect(view.container.textContent).toContain("city.");
    const finalPhrase = view.container.textContent;
    view.rerender(<CaptionWords text={text} getProgress={getter} silent />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(view.container.textContent).toBe(finalPhrase);
  });
  const words = ["First", "the", "water", "moves."];
  const wordTimings = words.map((text, index) => ({ text, start: 1 + index, end: 1.5 + index }));
  const progress = (elapsedSeconds: number): CaptionProgress => ({ text: words.join(" "), elapsedSeconds, durationSeconds: 9, timing: "audio", alignment: "provider", wordTimings });

  it("uses actual word intervals, including leading silence and pauses", () => {
    expect(captionWordAt(words, progress(0))).toMatchObject({ index: 0, active: false, alignment: "provider" });
    expect(captionWordAt(words, progress(2.2))).toMatchObject({ index: 1, active: true });
    expect(captionWordAt(words, progress(2.8))).toMatchObject({ index: 1, active: false });
    expect(captionWordAt(words, progress(4.2))).toMatchObject({ index: 3, active: true });
    expect(captionWordAt(words, progress(9))).toMatchObject({ index: 3, active: false });
    expect(captionWordAt(words, progress(1.1))).toMatchObject({ index: 0, active: true });
  });

  it("accepts overlapping provider spans and selects the latest started word", () => {
    const overlapping = wordTimings.map((word, index) => ({ ...word, end: 2.25 + index }));
    expect(captionWordAt(words, { ...progress(2.1), wordTimings: overlapping })).toMatchObject({ index: 1, active: true, alignment: "provider" });
  });

  it("follows browser speech boundaries without drifting with wall time", () => {
    expect(captionWordAt(words, { ...progress(8), wordTimings: undefined, wordIndex: 1, alignment: "browser" })).toMatchObject({ index: 1, active: true, alignment: "browser" });
  });

  it("uses a bounded estimated fallback when alignment is absent or mismatched", () => {
    expect(captionWordAt(words, { ...progress(0), wordTimings: undefined })).toMatchObject({ index: 0, alignment: "estimated" });
    expect(captionWordAt(words, { ...progress(8.9), wordTimings: wordTimings.slice(0, 1) })).toMatchObject({ index: 3, alignment: "estimated" });
    expect(captionWordAt(words, undefined)).toMatchObject({ index: 0, active: false, alignment: "estimated" });
  });

  it("holds at a paused clock, uses grouped speech, and resets for a new cue", () => {
    vi.useFakeTimers();
    const groupedText = "First the water moves. Then the city wakes.";
    let state: CaptionProgress | undefined = { text: groupedText, elapsedSeconds: 2, durationSeconds: 10, timing: "estimated", alignment: "browser", wordIndex: 5 };
    const getter = () => state;
    const view = render(<CaptionWords text="First the water moves." getProgress={getter} />);
    const line = () => view.container.querySelector(".word-captions")!;
    const active = () => view.container.querySelector('[data-active="true"]')?.textContent;
    expect(line().textContent).toBe("Then the city wakes.");
    expect(active()).toBe("the");
    act(() => { vi.advanceTimersByTime(700); });
    expect(active()).toBe("the");
    expect(line().getAttribute("aria-live")).toBe("off");
    state = undefined;
    act(() => { vi.advanceTimersByTime(50); });
    expect(active()).toBeUndefined();
    expect(line().textContent).toBe("Then the city wakes.");
    view.rerender(<CaptionWords text="A different opening starts." getProgress={getter} />);
    expect(line().textContent).toBe("A different opening starts.");
    expect(active()).toBeUndefined();
  });
});
