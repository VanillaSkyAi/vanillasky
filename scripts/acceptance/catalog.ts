import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRenderTemplateRegistry,
  defineTemplate,
  type TemplateRegistry,
  type MotionTemplateDefinition,
} from "../../src/visual-system/catalog/internal";

interface RegistryTemplateItem {
  name: string;
  title?: string;
  description?: string;
  meta?: {
    vanillasky?: Record<string, unknown> & {
      layer?: string;
    };
  };
}

const registryDirectory = fileURLToPath(new URL("../../registry/items/", import.meta.url));

export const ACCEPTANCE_TEMPLATE_IDS = ["cinemaMedia", "chapterTitle", "focusCards", "editorialTimeline", "mobileMessage", "comparison", "quote", "keyFigure"] as const;

export function loadAcceptanceKit(templateIds?: readonly string[]): TemplateRegistry {
  const selected = templateIds ? new Set(templateIds) : undefined;
  const templates = readdirSync(registryDirectory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(
      readFileSync(join(registryDirectory, name), "utf8"),
    ) as RegistryTemplateItem)
    .filter((item) => item.meta?.vanillasky?.layer === "template")
    .filter((item) => !selected || selected.has(item.name))
    .map((item) => {
      const metadata = item.meta?.vanillasky ?? {};
      return defineTemplate({
        id: item.name,
        label: item.title ?? item.name,
        description: item.description ?? "",
        category: metadata.category,
        family: metadata.family,
        jobs: metadata.jobs,
        register: metadata.register,
        useWhen: metadata.useWhen ?? item.description,
        avoidWhen: metadata.avoidWhen,
        textCanvas: metadata.textCanvas,
        schema: metadata.schema,
        minDuration: metadata.minDuration,
        preferredDuration: metadata.preferredDuration,
        timing: metadata.timing,
        component: () => null,
      } as unknown as MotionTemplateDefinition);
    });
  return createRenderTemplateRegistry({ templates });
}
