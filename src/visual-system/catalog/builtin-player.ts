import { createElement } from "react";
import {
  GENERATED_BUILTIN_TEMPLATE_LOADERS,
  type BuiltinTemplateModule,
} from "./builtin-loaders.generated.js";
import { GENERATED_BUILTIN_PLAYER_TEMPLATES, GENERATED_BUILTIN_VIDEO_BACKDROP_IDS } from "./builtin-player.generated.js";
import {
  createPlayerTemplateRegistry,
  type PlayerTemplate,
} from "./player-kit.js";

import { markExternalVideoBackdropTemplate } from "./video-backdrop-capability.js";

interface PreloadableBuiltinTemplate {
  component: PlayerTemplate["component"];
  preload(): Promise<void>;
}

function createPreloadableBuiltinTemplate(
  loader: () => Promise<BuiltinTemplateModule>,
  mediaBackdrop: boolean,
): PreloadableBuiltinTemplate {
  let loaded: BuiltinTemplateModule | undefined;
  let failure: unknown;
  let pending: Promise<void> | undefined;

  const preload = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (failure) return Promise.reject(failure);
    pending ??= loader().then(
      (module) => {
        loaded = module;
      },
      (cause: unknown) => {
        failure = cause;
        throw cause;
      },
    );
    return pending;
  };

  const component: PlayerTemplate["component"] = (props) => {
    if (loaded) return createElement(loaded.default, props);
    if (failure) throw failure;
    throw preload();
  };

  const template = { component, preload };
  return mediaBackdrop ? markExternalVideoBackdropTemplate(template) : template;
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) freezeValue(nested);
    Object.freeze(value);
  }
  return value;
}

const preloadableById = new Map(
  GENERATED_BUILTIN_PLAYER_TEMPLATES.map(({ id }) => [
    id,
    createPreloadableBuiltinTemplate(GENERATED_BUILTIN_TEMPLATE_LOADERS[id], GENERATED_BUILTIN_VIDEO_BACKDROP_IDS.includes(id)),
  ] as const),
);

const builtinPlayerTemplates: readonly PlayerTemplate[] = Object.freeze(
  GENERATED_BUILTIN_PLAYER_TEMPLATES.map((template) => Object.freeze({
    ...template,
    defaults: freezeValue({ ...template.defaults }),
    component: preloadableById.get(template.id)!.component,
  })),
);

export const BUILTIN_PLAYER_KIT = createPlayerTemplateRegistry(builtinPlayerTemplates);

/** Load the exact renderer state used by the player before its first frame. */
export function preloadBuiltinTemplate(id: string): Promise<void> | undefined {
  return preloadableById.get(id as keyof typeof GENERATED_BUILTIN_TEMPLATE_LOADERS)?.preload();
}
