import { getGenerationLifecycleSink } from "./lifecycle.js";
import { invokeIsolated } from "./composition-runtime.js";
import type { VideoPlanPart, VideoPlanner } from "../protocol/types.js";
import type { ServerTemplateRegistry } from "../visual-system/catalog/server-kit.js";
import type { TemplateJsonSchemaProperty } from "../visual-system/catalog/catalog-types.js";

/**
 * Trim a planner's copy to the length its template declared.
 *
 * A template's bounds are a layout contract - a headline that runs three lines
 * lands on top of the cards beneath it - so they are enforced, and a scene that
 * breaks one is rejected. That is right for the layout and wrong for the
 * viewer: the scene is dropped whole, and a five-scene answer arrives with
 * three, because a caption ran two characters long.
 *
 * Trimming is the kinder reading of the same contract. The bound is what the
 * layout can take; a line clipped to it still says most of what was written,
 * and the alternative is that the beat is not there at all. Every bound is
 * already in the planner's own schema, so this is a safety net under an
 * instruction the model was given, not a licence to ignore it.
 */
const ELLIPSIS = "…";

/**
 * Clip to a whole word where there is one, and add an ellipsis.
 *
 * Cutting mid-word reads as a bug rather than as brevity. The ellipsis is
 * inside the bound, not added to it, so the result still fits.
 */
export function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const room = Math.max(1, maxLength - ELLIPSIS.length);
  const clipped = value.slice(0, room);
  const lastSpace = clipped.lastIndexOf(" ");
  const body = lastSpace > room * 0.6 ? clipped.slice(0, lastSpace) : clipped;
  return `${body.trimEnd()}${ELLIPSIS}`;
}

function boundValue(value: unknown, schema: TemplateJsonSchemaProperty | undefined): unknown {
  if (!schema) return value;
  if (schema.format === "grounded-stat" || schema.format === "grounded-quote") return value;
  if (typeof value === "string") {
    return typeof schema.maxLength === "number" ? clipText(value, schema.maxLength) : value;
  }
  if (!Array.isArray(value)) return value;
  const items = typeof schema.maxItems === "number" ? value.slice(0, schema.maxItems) : value;
  return schema.items ? items.map((item) => boundValue(item, schema.items)) : items;
}

/**
 * Bound one scene's variables against its template.
 *
 * Unknown variables are left alone: this is about length, and rejecting a name
 * the template does not declare is the scene validator's job.
 */
export function boundSceneVariables(
  templates: ServerTemplateRegistry,
  templateId: string,
  variables: Record<string, unknown>,
): { variables: Record<string, unknown>; clipped: string[] } {
  const properties = templates.getTemplateMetadata(templateId)?.schema?.properties;
  if (!properties) return { variables, clipped: [] };

  const clipped: string[] = [];
  const bounded = Object.fromEntries(Object.entries(variables).map(([name, value]) => {
    const next = boundValue(value, properties[name]);
    if (next !== value && JSON.stringify(next) !== JSON.stringify(value)) clipped.push(name);
    return [name, next];
  }));
  return clipped.length > 0 ? { variables: bounded, clipped } : { variables, clipped };
}

/**
 * Wrap a planner so every scene it emits fits the bounds it was given.
 *
 * Measured across real video-chat responses, an over-long variable was the
 * single most common reason a scene never reached the browser - more common
 * than every other planner failure combined.
 */
export function createBoundedVariablePlanner(options: {
  planner: VideoPlanner;
  templates: ServerTemplateRegistry;
  /** Told which fields were trimmed, so a host can see it happening. */
  onClipped?: (templateId: string, fields: readonly string[]) => void;
}): VideoPlanner {
  return async function* boundPlan(context) {
    for await (let part of options.planner(context)) {
      if (part.type !== "scene.add") {
        yield part;
        continue;
      }
      try {
        const lifecycle = getGenerationLifecycleSink(context);
        if (!options.templates.getTemplateMetadata(part.scene.templateId) && lifecycle?.recoverGeneratedParts &&
          (context.request.capabilities?.templates == null || context.request.capabilities.templates.includes("chapterTitle"))) {
          const copy = [part.scene.variables.texts, part.scene.variables.title, part.scene.variables.message, part.scene.narration]
            .find((value): value is string => typeof value === "string" && Boolean(value.trim()) &&
              !/https?:\/\/|\b(?:api[_-]?key|authorization|secret|token|password)\s*[:=]/i.test(value));
          if (copy) {
            part = { ...part, scene: { ...part.scene, templateId: "chapterTitle", variables: { title: copy } } };
            lifecycle.reportWarning?.({ code: "provider_warning", category: "provider", message: "Some scenes use a simpler layout.", recoverable: true });
          }
        }
        const { variables, clipped } = boundSceneVariables(
          options.templates,
          part.scene.templateId,
          part.scene.variables,
        );
        if (clipped.length === 0) {
          yield part;
          continue;
        }
        const templateId = part.scene.templateId;
        invokeIsolated(options.onClipped && (() => options.onClipped!(templateId, clipped)), undefined);
        yield { ...part, scene: { ...part.scene, variables } } satisfies VideoPlanPart;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (!getGenerationLifecycleSink(context)?.rejectPart?.(error)) throw error;
      }
    }
  };
}
