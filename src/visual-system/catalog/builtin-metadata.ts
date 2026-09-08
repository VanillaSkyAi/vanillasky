/** Internal scene definitions. The chat product renders footage and quiet chapters. */
export type BuiltinSceneId = "cinemaMedia" | "chapterTitle";

export interface BuiltinSceneDefinition {
  readonly id: BuiltinSceneId;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly minDuration: number;
  readonly preferredDuration: number;
  readonly timing: {
    readonly contentFields: readonly string[];
    readonly contentUnit: "words";
    readonly revealSeconds: number;
    readonly holdSeconds: number;
    readonly exitSeconds: number;
  };
}

export const SCENE_DEFINITIONS: readonly BuiltinSceneDefinition[] = Object.freeze([
  Object.freeze({
    id: "cinemaMedia" as const,
    defaults: Object.freeze({ mediaUrl: "", mediaType: "video", mediaPoster: "" }),
    minDuration: 3,
    preferredDuration: 6,
    timing: Object.freeze({ contentFields: Object.freeze([]), contentUnit: "words" as const, revealSeconds: 0, holdSeconds: 3, exitSeconds: 0 }),
  }),
  Object.freeze({
    id: "chapterTitle" as const,
    defaults: Object.freeze({ title: "A different perspective" }),
    minDuration: 3,
    preferredDuration: 4,
    timing: Object.freeze({ contentFields: Object.freeze(["title"]), contentUnit: "words" as const, revealSeconds: .8, holdSeconds: 1.5, exitSeconds: .8 }),
  }),
]);

export function getBuiltinSceneDefinition(id: string): BuiltinSceneDefinition | undefined {
  return SCENE_DEFINITIONS.find(scene => scene.id === id);
}
