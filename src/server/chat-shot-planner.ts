import { compileVisualDirection, type AnswerIntent, type AnswerVisualStyle } from "./chat-visual-direction.js";
import type { VideoGenerationContext, VideoPlanPart, VideoPlanner, VideoScene } from "../protocol/types.js";
import { createTextDeltaVideoPlanner, type TextDeltaVideoPlannerOptions, type TextDeltaVideoSource } from "./model/text-stream.js";
import { attachGenerationLifecycleSink, getGenerationLifecycleSink } from "./lifecycle.js";
import { continueAfterOpening } from "./opening-continuity.js";
import { MEDIA_RECOVERY_NOTICE } from "../video-chat/recovery.js";
import type { MediaResolver, ResolvedMedia } from "./media-resolver.js";
import { estimateNarrationSeconds, narrationFitsClip, CLIP_NARRATION_TAIL_SEC } from "../protocol/clip-budget.js";

export interface ChatPlannerTextContext extends VideoGenerationContext {
  userPrompt: string;
}

export type ChatPlannerText = (context: ChatPlannerTextContext) => ReturnType<TextDeltaVideoPlannerOptions["streamText"]>;

export interface ShotPreparation {
  sceneId: string;
  narration: string;
  media?: ResolvedMedia;
  clipDurationSec?: number;
}

interface ShotResolutionOptions {
  mode?: "cinematic" | "pexels";
  resolveMedia?: MediaResolver;
  mediaConcurrency: number;
  prepareScene?: (scene: ShotPreparation) => void;
  rewriteNarration?: (text: string, durationSec: number, signal: AbortSignal) => Promise<string>;
  onNarrationFit?: (sceneId: string, estimatedSpeechSec: number, clipDurationSec: number, reason: "fit" | "rewritten" | "oversized") => void;
  onNarrationRewrite?: (event: {
    sceneId: string; clipDurationSec: number; durationMs: number;
    reason: "rewritten" | "empty" | "oversized" | "timeout" | "provider-error" | "cancelled";
  }) => void;
}

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
  intent: AnswerIntent;
  visualStyle: AnswerVisualStyle;
  opening: string;
  subject: string;
  visualDirection: string;
  development: string;
  ending?: Shot;
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Closed structural evidence only: never retain model keys, values or text. */
function planShapeError(value: unknown): Error {
  const part = object(value);
  const has = (key: string) => Boolean(part && Object.hasOwn(part, key));
  const shape = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const discriminator = !has("type") ? "missing"
    : part!.type === "answer" || part!.type === "shot" ? part!.type
    : typeof part!.type === "string" ? "other-string" : "non-string";
  return new Error("Chat plan requires an answer brief followed by shots", { cause: {
    code: "chat_plan_shape", shape, discriminator,
    fields: { opening: has("opening"), subject: has("subject"), development: has("development"),
      visualDirection: has("visualDirection"), ending: has("ending") },
  } });
}
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
    // The adapter owns supported duration. A model cannot silently request a different paid clip.
    durationSec: clipDurationSec,
    continuity: item?.continuity === "continue" ? "continue" : "cut",
  };
}
/** Recover only a complete first brief; never infer missing authored content. */
function recoverFirstBrief(part: Record<string, unknown> | undefined, clipDurationSec: number): Brief | undefined {
  if (!part || typeof part.type !== "string" || !part.type.trim() || part.type === "answer" || part.type === "shot") return;
  const bounded = (value: unknown, maximum: number, allowEmpty = false): value is string =>
    typeof value === "string" && value.trim().length <= maximum && (allowEmpty || Boolean(value.trim()));
  if (!["opening", "subject", "development", "visualDirection", "ending"].every(key => Object.hasOwn(part, key))
    || !bounded(part.opening, 300) || !bounded(part.subject, 80)
    || !bounded(part.development, 2_000, true) || !bounded(part.visualDirection, 600)) return;
  const ending = object(part.ending);
  if (!ending || !bounded(ending.narration, 2_000)
    || !bounded(ending.subject, 80, true) || !bounded(ending.action, 600, true)
    || (Object.hasOwn(ending, "title") && !bounded(ending.title, 65))
    || typeof ending.durationSec !== "number" || !Number.isFinite(ending.durationSec)
    || (ending.continuity !== "cut" && ending.continuity !== "continue")) return;
  const subject = text(part.subject, 80);
  // Preserve the regular shot contract: authored subject/title fallback and
  // bounded duration normalization. Invalid content above is never defaulted.
  return { ...compileVisualDirection(part), opening: text(part.opening, 300), subject, development: text(part.development, 2_000),
    visualDirection: text(part.visualDirection, 600), ending: readShot(ending, clipDurationSec, subject) };
}
function replaceStream(source: ReturnType<TextDeltaVideoPlannerOptions["streamText"]>, textStream: AsyncIterable<string>): ReturnType<TextDeltaVideoPlannerOptions["streamText"]> {
  if (!(typeof source === "object" && source != null && "textStream" in source)) return textStream;
  return new Proxy({ textStream } as TextDeltaVideoSource, {
    get(target, key, receiver) { return key === "textStream" ? Reflect.get(target, key, receiver) : Reflect.get(source, key, source); },
  });
}

/** Chat-only creative grammar. Generic structured composition keeps its own protocol. */
export function createChatShotPlanner(options: Omit<TextDeltaVideoPlannerOptions, "streamText"> & ShotResolutionOptions & {
  streamText: ChatPlannerText;
  openingLine?: string;
  publishOpening: (opening: { line: string; keyword: string } | undefined) => void;
  generatedClipDurationSec?: number;
}): VideoPlanner {
  const clipDurationSec = options.mode === "pexels" ? undefined : options.generatedClipDurationSec ?? 5;
  // Planning slots bound record count, not the physical length of stock footage.
  // Playback establishes stock timing from speech and available media instead.
  const planningSlotSec = clipDurationSec ?? 5;
  const incomplete = new WeakSet<VideoGenerationContext>();
  const generatedLooks = new WeakMap<VideoGenerationContext, string>();
  const planner = createTextDeltaVideoPlanner({
    includeRawProviderData: options.includeRawProviderData,
    streamText(context) {
      const providerContext = { ...context,
        userPrompt: [
        `Create a complete answer from concise spoken beats. ${context.request.input.maxDurationSec ?? 40} seconds is the overall ceiling, not a target to fill.`,
        `Orientation: ${context.request.input.orientation ?? "landscape"}.`,
        ...(context.request.input.style?.generatedLook ? [`CALLER VISUAL DIRECTION (takes precedence over automatic style): ${context.request.input.style.generatedLook}`] : []),
        "USER REQUEST AND CONVERSATION", context.request.input.input,
      ].join("\n") };
      const sink = getGenerationLifecycleSink(context);
      if (sink) attachGenerationLifecycleSink(providerContext, sink);
      let source: ReturnType<TextDeltaVideoPlannerOptions["streamText"]>;
      try { source = options.streamText(providerContext); } catch (cause) { options.publishOpening(undefined); throw cause; }
      const upstream = typeof source === "object" && source != null && "textStream" in source ? source.textStream : source;
      const translated = (async function* () {
        let brief: Brief | undefined, buffer = "", index = 0, bodyDuration = 0, lastNarration = "";
        let firstBody = true, recordsSeen = 0;
        const reject = (cause: unknown) => {
          incomplete.add(context);
          const error = cause instanceof Error ? cause : new Error(String(cause));
          if (!getGenerationLifecycleSink(context)?.rejectPart?.(error)) throw error;
        };
        const acceptDirection = (value: Brief) => {
          const direction = compileVisualDirection(value, context.request.input.style?.generatedLook);
          generatedLooks.set(context, direction.generatedLook);
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
            narration, timing: options.mode === "pexels" ? {} : { fixedDuration: shot.durationSec },
          } };
        };
        const line = (raw: string): VideoPlanPart | undefined => {
          const trimmed = raw.trim();
          if (!trimmed || /^```(?:json|ndjson)?$/i.test(trimmed)) return;
          const firstRecord = recordsSeen++ === 0;
          const value: unknown = JSON.parse(trimmed);
          const part = object(value);
          const recovered = firstRecord && !brief && index === 0 ? recoverFirstBrief(part, planningSlotSec) : undefined;
          if (recovered) {
            brief = recovered;
            acceptDirection(brief);
            options.publishOpening({ line: brief.opening, keyword: brief.subject });
            return;
          }
          if (part?.type === "answer") {
            if (brief) throw new Error("Chat answer brief was emitted more than once");
            brief = { ...compileVisualDirection(part), opening: text(part.opening, 300), subject: text(part.subject, 80), visualDirection: text(part.visualDirection, 600), development: text(part.development, 2_000) };
            acceptDirection(brief);
            if (part.ending) { try { brief.ending = readShot(part.ending, planningSlotSec, brief.subject); } catch (cause) { reject(cause); } }
            options.publishOpening(brief.opening ? { line: brief.opening, keyword: brief.subject } : undefined);
            return;
          }
          if (part?.type !== "shot") throw planShapeError(value);
          if (!brief) throw new Error("Chat shot arrived before its answer brief");
          const shot = readShot(part, planningSlotSec, brief.subject);
          if (shot.narration === brief.ending?.narration) return;
          if (firstBody && !continueAfterOpening(shot.narration, [options.openingLine ?? brief.opening])) return;
          const budget = (context.request.input.maxDurationSec ?? 40) - (brief.ending?.durationSec ?? planningSlotSec);
          if (bodyDuration + shot.durationSec > budget) throw new Error("Chat shot exceeds the answer duration budget");
          bodyDuration += shot.durationSec;
          return scenePart(shot);
        };
        let cursor = 0, depth = 0, quoted = false, escaped = false;
        const takeFrame = (): string | undefined => {
          if (cursor === 0) {
            buffer = buffer.trimStart();
            if (!buffer) return;
            if (buffer[0] !== "{" && buffer[0] !== "[") {
              const newline = buffer.indexOf("\n");
              if (newline < 0) return;
              const raw = buffer.slice(0, newline);
              buffer = buffer.slice(newline + 1);
              return raw;
            }
          }
          // Frame complete JSON containers, not physical lines. Arrays remain
          // whole so semantic validation rejects them instead of extracting
          // their nested objects. Each character is scanned once across deltas.
          for (; cursor < buffer.length; cursor++) {
            const character = buffer[cursor];
            if (quoted) {
              // After a valid brief, a physical newline inside a top-level
              // string is never valid JSON.
              // Reject this record without consuming the following independent one.
              // Nested/array values stay whole; never extract their inner records.
              if ((character === "\n" || character === "\r") && brief && depth === 1 && buffer[0] === "{") {
                const raw = buffer.slice(0, cursor + 1);
                buffer = buffer.slice(cursor + 1);
                cursor = depth = 0; quoted = escaped = false;
                return raw;
              }
              if (escaped) escaped = false;
              else if (character === "\\") escaped = true;
              else if (character === '"') quoted = false;
            } else if (character === '"') quoted = true;
            else if (character === "{" || character === "[") depth++;
            else if (character === "}" || character === "]") {
              depth--;
              if (depth === 0) {
                const raw = buffer.slice(0, cursor + 1);
                buffer = buffer.slice(cursor + 1);
                cursor = 0;
                return raw;
              }
            }
          }
        };
        try {
          for await (const delta of upstream) {
            context.signal.throwIfAborted();
            if (typeof delta !== "string") throw new Error("The LLM adapter returned a non-text delta");
            // Provider chunk boundaries are arbitrary. Bound the unfinished
            // record, not a chunk that can contain many complete records.
            for (let offset = 0; offset < delta.length;) {
              const capacity = 32_768 - buffer.length;
              if (capacity <= 0) throw new Error("Chat plan line exceeds the bounded stream limit");
              const piece = delta.slice(offset, offset + capacity);
              buffer += piece;
              offset += piece.length;
              let raw = takeFrame();
              while (raw !== undefined) {
                try { const part = line(raw); if (part) yield JSON.stringify(part) + "\n"; } catch (cause) { reject(cause); }
                raw = takeFrame();
              }
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
    for await (const part of resolveShots(planner(context), context, options, () => options.mode === "pexels" ? context.request.input.style?.generatedLook : generatedLooks.get(context))) {
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
async function* resolveShots(parts: AsyncIterable<VideoPlanPart>, context: VideoGenerationContext, options: ShotResolutionOptions, generatedLook: () => string | undefined): AsyncGenerator<VideoPlanPart> {
  type Result = { part: VideoPlanPart } | { error: unknown };
  const queue: Promise<Result>[] = [];
  const iterator = parts[Symbol.asyncIterator]();
  const limit = Number.isFinite(options.mediaConcurrency) ? Math.min(5, Math.max(1, Math.floor(options.mediaConcurrency))) : 1;
  let done = false, closed = false, producerError: unknown;
  let notify: (() => void) | undefined, space: (() => void) | undefined;
  const resolve = async (part: VideoPlanPart): Promise<VideoPlanPart> => {
    if (part.type !== "scene.add") return part;
    const original = part.scene.narration ?? "";
    let durationSec = part.scene.timing.fixedDuration ?? 5;
    let narration = original;
    const { mediaKeyword } = part.scene.variables;
    let mediaScene = part.scene;
    const resolveMedia = () => typeof mediaKeyword === "string" && mediaKeyword && options.resolveMedia
      ? options.resolveMedia(mediaKeyword, {
        input: context.request.input, requestId: context.request.requestId, scene: mediaScene, templateId: "cinemaMedia", preferredType: "video", generatedLook: generatedLook() ?? context.request.input.style?.generatedLook, signal: context.signal,
      }) : undefined;
    // Search is not a paid generation submission. Resolve stock first so fit
    // and any single rewrite use the selected clip, not a generated-video cap.
    let media = options.mode === "pexels" ? await resolveMedia() : undefined;
    context.signal.throwIfAborted();
    if (options.mode === "pexels") durationSec = media?.durationSec ?? Math.max(durationSec, estimateNarrationSeconds(narration) + CLIP_NARRATION_TAIL_SEC);
    if (!narrationFitsClip(narration, durationSec) && options.resolveMedia && options.rewriteNarration) {
      const rewriteStartedAt = Date.now();
      let reason: Parameters<NonNullable<ShotResolutionOptions["onNarrationRewrite"]>>[0]["reason"];
      try {
        const rewritten = (await options.rewriteNarration(original, durationSec, context.signal)).trim();
        reason = !/[\p{L}\p{N}]/u.test(rewritten) ? "empty" : rewritten.length > 2000 || !narrationFitsClip(rewritten, durationSec) ? "oversized" : "rewritten";
        if (reason === "rewritten") narration = rewritten;
      } catch (cause) {
        reason = context.signal.aborted ? "cancelled" : cause instanceof DOMException && cause.name === "TimeoutError" ? "timeout" : "provider-error";
      }
      options.onNarrationRewrite?.({ sceneId: part.scene.id, clipDurationSec: durationSec, durationMs: Math.max(0, Date.now() - rewriteStartedAt), reason });
    }
    context.signal.throwIfAborted();
    const fits = narrationFitsClip(narration, durationSec);
    const clipBudget = options.mode === "pexels" && !media?.durationSec ? undefined : durationSec;
    if (clipBudget !== undefined) options.onNarrationFit?.(part.scene.id, estimateNarrationSeconds(narration), clipBudget, !fits ? "oversized" : narration === original ? "fit" : "rewritten");
    part = { ...part, scene: { ...part.scene, narration } };
    mediaScene = part.scene;
    options.prepareScene?.({ sceneId: part.scene.id, narration, clipDurationSec: clipBudget });
    if (!fits) media = undefined;
    else if (options.mode !== "pexels") media = await resolveMedia();
    context.signal.throwIfAborted();
    if (!media) getGenerationLifecycleSink(context)?.reportWarning?.({ code: "provider_warning", category: "provider", message: MEDIA_RECOVERY_NOTICE, recoverable: true });
    const title = part.scene.variables.fallbackText;
    const scene: VideoScene = media
      ? { ...part.scene, variables: { fallbackText: title, mediaType: media.type === "image" ? "photo" : "video", mediaUrl: media.url, ...(media.posterUrl ? { mediaPoster: media.posterUrl } : {}), ...(media.durationSec ? { mediaDurationSec: media.durationSec } : {}) } }
      : { ...part.scene, templateId: "chapterTitle", variables: { title } };
    if (media) options.prepareScene?.({ sceneId: scene.id, narration, media, clipDurationSec: clipBudget });
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
