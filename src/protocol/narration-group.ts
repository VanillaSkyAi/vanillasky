import type { VideoScene } from "./types.js";

/** Host-authored timing, derived from prepared speech rather than model guesses. */
export interface VideoNarrationGroup {
  id: string;
  text: string;
  offsetSeconds: number;
  durationSeconds: number;
  totalSeconds: number;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 0.02;
const normalized = (text: string) => text.trim().replace(/\s+/gu, " ");

export function validateNarrationGroup(value: unknown): asserts value is VideoNarrationGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid narrationGroup");
  const group = value as Record<string, unknown>;
  if (Object.keys(group).some((key) => !["id", "text", "offsetSeconds", "durationSeconds", "totalSeconds"].includes(key))) throw new Error("Unknown narrationGroup field");
  for (const [key, maximum] of [["id", 128], ["text", 4000]] as const) {
    if (typeof group[key] !== "string" || !group[key].trim() || group[key].length > maximum) throw new Error(`Invalid narrationGroup.${key}`);
  }
  for (const key of ["offsetSeconds", "durationSeconds", "totalSeconds"] as const) {
    const number = group[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1800 || (key !== "offsetSeconds" && number === 0)) throw new Error(`Invalid narrationGroup.${key}`);
  }
  if ((group.offsetSeconds as number) + (group.durationSeconds as number) > (group.totalSeconds as number) + 0.02) throw new Error("Narration group segment exceeds its audio");
}

/** Validate complete groups before publishing their first scene to playback. */
export function validateNarrationGroups(scenes: readonly VideoScene[]): void {
  const seen = new Set<string>();
  for (let index = 0; index < scenes.length;) {
    const first = scenes[index]?.narrationGroup;
    if (!first) { index++; continue; }
    validateNarrationGroup(first);
    if (seen.has(first.id) || !close(first.offsetSeconds, 0)) throw new Error("Narration groups must be contiguous and start at zero");
    seen.add(first.id);
    let offset = 0;
    const fragments: string[] = [];
    while (index < scenes.length && scenes[index]?.narrationGroup?.id === first.id) {
      const scene = scenes[index]!;
      const group = scene.narrationGroup!;
      validateNarrationGroup(group);
      if (group.text !== first.text || !close(group.totalSeconds, first.totalSeconds) || !close(group.offsetSeconds, offset)) throw new Error("Narration group segments must share audio and contiguous offsets");
      if (!close(scene.timing.fixedDuration ?? -1, group.durationSeconds)) throw new Error("Narration group duration must match fixed scene duration");
      fragments.push(scene.narration ?? "");
      offset += group.durationSeconds;
      index++;
    }
    if (!close(offset, first.totalSeconds) || normalized(fragments.join(" ")) !== normalized(first.text)) throw new Error("Narration group must cover its complete spoken paragraph");
  }
}
