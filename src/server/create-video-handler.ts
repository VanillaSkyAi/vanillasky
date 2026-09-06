import {
  createTextDeltaVideoPlanner,
  type TextDeltaVideoPlannerOptions,
} from "./model/text-stream.js";
import {
  createVideoStreamHandler,
  type VideoStreamHandler,
  type VideoStreamHandlerOptions,
} from "./video-stream-handler.js";
import { createClippedVariableWarning, createMediaBudgetWarning } from "../protocol/warnings.js";
import { createTemplateSystemPrompt } from "../visual-system/catalog/prompt.js";
import type { ServerTemplateRegistry } from "../visual-system/catalog/server-kit.js";
import { overlayServerTemplateRegistry } from "../visual-system/catalog/server-kit.js";
import { BUILTIN_SERVER_TEMPLATE_KIT } from "../visual-system/catalog/builtin-server.js";
import { createTemplateSceneValidator } from "../visual-system/catalog/validate.js";
import {
  createMediaResolvingPlanner,
  type MediaResolver,
} from "./media-resolver.js";
import { createBoundedVariablePlanner } from "./bound-variables.js";
import { invokeIsolated } from "./composition-runtime.js";
import type { VideoInput } from "../protocol/types.js";

export type { MediaResolver, MediaResolverContext, ResolvedMedia } from "./media-resolver.js";

export interface VideoHandlerOptions extends Omit<
  VideoStreamHandlerOptions,
  "generate" | "systemPrompt" | "supportedCapabilities" | "validateScene" | "getTemplatePacing"
> {
  /** Customer-owned templates that replace matching built-ins and add new IDs. */
  templates?: ServerTemplateRegistry;
  /** App-owned provider adapter. Choose any model per request and keep provider clients and credentials in this closure. */
  streamText: TextDeltaVideoPlannerOptions["streamText"];
  /** Opt in to bounded provider-native usage and metadata in onComplete. */
  includeRawProviderData?: boolean;
  /** Additional video-direction rules prepended to the generated trusted-template catalog. */
  basePrompt?: string;
  /** Authorize an app-approved media URL in addition to URLs supplied in the request. */
  allowMediaUrl?: Parameters<typeof createTemplateSceneValidator>[0]["allowMediaUrl"];
  /** Resolve bounded semantic media intent through an application-owned provider. */
  resolveMedia?: MediaResolver;
  /**
   * How many scenes may resolve media at once. Defaults to one.
   *
   * Raise it when resolution is slow enough to be felt - generated video rather
   * than a stock search. Scenes are still emitted in the order they were
   * planned; only the waiting overlaps.
   */
  mediaConcurrency?: number;
  /**
   * How many scenes in one request may resolve media at all.
   *
   * Unbounded by default, which is right when media is searched for and wrong
   * when it is generated: the planner decides the scene count, and every scene
   * is then a paid clip. Past the ceiling a scene uses its grounded text fallback, and a `media_budget_reached` warning says it happened.
   */
  maxResolvedMedia?: number;
  /**
   * Ask the planner to write each scene's spoken line, on the scene itself.
   *
   * A narrated video otherwise costs a round trip per scene - handing a model
   * the scene that was just planned and asking what to say over it - and those
   * calls have to be chained, because a line is written knowing the ones
   * before it. The planner already knows the scene and the ones around it.
   */
  narrate?: boolean;
}

/**
 * Build the secure route for a template kit while leaving provider, model,
 * credentials, authentication, and deployment ownership with the app.
 */
export function createVideoHandler(
  options: VideoHandlerOptions,
): VideoStreamHandler {
  if (options?.authorize !== "none" && typeof options?.authorize !== "function") {
    throw new Error('createVideoHandler requires authorize or authorize: "none"');
  }
  if (options && "mediaPolicy" in options) {
    throw new Error("mediaPolicy is not supported; resolve media before generation and pass it through VideoInput.suppliedMedia");
  }
  const {
    templates: configuredTemplates,
    streamText,
    includeRawProviderData,
    basePrompt,
    allowMediaUrl,
    resolveMedia,
    mediaConcurrency,
    maxResolvedMedia,
    narrate,
    requireCloser = true,
    ...handlerOptions
  } = options;
  const templates = configuredTemplates
    ? overlayServerTemplateRegistry(BUILTIN_SERVER_TEMPLATE_KIT, configuredTemplates)
    : BUILTIN_SERVER_TEMPLATE_KIT;
  const approvedMediaUrls = new WeakMap<VideoInput, Set<string>>();
  const openingReadyInputs = new WeakSet<VideoInput>();
  const approveUrl = (input: VideoInput, url: string) => {
    const approved = approvedMediaUrls.get(input) ?? new Set<string>();
    approved.add(url);
    approvedMediaUrls.set(input, approved);
  };
  // Bounded before anything validates it. A template's maxLength is a layout
  // contract, and a scene that breaks one is rejected whole - which measured
  // as the single most common reason a planned scene never reached the
  // browser, more common than every other failure combined. Trimming keeps the
  // beat; rejecting loses it over two characters.
  const planner = createBoundedVariablePlanner({
    planner: createTextDeltaVideoPlanner({ streamText, includeRawProviderData }),
    templates,
    onClipped: (templateId, fields) => invokeIsolated(handlerOptions.onWarning,
      createClippedVariableWarning(templateId, fields),
    ),
  });
  const validateTemplateScene = createTemplateSceneValidator({
    kit: templates,
    allowMediaUrl: (url, context) =>
      approvedMediaUrls.get(context.input)?.has(url) === true ||
      allowMediaUrl?.(url, context) === true,
  });
  return createVideoStreamHandler({
    ...handlerOptions,
    requireCloser,
    generate: createMediaResolvingPlanner({
      planner,
      templates,
      resolveMedia,
      approveUrl,
      // An opening that was never asked for is ready from the start. The gate
      // exists so the runtime's opening card is on screen before anything waits
      // on a provider; `opening: false` says there is no card, the host owns
      // the wait, and the first scene is then an ordinary scene - which is what
      // a filmed answer needs, since otherwise its first beat can never be
      // filmed however much the host is willing to spend.
      isOpeningReady: (input) => input.opening === false || openingReadyInputs.has(input),
      mediaConcurrency,
      maxResolvedMedia,
      // The ceiling is a spend policy, so it is reported to the application
      // that set it rather than to the browser, which cannot act on it.
      onBudgetReached: maxResolvedMedia === undefined
        ? undefined
        : () => { invokeIsolated(handlerOptions.onWarning, createMediaBudgetWarning(maxResolvedMedia)); },
      // The same rule the scene validator applies, answered from the part
      // rather than from what the validator has already seen.
      marksOpeningReady: (part) => part.type === "scene.add"
        && templates.getTemplateMetadata(part.scene.templateId)?.jobs?.includes("ask") !== true,
    }),
    systemPrompt: ({ request, capabilities }) => {
      const selectedIds = capabilities?.templates == null
        ? undefined
        : new Set(capabilities.templates);
      const selectedTemplates = selectedIds == null
        ? templates.listTemplateMetadata()
        : templates.listTemplateMetadata().filter(({ id }) => selectedIds.has(id));
      return createTemplateSystemPrompt({
        kit: { listTemplateMetadata: () => selectedTemplates },
        basePrompt,
        knowledgeMode: request.input.knowledgeMode,
        mediaResolverAvailable: resolveMedia != null,
        suppliedMediaAvailable: (request.input.suppliedMedia?.length ?? 0) > 0,
        // The same condition the resolver gate uses. The two have to agree:
        // letting the first scene resolve media while still telling the
        // planner not to put any there films nothing.
        mediaOnFirstScene: request.input.opening === false && resolveMedia != null,
        narrate,
      });
    },
    supportedCapabilities: templates.capabilities,
    validateScene: (scene, context) => {
      validateTemplateScene(scene, context);
      const isAsk = templates.getTemplateMetadata(scene.templateId)?.jobs?.includes("ask") === true;
      if (!isAsk) {
        openingReadyInputs.add(context.input);
      }
    },
    getTemplatePacing: (templateId) => templates.getTemplateMetadata(templateId),
  });
}
