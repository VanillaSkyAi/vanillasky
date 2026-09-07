import type { VideoGenerationContext, VideoPlanPart, VideoPlanner, VideoScene } from "../protocol/types.js";
import { createTextDeltaVideoPlanner, type TextDeltaVideoPlannerOptions, type TextDeltaVideoSource } from "./model/text-stream.js";
import { attachGenerationLifecycleSink, getGenerationLifecycleSink } from "./lifecycle.js";
import { continueAfterOpening } from "./opening-continuity.js";
import { MEDIA_RECOVERY_NOTICE } from "../video-chat/recovery.js";
import type { MediaResolver } from "./media-resolver.js";

interface StockSelection { subject: string; activity?: string; equipment?: string; exclude?: string[] }

interface Shot {
  narration: string;
  title: string;
  subject: string;
  action: string;
  durationSec: number;
  continuity: "cut" | "continue";
  stockSelection?: StockSelection;
}
interface Brief {
  opening: string;
  subject: string;
  visualDirection: string;
  development: string;
  ending?: Shot;
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function text(value: unknown, maximum: number): string {
  // Never truncate spoken content or turn a partial scientific claim into a fact.
  return typeof value === "string" && value.trim().length <= maximum ? value.trim() : "";
}
function readStockSelection(value: unknown): StockSelection | undefined {
  const item = object(value);
  const phrase = (candidate: unknown): string | undefined => {
    if (typeof candidate !== "string") return;
    const normalized = candidate.trim().replace(/\s+/gu, " ");
    if (!normalized || normalized.length > 48 || !/^[\p{L}\p{N} '’-]+$/u.test(normalized)) return;
    const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
    return words.length >= 1 && words.length <= 4 ? normalized : undefined;
  };
  const subject = phrase(item?.subject);
  if (!subject) return;
  const activity = phrase(item?.activity), equipment = phrase(item?.equipment);
  const exclude = Array.isArray(item?.exclude) && item.exclude.length <= 3
    ? item.exclude.map(phrase).filter((value): value is string => value !== undefined) : [];
  return {subject, ...(activity ? {activity} : {}), ...(equipment ? {equipment} : {}), ...(exclude.length ? {exclude} : {})};
}
function chapterSubject(subject: string): string {
  const normalized = subject.replace(/\s+/gu, " ");
  if (normalized.length <= 65) return normalized;
  const prefix = normalized.slice(0, 65);
  const boundary = prefix.lastIndexOf(" ");
  return boundary > 0 ? prefix.slice(0, boundary) : "";
}
function readShot(value: unknown, clipDurationSec: number, answerSubject = ""): Shot {
  const item = object(value);
  const narration = text(item?.narration, 2_000);
  if (!narration) throw new Error("Chat shot requires bounded authored narration");
  const subject = text(item?.subject, 80);
  const title = text(item?.title, 65) || chapterSubject(subject) || chapterSubject(answerSubject);
  if (!title) throw new Error("Chat shot requires an authored chapter title or subject");
  return {
    narration,
    title,
    stockSelection: readStockSelection(item?.stockSelection),
    subject,
    action: text(item?.action, 600),
    durationSec: typeof item?.durationSec === "number" && Number.isFinite(item.durationSec) ? Math.min(clipDurationSec, Math.max(2, item.durationSec)) : clipDurationSec,
    continuity: item?.continuity === "continue" ? "continue" : "cut",
  };
}
function replaceStream(source: ReturnType<TextDeltaVideoPlannerOptions["streamText"]>, textStream: AsyncIterable<string>): ReturnType<TextDeltaVideoPlannerOptions["streamText"]> {
  if (!(typeof source === "object" && source != null && "textStream" in source)) return textStream;
  return new Proxy({ textStream } as TextDeltaVideoSource, {
    get(target, key, receiver) { return key === "textStream" ? Reflect.get(target, key, receiver) : Reflect.get(source, key, source); },
  });
}

/** Chat-only creative grammar. Generic structured composition keeps its own protocol. */
export function createChatShotPlanner(options: TextDeltaVideoPlannerOptions & {
  openingLine?: string;
  publishOpening: (opening: { line: string; keyword: string } | undefined) => void;
  resolveMedia?: MediaResolver;
  mediaConcurrency: number;
  generatedClipDurationSec?: number;
  mode?: "cinematic" | "pexels";
  prepareScene?: (scene: { sceneId: string; narration: string }) => void;
}): VideoPlanner {
  const clipDurationSec = options.generatedClipDurationSec ?? 5;
  const incomplete = new WeakSet<VideoGenerationContext>();
  const planner = createTextDeltaVideoPlanner({
    includeRawProviderData: options.includeRawProviderData,
    streamText(context) {
      const providerContext = { ...context, userPrompt: [
        `Create a complete answer within ${context.request.input.maxDurationSec ?? 40} seconds. Each generated clip has at most ${clipDurationSec} seconds; give each spoken beat room to finish.`,
        `Orientation: ${context.request.input.orientation ?? "landscape"}.`,
        "USER REQUEST AND CONVERSATION", context.request.input.input,
      ].join("\n") };
      const sink = getGenerationLifecycleSink(context);
      if (sink) attachGenerationLifecycleSink(providerContext, sink);
      let source: ReturnType<TextDeltaVideoPlannerOptions["streamText"]>;
      try { source = options.streamText(providerContext); } catch (cause) { options.publishOpening(undefined); throw cause; }
      const upstream = typeof source === "object" && source != null && "textStream" in source ? source.textStream : source;
      const translated = (async function* () {
        let brief: Brief | undefined, buffer = "", index = 0, bodyDuration = 0, lastNarration = "";
        let firstBody = true;
        const reject = (cause: unknown) => {
          incomplete.add(context);
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (!getGenerationLifecycleSink(context)?.rejectPart?.(error)) throw error;
        };
        const scenePart = (shot: Shot, closer = false): VideoPlanPart => {
          let narration = shot.narration;
          if (firstBody && !closer) narration = continueAfterOpening(narration, [options.openingLine ?? brief?.opening ?? ""]);
          firstBody = false;
          lastNarration = narration;
          return { type: "scene.add", ...(closer ? { placement: "closer" as const } : {}), scene: {
            id: `${context.request.requestId}-shot-${++index}`, templateId: "cinemaMedia",
            variables: { ...(options.mode === "pexels" && shot.stockSelection ? {stockSelection: shot.stockSelection} : {}), fallbackText: shot.title, mediaType: "video", mediaKeyword: shot.subject, shotDirection: [
              brief?.visualDirection,
              shot.action,
              shot.continuity === "continue" ? "Continue the established subject, setting and action consistently." : "A deliberate new shot; choose framing that reveals this beat.",
              "Silent illustration. No spoken dialogue, voiceover, written words or subtitles in the generated footage.",
            ].filter(Boolean).join("\n"), },
            narration, timing: { fixedDuration: shot.durationSec },
          } };
        };
        const line = (raw: string): VideoPlanPart | undefined => {
          const trimmed = raw.trim();
          if (!trimmed || /^```(?:json|ndjson)?$/i.test(trimmed)) return;
          const part = object(JSON.parse(trimmed));
          if (part?.type === "answer") {
            if (brief) throw new Error("Chat answer brief was emitted more than once");
            brief = { opening: text(part.opening, 300), subject: text(part.subject, 80), visualDirection: text(part.visualDirection, 600), development: text(part.development, 2_000) };
            if (part.ending) { try { brief.ending = readShot(part.ending, clipDurationSec, brief.subject); } catch (cause) { reject(cause); } }
            options.publishOpening(brief.opening ? { line: brief.opening, keyword: brief.subject } : undefined);
            return;
          }
          if (part?.type !== "shot") throw new Error("Chat plan requires an answer brief followed by shots");
          if (!brief) throw new Error("Chat shot arrived before its answer brief");
          const shot = readShot(part, clipDurationSec, brief.subject);
          if (shot.narration === brief.ending?.narration) return;
          if (firstBody && !continueAfterOpening(shot.narration, [options.openingLine ?? brief.opening])) return;
          const budget = (context.request.input.maxDurationSec ?? 40) - (brief.ending?.durationSec ?? clipDurationSec);
          if (bodyDuration + shot.durationSec > budget) throw new Error("Chat shot exceeds the answer duration budget");
          bodyDuration += shot.durationSec;
          return scenePart(shot);
        };
        try {
          for await (const delta of upstream) {
            context.signal.throwIfAborted();
            if (typeof delta !== "string") throw new Error("The LLM adapter returned a non-text delta");
            buffer += delta;
            if (buffer.length > 32_768) throw new Error("Chat plan line exceeds the bounded stream limit");
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
              const raw = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
              try { const part = line(raw); if (part) yield JSON.stringify(part) + "\n"; } catch (cause) { reject(cause); }
              newline = buffer.indexOf("\n");
            }
          }
          if (buffer.trim()) { try { const part = line(buffer); if (part) yield JSON.stringify(part) + "\n"; } catch (cause) { reject(cause); } }
          if (brief?.development && bodyDuration === 0) incomplete.add(context);
          if (brief?.ending && brief.ending.narration !== lastNarration) yield JSON.stringify(scenePart(brief.ending, true)) + "\n";
          else if (!brief?.ending) incomplete.add(context);
        } catch (cause) {
          if (!context.signal.aborted && brief?.ending && brief.ending.narration !== lastNarration) {
            yield JSON.stringify(scenePart(brief.ending, true)) + "\n";
          }
          throw cause;
        } finally { options.publishOpening(undefined); }
      })();
      return replaceStream(source, translated);
    },
  });
  return async function* (context) {
    let completed = false;
    for await (const part of resolveShots(planner(context), context, options)) {
      if (part.type === "plan.complete") completed = true;
      yield part;
    }
    if (!completed) {
      if (incomplete.has(context)) getGenerationLifecycleSink(context)?.reportWarning?.({ code: "plan_incomplete", category: "provider", message: "Some authored answer content could not be completed.", recoverable: true });
      yield { type: "plan.complete", ...(incomplete.has(context) ? { finishReason: "other" as const } : {}) };
    }
  };
}

/** Resolve ahead with bounded work, but emit in narrative order. */
async function* resolveShots(parts: AsyncIterable<VideoPlanPart>, context: VideoGenerationContext, options: { resolveMedia?: MediaResolver; mediaConcurrency: number; prepareScene?: (scene: { sceneId: string; narration: string }) => void }): AsyncGenerator<VideoPlanPart> {
  type Result = { part: VideoPlanPart } | { error: unknown };
  const queue: Promise<Result>[] = [];
  const iterator = parts[Symbol.asyncIterator]();
  const limit = Number.isFinite(options.mediaConcurrency) ? Math.min(5, Math.max(1, Math.floor(options.mediaConcurrency))) : 1;
  let done = false, closed = false, producerError: unknown;
  let notify: (() => void) | undefined, space: (() => void) | undefined;
  const resolve = async (part: VideoPlanPart): Promise<VideoPlanPart> => {
    if (part.type !== "scene.add") return part;
    options.prepareScene?.({ sceneId: part.scene.id, narration: part.scene.narration ?? "" });
    const { mediaKeyword } = part.scene.variables;
    let media;
    if (typeof mediaKeyword === "string" && mediaKeyword && options.resolveMedia) media = await options.resolveMedia(mediaKeyword, {
      input: context.request.input, requestId: context.request.requestId, scene: part.scene, templateId: "cinemaMedia", preferredType: "video", generatedLook: context.request.input.style?.generatedLook, signal: context.signal,
    });
    context.signal.throwIfAborted();
    if (!media) getGenerationLifecycleSink(context)?.reportWarning?.({ code: "provider_warning", category: "provider", message: MEDIA_RECOVERY_NOTICE, recoverable: true });
    const title = part.scene.variables.fallbackText;
    const scene: VideoScene = media
      ? { ...part.scene, variables: { fallbackText: title, mediaType: media.type === "image" ? "photo" : "video", mediaUrl: media.url, ...(media.posterUrl ? { mediaPoster: media.posterUrl } : {}) } }
      : { ...part.scene, templateId: "chapterTitle", variables: { title } };
    return { ...part, scene };
  };
  const producer = (async () => {
    try {
      while (!closed) {
        if (queue.length >= limit) await new Promise<void>(r => { space = r; });
        if (closed) break;
        const next = await iterator.next();
        if (next.done) break;
        queue.push(resolve(next.value).then(part => ({ part }), error => ({ error })));
        notify?.(); notify = undefined;
      }
    } catch (error) { producerError = error; }
    finally { done = true; notify?.(); notify = undefined; }
  })();
  try {
    while (!done || queue.length) {
      if (!queue.length) await new Promise<void>(r => { notify = r; });
      const item = queue[0]; if (!item) continue;
      const result = await item; queue.shift(); space?.(); space = undefined;
      if ("error" in result) throw result.error;
      yield result.part;
    }
    if (producerError) throw producerError;
  } finally {
    closed = true; space?.();
    void iterator.return?.().catch(() => undefined);
    void producer;
  }
}
