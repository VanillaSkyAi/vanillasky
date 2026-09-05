import * as React from "react";
import { createElement } from "react";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import type { Video } from "../protocol/types.js";
import { VideoFrame } from "../player/video-frame.js";
import type { SceneTemplate } from "../visual-system/catalog/types.js";

export interface TemplateRenderCheckInput {
  sourceUrl: string;
  exportName: string;
  templateId: string;
  exampleName: string;
  variables: Record<string, unknown>;
  duration: number;
  timeoutMs: number;
}

export interface TemplateRenderCheckResult {
  renders: number;
}

function renderFrame(element: React.ReactElement, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    let renderError: unknown;
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.on("error", (error) => { clearTimeout(timeout); reject(error); });
    output.on("end", () => {
      clearTimeout(timeout);
      if (renderError == null) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(renderError);
    });
    const stream = renderToPipeableStream(element, {
      onAllReady: () => stream.pipe(output),
      onError: (error) => { renderError ??= error; },
    });
    const timeout = setTimeout(() => stream.abort(new Error(`SSR timed out after ${timeoutMs}ms`)), timeoutMs);
  });
}

export async function renderTemplateChecks(input: TemplateRenderCheckInput): Promise<TemplateRenderCheckResult> {
  // The source-side TSX loader may use the classic transform even though the
  // published bundle uses the automatic runtime.
  Object.assign(globalThis, { React });
  const progressPoints = [0, 0.5, 0.999] as const;
  let renders = 0;
  let importSequence = 0;
  for (const orientation of ["portrait", "landscape"] as const) {
    const [width, height] = orientation === "portrait" ? [1080, 1920] : [1920, 1080];
    const config: Video = {
      schemaVersion: "0.2",
      orientation,
      scenes: [{
        id: "authoring-check",
        templateId: input.templateId,
        variables: input.variables,
        timing: { startTime: 0, endTime: input.duration, fixedDuration: input.duration },
      }],
      style: {
      },
    };
    for (const progress of progressPoints) {
      let first: string;
      let second: string;
      try {
        const frame = async () => {
          const loaded = await import(`${input.sourceUrl}?vanillasky-render=${Date.now()}-${importSequence++}`) as Record<string, unknown>;
          const template = loaded[input.exportName] as SceneTemplate | undefined;
          if (!template || typeof template.component !== "function") throw new Error(`could not resolve export ${JSON.stringify(input.exportName)}`);
          const kit = {
            templates: [template],
            capabilities: { templates: [template.id] },
            getTemplate: (id: string) => id === template.id ? template : undefined,
            getTemplateMetadata: (id: string) => id === template.id ? template : undefined,
            listTemplateMetadata: () => [template],
          };
          return renderFrame(createElement(VideoFrame, {
            kit,
            config,
            time: progress * input.duration,
            width,
            height,
          }), input.timeoutMs);
        };
        first = await frame();
        second = await frame();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${input.templateId} example ${JSON.stringify(input.exampleName)} ${orientation} at progress ${progress}: ${detail}`);
      }
      if (first !== second) {
        throw new Error(`${input.templateId} example ${JSON.stringify(input.exampleName)} ${orientation} at progress ${progress} is nondeterministic`);
      }
      renders += 2;
    }
  }
  return { renders };
}
