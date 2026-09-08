import { createElement, type ComponentType } from "react";
import type { SceneTemplateProps } from "../scene-templates/types.js";
import { SCENE_DEFINITIONS, type BuiltinSceneId } from "./builtin-metadata.js";

type SceneModule = { default: ComponentType<SceneTemplateProps> };

interface SceneRenderer {
  readonly component: ComponentType<SceneTemplateProps>;
  readonly defaults: Readonly<Record<string, unknown>>;
  preload(): Promise<void>;
}

function createRenderer(
  defaults: Readonly<Record<string, unknown>>,
  loader: () => Promise<SceneModule>,
): SceneRenderer {
  let loaded: SceneModule | undefined;
  let failure: unknown;
  let pending: Promise<void> | undefined;
  const preload = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (failure) return Promise.reject(failure);
    pending ??= loader().then(module => { loaded = module; }, (cause: unknown) => {
      failure = cause;
      throw cause;
    });
    return pending;
  };
  const component: ComponentType<SceneTemplateProps> = props => {
    if (loaded) return createElement(loaded.default, props);
    if (failure) throw failure;
    throw preload();
  };
  return Object.freeze({ component, defaults, preload });
}

const loaders: Record<BuiltinSceneId, () => Promise<SceneModule>> = {
  cinemaMedia: () => import("../scene-templates/cinema-media.js").then(module => ({ default: module.MediaSceneTemplate })),
  chapterTitle: () => import("../scene-templates/chapter-title.js").then(module => ({ default: module.TitleSceneTemplate })),
};
const renderers = new Map(SCENE_DEFINITIONS.map(scene => [
  scene.id,
  createRenderer(scene.defaults, loaders[scene.id]),
]));

export function getBuiltinSceneRenderer(id: string): SceneRenderer | undefined {
  return renderers.get(id as BuiltinSceneId);
}

/** Load the exact renderer state used by the player before its first frame. */
export function preloadBuiltinTemplate(id: string): Promise<void> | undefined {
  return getBuiltinSceneRenderer(id)?.preload();
}
