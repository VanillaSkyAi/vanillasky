/**
 * Scene template registry — central lookup for all scene templates.
 *
 * AI composition uses listTemplateMetadata() to get serializable template info.
 * Renderers and editors use getTemplate() / listTemplates().
 */

import type { SceneTemplate, SceneTemplateMetadata } from "../catalog/types";
import { MediaSceneTemplate } from "./cinema-media";
import { TitleSceneTemplate } from "./chapter-title";
import { TimelineSceneTemplate } from "./editorial-timeline";
import { NotificationSceneTemplate } from "./mobile-message";
import { ComparisonSceneTemplate } from "./comparison";
import { QuoteSceneTemplate } from "./quote";
import { KeyFigureSceneTemplate } from "./key-figure";
import { BUILTIN_TEMPLATE_MANIFEST, type BuiltinTemplateId } from "../catalog/builtin-manifest";
const components = {"cinemaMedia": MediaSceneTemplate, "chapterTitle": TitleSceneTemplate, "editorialTimeline": TimelineSceneTemplate, "mobileMessage": NotificationSceneTemplate, "comparison": ComparisonSceneTemplate, "quote": QuoteSceneTemplate, "keyFigure": KeyFigureSceneTemplate} satisfies Record<BuiltinTemplateId, SceneTemplate["component"]>;

const templates: readonly SceneTemplate[] = Object.freeze(
  BUILTIN_TEMPLATE_MANIFEST.map((metadata) => Object.freeze({
    ...metadata,
    component: components[metadata.id],
  })),
);

// ─── Public API ─────────────────────────────────────────────────

export function getTemplate(id: string): SceneTemplate | undefined {
  return templates.find((template) => template.id === id);
}

export function listTemplates(): readonly SceneTemplate[] {
  return templates;
}

export function getTemplateComponent(id: string): SceneTemplate["component"] | undefined {
  return getTemplate(id)?.component;
}

/**
 * Get serializable metadata for a single template (no component).
 * Used by servers and other non-rendering consumers.
 */
export function getTemplateMetadata(id: string): SceneTemplateMetadata | undefined {
  const t = getTemplate(id);
  if (!t) return undefined;
  const { component: _component, ...metadata } = t;
  return metadata;
}

/**
 * Get serializable metadata for ALL templates.
 * Used by AI composition to pick templates from descriptions.
 */
export function listTemplateMetadata(): SceneTemplateMetadata[] {
  return templates.map(({ component: _component, ...metadata }) => metadata);
}
