import { describe, expect, it } from "vitest";
import { parseSpeechWordTimings } from "../src/protocol/speech-timing";

describe("speech word timings", () => {
  const words = [
    { text: "Café,", start: 0.1, end: 0.5 },
    { text: "世界!", start: 0.6, end: 1 },
  ];

  it("preserves narration, punctuation and Unicode while normalizing whitespace", () => {
    expect(parseSpeechWordTimings(words, "  Café,\n\t世界!  ", 1.1)).toEqual(words);
  });

  it("copies only the public timing fields", () => {
    const enriched = words.map(word => ({ ...word, providerMetadata: "private" }));
    const parsed = parseSpeechWordTimings(enriched, "Café, 世界!");
    expect(parsed).toEqual(words);
    expect(parsed?.[0]).not.toBe(enriched[0]);
  });

  it.each([
    null, [], {}, [{ text: "Café,", start: 0, end: 0.5 }],
    [{ ...words[0], text: "Cafe," }, words[1]],
    [{ ...words[0], text: " Café," }, words[1]],
    [{ ...words[0], start: -1 }, words[1]],
    [{ ...words[0], start: NaN }, words[1]],
    [{ ...words[0], end: Infinity }, words[1]],
    [{ ...words[0], start: "0.1" }, words[1]],
    [{ ...words[0], end: 0.1 }, words[1]],
    [words[0], { ...words[1], start: 0.05 }],
    [words[0], { ...words[1], start: 0.1 }],
    [words[0], { ...words[1], end: 0.4 }],
    [words[0], { ...words[1], end: 301 }],
  ])("rejects incomplete, mismatched or incoherent timing data: %j", value => {
    expect(parseSpeechWordTimings(value, "Café, 世界!")).toBeUndefined();
  });

  it("rejects alignment outside a known duration or invalid duration", () => {
    for (const duration of [0.9, 0, -1, NaN, Infinity, 301]) {
      expect(parseSpeechWordTimings(words, "Café, 世界!", duration)).toBeUndefined();
    }
  });

  it("bounds total input and handles a small overlapping alignment without rewinding words", () => {
    expect(parseSpeechWordTimings([{ text: "x".repeat(1001), start: 0, end: 1 }], "x".repeat(1001))).toBeUndefined();
    expect(parseSpeechWordTimings([words[0], { ...words[1], start: 0.48 }], "Café, 世界!", 1)).toBeDefined();
  });
});
