import { parseVideoPlanPart } from "../protocol/validation.js";
import { validateTemplateSceneStructure } from "../visual-system/catalog/validate.js";
import type {
  VideoInput,
  VideoPlanner,
  VideoPlanPart,
  VideoScene,
} from "../protocol/types.js";
import type { ServerTemplateRegistry } from "../visual-system/catalog/server-kit.js";
import {
  getStandardMediaResolverContract,
  type StandardMediaResolverContract,
} from "../visual-system/catalog/media-resolver-contract.js";
import { MAX_RETAINED_MEDIA_URL_LENGTH } from "../protocol/persistence.js";

import { getGenerationLifecycleSink } from "./lifecycle.js";

const MAX_MEDIA_QUERY_CHARACTERS = 80;
const MAX_MEDIA_QUERY_WORDS = 8;

export interface ResolvedMedia {
  url: string;
  type: "image" | "video";
  posterUrl?: string;
}

export interface MediaResolverContext {
  input: VideoInput;
  requestId: string;
  scene: Readonly<VideoScene>;
  templateId: string;
  preferredType: "image" | "video" | "any";
  /**
   * The visual language generated media must match, when the application set
   * one. Append it to a provider prompt; a shot that ignores it is the
   * mismatch this exists to prevent.
   */
  generatedLook?: string;
  signal: AbortSignal;
}

export type MediaResolver = (
  query: string,
  context: MediaResolverContext,
) => ResolvedMedia | null | Promise<ResolvedMedia | null>;

function queryIsBounded(query: string): boolean {
  const length = [...query].length;
  const words = query.match(/\S+/gu)?.length ?? 0;
  return length >= 2 && length <= MAX_MEDIA_QUERY_CHARACTERS && words <= MAX_MEDIA_QUERY_WORDS;
}

function preferredType(value: unknown): MediaResolverContext["preferredType"] {
  if (value === "photo") return "image";
  if (value === "video") return "video";
  return "any";
}

function cleanUrl(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > MAX_RETAINED_MEDIA_URL_LENGTH) {
    throw new Error(`Resolved media ${field} is invalid`);
  }
  return value.trim();
}

function fallbackVariables(
  variables: Record<string, unknown>,
): Record<string, unknown> {
  const fallback = { ...variables };
  delete fallback.mediaKeyword;
  delete fallback.mediaUrl;
  delete fallback.mediaPoster;
  delete fallback.mediaType;
  delete fallback.mediaSource;
  return fallback;
}

async function resolveVariables(options: {
  variables: Record<string, unknown>;
  requestId: string;
  scene: VideoScene;
  contract?: StandardMediaResolverContract;
  input: VideoInput;
  templateId: string;
  signal: AbortSignal;
  resolveMedia?: MediaResolver;
  approveUrl: (input: VideoInput, url: string) => void;
  openingReady: boolean;
  /** Returns false once this request has resolved as much media as it may. */
  claimBudget?: () => boolean;
  onFallback?: () => void;
}): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(options.variables, "mediaKeyword")) return options.variables;

  const variables = { ...options.variables };
  const rawQuery = typeof variables.mediaKeyword === "string"
    ? variables.mediaKeyword.trim()
    : "";
  delete variables.mediaKeyword;
  if (!options.contract) return variables;
  if (!options.openingReady || !options.resolveMedia || !queryIsBounded(rawQuery)) {
    return fallbackVariables(variables);
  }
  // Claimed before the provider is called, not after: the point is to not spend.
  if (options.claimBudget && !options.claimBudget()) return fallbackVariables(variables);

  const fallback = () => {
    options.onFallback?.();
    return fallbackVariables(variables);
  };
  let resolved: ResolvedMedia | null;
  try {
    resolved = await options.resolveMedia(rawQuery, {
      input: options.input,
      requestId: options.requestId,
      scene: { ...options.scene, variables },
      templateId: options.templateId,
      preferredType: preferredType(variables.mediaType),
      generatedLook: options.input.style?.generatedLook,
      signal: options.signal,
    });
    if (options.signal.aborted) {
      throw options.signal.reason ?? new DOMException("The media request was aborted", "AbortError");
    }
    if (!resolved) return fallback();
    if (resolved.type !== "image" && resolved.type !== "video") {
      throw new Error("Resolved media type is invalid");
    }
    const url = cleanUrl(resolved.url, "URL");
    if (!url) throw new Error("Resolved media URL is required");
    const posterUrl = options.contract.acceptsPoster
      ? cleanUrl(resolved.posterUrl, "poster URL")
      : undefined;
    options.approveUrl(options.input, url);
    if (posterUrl) options.approveUrl(options.input, posterUrl);
    variables.mediaUrl = url;
    variables.mediaType = resolved.type === "image" ? "photo" : "video";
    if (posterUrl) variables.mediaPoster = posterUrl;
    else delete variables.mediaPoster;
    return variables;
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason ?? error;
    return fallback();
  }
}

function templateContract(
  templates: ServerTemplateRegistry,
  templateId: string,
): StandardMediaResolverContract | undefined {
  const metadata = templates.getTemplateMetadata(templateId);
  return metadata == null
    ? undefined
    : getStandardMediaResolverContract(metadata.schema);
}

function withoutKeyword(variables: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(variables, "mediaKeyword")) return variables;
  const clean = { ...variables };
  delete clean.mediaKeyword;
  return clean;
}

function sanitizeUnknownTemplatePart(part: VideoPlanPart): VideoPlanPart {
  if (part.type === "scene.add") {
    return { ...part, scene: { ...part.scene, variables: withoutKeyword(part.scene.variables) } };
  }
  return part;
}

async function resolvePartVariables(options: {
  part: VideoPlanPart;
  requestId: string;
  templateId?: string;
  input: VideoInput;
  signal: AbortSignal;
  templates: ServerTemplateRegistry;
  resolveMedia?: MediaResolver;
  approveUrl: (input: VideoInput, url: string) => void;
  openingReady: boolean;
  claimBudget?: () => boolean;
  onFallback?: () => void;
}): Promise<VideoPlanPart> {
  if (!options.templateId) return sanitizeUnknownTemplatePart(options.part);
  const shared = {
    contract: templateContract(options.templates, options.templateId),
    input: options.input,
    templateId: options.templateId,
    signal: options.signal,
    resolveMedia: options.resolveMedia,
    approveUrl: options.approveUrl,
    openingReady: options.openingReady,
    claimBudget: options.claimBudget,
    onFallback: options.onFallback,
  };
  if (options.part.type === "scene.add") {
    const variables = await resolveVariables({
      ...shared,
      requestId: options.requestId,
      scene: options.part.scene,
      variables: options.part.scene.variables,
    });
    if (options.templateId === "cinemaMedia" && !variables.mediaUrl) {
      const title = variables.fallbackText;
      if (typeof title !== "string" || !title.trim() || [...title].length > 65) {
        throw new Error("A media scene without a usable asset requires grounded fallbackText (1–65 characters)");
      }
      return { ...options.part, scene: { ...options.part.scene, templateId: "chapterTitle", variables: { title: title.trim() } } };
    }
    const rendered = { ...variables };
    delete rendered.mediaSource;
    // Preserve the authored recovery anchor for a URL that later fails to decode.
    if (options.templateId !== "cinemaMedia") delete rendered.fallbackText;
    delete rendered.shotDirection;
    return { ...options.part, scene: { ...options.part.scene, variables: rendered } };
  }
  return options.part;
}

export function createMediaResolvingPlanner(options: {
  planner: VideoPlanner;
  templates: ServerTemplateRegistry;
  resolveMedia?: MediaResolver;
  approveUrl: (input: VideoInput, url: string) => void;
  isOpeningReady: (input: VideoInput) => boolean;
  /**
   * How many scenes may have media in flight at once.
   *
   * One - the default - resolves strictly in turn, which is invisible when
   * media is searched for and costly when it is generated: a stock photo takes
   * a couple of hundred milliseconds, a generated clip takes seconds, and five
   * of those in a row is half a minute of nothing. Raising this overlaps the
   * waiting without reordering anything.
   */
  mediaConcurrency?: number;
  /**
   * How many scenes in one request may resolve media at all.
   *
   * Nothing bounded this. The planner decides how many scenes a video has, and
   * every one of them may resolve media - free when it is searched for, a paid
   * clip each when it is generated. Past the ceiling a scene falls back to the
   * grounded text treatment; nobody is billed
   * for the difference.
   */
  maxResolvedMedia?: number;
  /** Told once when the ceiling stops a scene from being filled. */
  onBudgetReached?: () => void;
  /**
   * Whether this part is the one that makes the opening ready.
   *
   * The flag is normally set downstream, while a scene is validated, and read
   * on the next scene. That works when parts are resolved strictly in turn.
   * Once several are in flight the downstream write has not happened yet, so
   * the same rule has to be answered from the parts themselves.
   */
  marksOpeningReady?: (part: VideoPlanPart) => boolean;
}): VideoPlanner {
  const limit = Math.max(1, Math.floor(options.mediaConcurrency ?? 1));

  return async function* resolveMediaPlan(context) {
    let remaining = options.maxResolvedMedia;
    let announced = false;
    const claimBudget = remaining === undefined ? undefined : () => {
      if ((remaining as number) > 0) {
        remaining = (remaining as number) - 1;
        return true;
      }
      if (!announced) {
        announced = true;
        options.onBudgetReached?.();
      }
      return false;
    };

    const preflight = (part: VideoPlanPart): boolean => {
      try {
        parseVideoPlanPart(part);
        if (part.type === "scene.add") {
          const { templateId, variables } = part.scene;
          if (context.request.capabilities?.templates && !context.request.capabilities.templates.includes(templateId)) {
            throw new Error(`Scene template ${templateId} was not negotiated`);
          }
          const template = options.templates.getTemplateMetadata(templateId);
          if (!template) throw new Error(`Template ${templateId} is not installed`);
          validateTemplateSceneStructure(template.schema, variables, true);
        }
        return true;
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (!getGenerationLifecycleSink(context)?.rejectPart?.(error)) throw error;
        return false;
      }
    };

    const resolveOne = async (part: VideoPlanPart, openingReady?: boolean): Promise<VideoPlanPart | undefined> => {
      try {
        return await resolvePartVariables({
          part,
          requestId: context.request.requestId,
          templateId: part.type === "scene.add" ? part.scene.templateId : undefined,
          input: context.request.input,
          signal: context.signal,
          templates: options.templates,
          resolveMedia: options.resolveMedia,
          approveUrl: options.approveUrl,
          openingReady: openingReady ?? options.isOpeningReady(context.request.input),
          claimBudget,
          onFallback: () => getGenerationLifecycleSink(context)?.reportWarning?.({
            code: "provider_warning", category: "provider",
            message: "Some visuals use a simple background.", recoverable: true,
          }),
        });
      } catch (cause) {
        // Resolution can make an otherwise valid scene unrepresentable. Apply
        // the same host-owned drop policy as preflight without ending the queue.
        if (context.signal.aborted || part.type !== "scene.add") throw cause;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (!getGenerationLifecycleSink(context)?.rejectPart?.(error)) throw error;
        return undefined;
      }
    };

    if (limit === 1) {
      for await (const part of options.planner(context)) {
        if (!preflight(part)) continue;
        const resolved = await resolveOne(part);
        if (resolved) yield resolved;
      }
      return;
    }

    // Tracked here rather than read from downstream, which has not seen these
    // parts yet. The opening still resolves no media: it has to appear without
    // waiting on a round trip.
    let openingReady = options.isOpeningReady(context.request.input);

    // Pull planning and media resolution in the background so the head of the
    // ordered queue can be yielded the moment it is ready. Filling the queue in
    // the consumer used to withhold scene one until the planner had produced
    // `limit` parts, which turned concurrency into a startup delay.
    type SettledPart =
      | { part: VideoPlanPart | undefined; cause?: never }
      | { part?: never; cause: unknown };
    const pending: Array<Promise<SettledPart>> = [];
    const iterator = options.planner(context)[Symbol.asyncIterator]();
    let producerDone = false;
    let producerError: unknown;
    let consumerClosed = false;
    let wakeConsumer: (() => void) | undefined;
    let wakeProducer: (() => void) | undefined;
    const notifyConsumer = () => {
      wakeConsumer?.();
      wakeConsumer = undefined;
    };
    const notifyProducer = () => {
      wakeProducer?.();
      wakeProducer = undefined;
    };
    const waitForItem = () => pending.length > 0 || producerDone
      ? Promise.resolve()
      : new Promise<void>((resolve) => { wakeConsumer = resolve; });
    const waitForSpace = () => pending.length < limit || consumerClosed
      ? Promise.resolve()
      : new Promise<void>((resolve) => { wakeProducer = resolve; });
    const producer = (async () => {
      try {
        while (!consumerClosed) {
          await waitForSpace();
          if (consumerClosed) break;
          const next = await iterator.next();
          if (next.done || consumerClosed) break;
          const part = next.value;
          if (!preflight(part)) continue;
          pending.push(resolveOne(part, openingReady).then(
            (resolved) => ({ part: resolved }),
            (cause) => ({ cause }),
          ));
          if (!openingReady && options.marksOpeningReady?.(part) === true) openingReady = true;
          notifyConsumer();
        }
      } catch (cause) {
        producerError = cause;
      } finally {
        producerDone = true;
        notifyConsumer();
      }
    })();

    try {
      while (!producerDone || pending.length > 0) {
        await waitForItem();
        const task = pending[0];
        if (!task) continue;
        const result = await task;
        pending.shift();
        notifyProducer();
        if ("cause" in result) throw result.cause;
        if (result.part) yield result.part;
      }
      await producer;
      if (producerError !== undefined) throw producerError;
    } finally {
      consumerClosed = true;
      notifyProducer();
      if (!producerDone) {
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
      }
    }
  };
}
