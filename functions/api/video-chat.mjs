import { createPlannerDiagnostics } from "../_video-chat/diagnostics.mjs";
import { verifyOwner } from "../_video-chat/owner.mjs";
import { createVideoChatHandler } from "../../src/server.ts";
import { getGenerationLifecycleSink } from "../../src/server/lifecycle.ts";
import { CREDIT_FALLBACK_NOTICE } from "../../src/video-chat/recovery.ts";
import {
  actorHash,
  reserveQuota,
  releaseQuota,
} from "../_video-chat/quota.mjs";
import { providerStream, providerText } from "../_video-chat/provider.mjs";
import { generateFalPreview, reserveFalAnswer, reserveOwnerFalAnswer, availableFalClips, PUBLIC_LIFETIME_CLIPS } from "../_video-chat/fal.mjs";
import { searchStock } from "../_video-chat/stock.mjs";
import { suggestionMedia, suggestionMediaInstructions } from "../_video-chat/suggestion-media.mjs";
import { generateSpeech } from "../_video-chat/speech.mjs";
import { welcomeMedia } from "../_video-chat/welcome-media.mjs";
import { guardPaidProvider } from "../_video-chat/provider-admission.mjs";

const POST_ACTIONS = new Set([
  "response",
  "narration",
  "suggestions",
  "opening-media",
  "speech",
]);
const PAID_ACTIONS = new Set(["response", "narration", "suggestions", "opening-media"]);
const HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const error = (status, message) =>
  Response.json({ error: { message } }, { status, headers: HEADERS });
const configured = (value) => typeof value === "string" && Boolean(value.trim());
function generatedVideoConfigured(env) {
  return env.VIDEO_CHAT_FAL_PREVIEW === "enabled" && configured(env.FAL_KEY);
}
// Return only binding names and public capabilities, never credential values.
export function configurationStatus(env) {
  const missing = [];
  if (!configured(env.ANTHROPIC_API_KEY)) missing.push("ANTHROPIC_API_KEY");
  const generatedVideo = generatedVideoConfigured(env);
  const stockVideo = configured(env.PEXELS_API_KEY);
  if (!generatedVideo && !stockVideo) missing.push("PEXELS_API_KEY");
  if (typeof env.VIDEO_CHAT_QUOTAS?.prepare !== "function") missing.push("VIDEO_CHAT_QUOTAS");
  if (typeof env.VIDEO_CHAT_QUOTA_SALT !== "string" || env.VIDEO_CHAT_QUOTA_SALT.length < 32) missing.push("VIDEO_CHAT_QUOTA_SALT");
  // Preview deployments explicitly disable spending, independently of keys or
  // request input. Authorized deployments can enable it through server config.
  if (env.VIDEO_CHAT_PAID_PROVIDERS === "disabled") missing.push("VIDEO_CHAT_PAID_PROVIDERS");
  return {
    ready: missing.length === 0,
    missing,
    videoMode: generatedVideo ? "cinematic" : stockVideo ? "pexels" : null,
    speech: configured(env.XAI_API_KEY) ? "generated" : "silent",
  };
}
async function readBounded(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Use application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("A request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) throw new Error("Keep your request under 12 KB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleVideoChatRequest({
  request,
  env,
  fetcher = fetch,
}) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return error(403, "This endpoint is available on this website only.");
  if (request.method === "POST" && origin !== url.origin)
    return error(403, "A same-origin request is required.");
  if (request.method === "GET" && action === "status")
    return Response.json(configurationStatus(env), { headers: HEADERS });
  if (
    !(
      request.method === "GET" && ["welcome", "capabilities"].includes(action)
    ) &&
    !(request.method === "POST" && POST_ACTIONS.has(action))
  )
    return error(405, "Unsupported video chat operation.");
  const setup = configurationStatus(env);
  if (!setup.ready)
    return Response.json({ error: { code: "setup_required", message: `Configure ${setup.missing.join(", ")} to start a video conversation.` }, ...setup }, { status: 503, headers: HEADERS });
  let body;
  if (request.method === "POST") {
    try {
      body = await readBounded(request);
    } catch {
      return error(400, "Send a valid JSON request under 12 KB.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      return error(400, "Send a JSON object.");
    if (action === "speech" &&
      (Object.keys(body).some((key) => key !== "text") ||
        typeof body.text !== "string" || !body.text.trim() || body.text.length > 1000))
      return error(400, "Send speech text of up to 1,000 characters.");
    if (
      action === "response" &&
      (typeof body.prompt !== "string" ||
        body.prompt.length > 2000 ||
        !body.prompt.trim())
    )
      return error(400, "Ask a question of up to 2,000 characters.");
    if (body.mode && !["cinematic", "pexels"].includes(body.mode))
      return error(400, "Choose AI video or Pexels video responses.");
    if (
      body.conversation &&
      (!Array.isArray(body.conversation) || body.conversation.length > 4)
    )
      return error(400, "Start a new session after four turns.");
  }
  const local = env.VIDEO_CHAT_LOCAL === "enabled" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  let reservation;
  let actor;
  if (PAID_ACTIONS.has(action) || (action === "speech" && configured(env.XAI_API_KEY))) {
    const ip = local ? "127.0.0.1" : request.headers.get("cf-connecting-ip");
    if (!ip)
      return error(
        503,
        "Live conversations require the protected Cloudflare endpoint.",
      );
    try {
      actor = await actorHash(ip, env.VIDEO_CHAT_QUOTA_SALT);
      reservation = await reserveQuota(
        env.VIDEO_CHAT_QUOTAS,
        actor,
        action === "response" ? 8 : action === "speech" ? Math.ceil(body.text.length / 250) : 1,
      );
    } catch {
      return error(503, "Live conversations are temporarily unavailable.");
    }
    if (!reservation)
      return new Response(
        JSON.stringify({
          error: {
            code: "request_throttled",
            message:
              "Too many requests right now. Please try again shortly.",
          },
        }),
        {
          status: 429,
          headers: {
            ...HEADERS,
            "content-type": "application/json",
            "retry-after": "60",
          },
        },
      );
  }
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new Error("Request timed out")),
    action === "response" ? 150000 : 45000,
  );
  let previewReservation;
  let previewReservationUnavailable = false;
  const diagnosticId = crypto.randomUUID();
  const diagnostics = action === "response" ? createPlannerDiagnostics(diagnosticId) : undefined;
  const reportedFallbacks = new Set();
  const reportFallback = (event) => {
    const key = `${event.reason}:${event.stage}:${event.httpStatus ?? ""}`;
    if (reportedFallbacks.has(key)) return;
    reportedFallbacks.add(key);
    // Only server-owned classifications. No prompts, IPs, URLs or provider bodies.
    try { console.info("video-chat.media-fallback", { requestId: diagnosticId, ...event }); }
    catch { /* Diagnostics must not interrupt an answer. */ }
  };
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    diagnostics?.finish();
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    if (reservation)
      await releaseQuota(env.VIDEO_CHAT_QUOTAS, reservation).catch(() => {});
  };
  try {
    // Resolve missing video providers before planning so speech length and shot
    // instructions match the footage that can actually be supplied.
    if (action === "response" && !generatedVideoConfigured(env)) body = { ...body, mode: "pexels" };
    if (action === "response" && body?.mode === "pexels" && !configured(env.PEXELS_API_KEY)) {
      await finish();
      return error(503, "Configure PEXELS_API_KEY to use Pexels video.");
    }
    let wantsGeneratedVideo = body?.mode !== "pexels";
    let creditFallback = false;
    // Own-key loopback development uses the owner ledger, retaining its five-clip
    // answer cap. Remote requests always need a verified Access identity.
    const owner = action === "response" && wantsGeneratedVideo
      ? local || await verifyOwner(request, env, { fetcher }) : false;
    const planningAllowance = action === "response" && wantsGeneratedVideo
      ? await availableFalClips(env, actor, { owner }) : { limit: 0, reason: null };
    if (planningAllowance.reason) reportFallback({ reason: planningAllowance.reason, stage: "planning_availability" });
    if (["user_limit", "preview_limit"].includes(planningAllowance.reason) && configured(env.PEXELS_API_KEY)) {
      body = { ...body, mode: "pexels" };
      wantsGeneratedVideo = false;
      creditFallback = true;
    }
    const admission = { action, reservation, signal: controller.signal, isReleased: () => finished };
    let generationLifecycle;
    const paidStreamText = guardPaidProvider("streamText", admission, (context) => providerStream(context, env, fetcher, diagnostics?.onProvider));
    const paidGenerateText = guardPaidProvider("generateText", admission, (context) => providerText(context, env, fetcher));
    const paidStock = guardPaidProvider("searchMedia", admission, (query, context) => searchStock(query, { env, orientation: context.orientation, preferredType: context.preferredType, signal: context.signal, fetcher, onDiagnostic: reportFallback, selection: context.scene?.variables?.stockSelection }));
    let allowanceExhausted = false;
    const stockAfterCreditLimit = async (query, context) => {
      if (!configured(env.PEXELS_API_KEY)) return null;
      const allowance = await availableFalClips(env, actor, { owner });
      if (!["user_limit", "preview_limit"].includes(allowance.reason)) return null;
      if (!allowanceExhausted) generationLifecycle?.reportWarning?.({
        code: "credits_exhausted", category: "media", message: CREDIT_FALLBACK_NOTICE, recoverable: true,
      });
      allowanceExhausted = true;
      return paidStock(query, context);
    };
    const handler = createVideoChatHandler({
      authorize: "none", // Host validation and atomic admission above apply to every action.
      maxBodyBytes: 12000,
      ...(diagnostics ? { onError: diagnostics.onError, onWarning: diagnostics.onWarning, onComplete: diagnostics.onComplete, onDiagnostic: diagnostics.onDiagnostic } : {}),
      heartbeatMs: 10000,
      mediaConcurrency: 5,
      firstGeneratedClipDurationSec: 5,
      generatedClipDurationSec: 8,
      // Keep remaining scenes eligible for stock after the last paid clip.
      // The atomic ledger, not the planner's callback count, owns AI spending.
      maxGeneratedVideos: !owner && planningAllowance.limit > 0 ? PUBLIC_LIFETIME_CLIPS : planningAllowance.limit,
      generateVideoTimeoutMs: 15000,
      ...(configured(env.XAI_API_KEY) ? {
        generateSpeech: guardPaidProvider("generateSpeech", admission, (context) => generateSpeech(context, env, fetcher)),
      } : {}),
      ...(wantsGeneratedVideo && generatedVideoConfigured(env) ? {
        generatedVideoAudio: true,
        generateVideo: guardPaidProvider("generateVideo", admission, async (query, context) => {
          if (!actor || action !== "response") return null;
          if (allowanceExhausted) return paidStock(query, context);
          const admissionStarted = performance.now();
          previewReservation ??= (owner
            ? reserveOwnerFalAnswer(env.VIDEO_CHAT_QUOTAS, actor)
            : reserveFalAnswer(env.VIDEO_CHAT_QUOTAS, actor, env))
            .then((id) => {
              if (!id) reportFallback({ reason: "preview_limit", stage: "answer_admission" });
              return id;
            })
            .catch(() => {
              previewReservationUnavailable = true;
              reportFallback({ reason: "quota_unavailable", stage: "answer_admission" });
              return null;
            });
          const previewId = await previewReservation;
          const answerAdmissionMs = Math.min(150000, Math.max(0, Math.round(performance.now() - admissionStarted)));
          if (!previewId) return previewReservationUnavailable ? null : stockAfterCreditLimit(query, context);
          const result = await generateFalPreview(query, { env, actor, previewId, signal: context.signal, orientation: context.orientation, scene: context.scene, generatedLook: context.generatedLook, requestedDurationSec: context.requestedDurationSec, fetcher, owner, onDiagnostic: reportFallback, onTiming: event => {
            const matched = typeof context.scene?.id === 'string' ? /-shot-(\d{1,3})$/.exec(context.scene.id) : null;
            try { console.info('video-chat.fal-timing', {requestId: diagnosticId, ...event, answerAdmissionMs, ...(matched ? {shot:Number(matched[1])} : {})}); }
            catch { /* Timing cannot affect playback. */ }
          } });
          return result.reason === "limit" ? stockAfterCreditLimit(query, context) : result.media;
        }),
      } : {}),
      streamText: (context) => {
        generationLifecycle = getGenerationLifecycleSink(context);
        return paidStreamText(context);
      },
      generateText: (context) => paidGenerateText(context.task === "suggestions"
        ? { ...context, systemPrompt: `${context.systemPrompt}\n${suggestionMediaInstructions()}` }
        : context),
      searchMedia: async (query, context) => action === "welcome" && context.purpose === "welcome"
        ? welcomeMedia(query)
        : action === "suggestions" && context.purpose === "suggestion"
        ? suggestionMedia(query) ?? (reservation ? await paidStock(query, context) : null)
        : action === "opening-media"
        ? (reservation ? await paidStock(query, context) : null)
        : action === "response" && body?.mode === "pexels" && reservation ? await paidStock(query, context) : null,
      instructions:
        "Avoid inventing statistics. Stock is illustrative: search metadata never proves a scientific mechanism, identity or event.",
    });
    const incoming = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const response = await handler(incoming);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value);
    if (action === "response") {
      headers.set("x-vanillasky-resolved-video-mode", body.mode === "pexels" ? "pexels" : "cinematic");
      if (creditFallback) headers.set("x-vanillasky-video-fallback", "credits");
    }
    if (!response.body) {
      await finish();
      return new Response(null, { status: response.status, headers });
    }
    const reader = response.body.getReader();
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) {
              await finish();
              controller.close();
            } else controller.enqueue(value);
          } catch (cause) {
            await finish();
            controller.error(cause);
          }
        },
        async cancel(reason) {
          controller.abort(reason);
          await reader.cancel(reason).catch(() => {});
          await finish();
        },
      }),
      { status: response.status, headers },
    );
  } catch {
    await finish();
    return error(503, "The conversation could not finish. Please try again.");
  }
}
export const onRequest = (context) => handleVideoChatRequest(context);
