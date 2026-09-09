import type { VideoChatPlaybackMetric } from "../../../src/video-chat/use-video-chat";
export interface DiagnosticRow {
  phase: string; elapsedMs: number; durationMs?: number; status?: number; reason?: string;
  speechDurationSec?: number; clipDurationSec?: number; sceneDurationSec?: number;
  bufferedSeconds?: number; repeatCount?: number; recovered?: boolean;
}
const phases: Record<string, string> = {
  "response.start": "request accepted", "data.video-chat-opening": "opening authored",
  "data.video-chat-preparation": "shot authored", "scene.add": "scene prepared",
  "response.complete": "plan complete", "response.warning": "recovery warning",
  "response.error": "response error",
};
/** Retains phase names and timing only. Stream payload text is never copied into evidence. */
export function createChatDiagnostics(changed: (rows: DiagnosticRow[]) => void) {
  let rows: DiagnosticRow[] = [], generation = 0, startedAt = 0, disposed = false;
  const emit = (row: DiagnosticRow, run = generation) => {
    if (disposed || run !== generation || !startedAt) return;
    rows = [...rows.slice(-79), row]; changed(rows);
  };
  const mark = (phase: string, run = generation, extra: Partial<DiagnosticRow> = {}) =>
    emit({phase, elapsedMs: Math.round(performance.now() - startedAt), ...extra}, run);
  return {
    rows: () => rows,
    observeRecoveries(target: EventTarget) {
      const observe = (event: Event) => {
        const reason: unknown = (event as CustomEvent<{reason?: unknown}>).detail?.reason;
        if (typeof reason === "string" && ["decode-error", "frame-readiness-timeout", "stalled-media", "playback-error", "duration-mismatch"].includes(reason)) {
          mark("media recovery", generation, {reason});
        }
      };
      target.addEventListener("vanillasky:media-recovery", observe);
      return () => target.removeEventListener("vanillasky:media-recovery", observe);
    },
    dispose() {disposed = true; generation++; rows = [];},
    playback(metric: VideoChatPlaybackMetric) {
      const phase = {"first-frame": "body rendered", "first-media-frame": "video decoded", "first-speech": "first speech",
        stall: "playback wait", "scene-duration": "speech fit", buffer: "buffered media", "media-playback": "media playback"}[metric.type];
      emit({phase, elapsedMs: metric.elapsedMs,
        ...(metric.type === "stall" ? {durationMs: metric.durationMs,reason:metric.reason} : {}),
        ...(metric.type === "scene-duration" ? {speechDurationSec:metric.speechDurationSec,clipDurationSec:metric.clipDurationSec,recovered:metric.recovered} : {}),
        ...(metric.type === "buffer" ? {bufferedSeconds:metric.bufferedSeconds} : {}),
        ...(metric.type === "media-playback" ? {clipDurationSec:metric.clipDurationSec,sceneDurationSec:metric.sceneDurationSec,repeatCount:metric.repeatCount} : {}),
      });
    },
    wrapFetch(fetcher: typeof fetch): typeof fetch {
      return async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
        const action = url.searchParams.get("action");
        if (action === "response") {generation++; rows = []; startedAt = performance.now(); changed(rows);}
        const run = generation;
        const speech = action === "speech";
        if (action === "response" || speech) mark(speech ? "speech request" : "response request", run);
        const response = await fetcher(input, init);
        if (speech) {
          mark("speech response headers", run, {status: response.status});
          if (!response.body) {mark("speech bytes ready", run, {status: response.status}); return response;}
          const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {controller.enqueue(chunk);},
            flush() {mark("speech bytes ready", run, {status: response.status});},
          }));
          return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
        }
        if (action !== "response") return response;
        mark("response headers", run, {status: response.status});
        if (!response.body) return response;
        let buffered = "";
        const decoder = new TextDecoder();
        const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
            buffered += decoder.decode(chunk, {stream: true});
            const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
            if (buffered.length > 131072) buffered = "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              try {
                const event = JSON.parse(line.slice(5)) as {type?: string};
                if (event.type && Object.hasOwn(phases, event.type)) mark(phases[event.type], run);
              } catch { /* Incomplete or non-JSON event; the runtime retains protocol ownership. */ }
            }
          },
        }));
        return new Response(stream, {status: response.status, statusText: response.statusText, headers: response.headers});
      };
    },
  };
}
