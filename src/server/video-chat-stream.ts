import { decodeVideoSse, encodeVideoSseEvent } from "../protocol/sse.js";
import type { VideoEvent } from "../protocol/events.js";
import type { ShotPreparation } from "./chat-shot-planner.js";

interface OpeningSubject {
  line: string;
  keyword: string;
  fallbackKeyword?: string;
}

const VIDEO_CHAT_OPENING_EVENT_TYPE = "data.video-chat-opening" as const;

export interface OpeningChannel {
  ready: Promise<OpeningSubject | undefined>;
  publish(value: OpeningSubject | undefined): void;
}

export function createOpeningChannel(initial?: OpeningSubject): OpeningChannel {
  if (initial) return { ready: Promise.resolve(initial), publish: () => undefined };
  let published = false;
  let resolve!: (value: OpeningSubject | undefined) => void;
  const ready = new Promise<OpeningSubject | undefined>((settle) => { resolve = settle; });
  return {
    ready,
    publish(value) {
      if (published) return;
      published = true;
      resolve(value);
    },
  };
}

function resequenceEvent(event: VideoEvent, sequence: number): VideoEvent {
  return {
    ...event,
    sequence,
    eventId: `${event.runId}:${sequence}`,
  } as VideoEvent;
}

const VIDEO_CHAT_PREPARATION_EVENT_TYPE = "data.video-chat-preparation" as const;
export interface PreparationChannel {
  queue: ShotPreparation[];
  changed: Promise<void>;
  publish: (value: ShotPreparation) => void;
}
export function createPreparationChannel(): PreparationChannel {
  let wake!: () => void;
  const channel: PreparationChannel = {
    queue: [], changed: new Promise<void>(resolve => { wake = resolve; }),
    publish(value) {
      channel.queue.push(value);
      wake();
      channel.changed = new Promise<void>(resolve => { wake = resolve; });
    },
  };
  return channel;
}

export function streamVideoChatOpening(
  response: Response,
  openingReady: Promise<OpeningSubject | undefined>,
  preparations: PreparationChannel,
  cancel: () => void,
): Response {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
  const events = decodeVideoSse(response.body)[Symbol.asyncIterator]();
  const encoded = (async function* () {
    try {
      const first = await events.next();
      if (first.done) return;
      let sequence = 0;
      const started = first.value.type === "response.start"
        ? {
            ...first.value,
            data: {
              ...first.value.data,
              capabilities: {
                ...first.value.data.capabilities,
                extensions: Array.from(new Set([
                  ...(first.value.data.capabilities?.extensions ?? []),
                  VIDEO_CHAT_OPENING_EVENT_TYPE,
                  VIDEO_CHAT_PREPARATION_EVENT_TYPE,
                ])),
              },
            },
          } as VideoEvent
        : first.value;
      yield encodeVideoSseEvent(resequenceEvent(started, sequence++));

      const nextEvent = events.next();
      const opening = await openingReady;
      if (opening?.line) {
        yield encodeVideoSseEvent({
          protocolVersion: first.value.protocolVersion,
          runId: first.value.runId,
          sequence,
          eventId: `${first.value.runId}:${sequence}`,
          type: VIDEO_CHAT_OPENING_EVENT_TYPE,
          data: {
            line: opening.line,
            ...(opening.keyword ? { keyword: opening.keyword } : {}),
            ...(opening.fallbackKeyword ? { fallbackKeyword: opening.fallbackKeyword } : {}),
          },
        });
        sequence += 1;
      }

      let pending = nextEvent;
      while (true) {
        while (preparations.queue.length) {
          const data = preparations.queue.shift()!;
          yield encodeVideoSseEvent({ protocolVersion: first.value.protocolVersion,
            runId: first.value.runId, sequence, eventId: `${first.value.runId}:${sequence}`,
            type: VIDEO_CHAT_PREPARATION_EVENT_TYPE, data });
          sequence += 1;
        }
        const next = await Promise.race([
          pending.then(value => ({ value })),
          preparations.changed.then(() => undefined),
        ]);
        if (!next || preparations.queue.length) continue;
        if (next.value.done) break;
        yield encodeVideoSseEvent(resequenceEvent(next.value.value, sequence++));
        pending = events.next();
      }
    } finally {
      await events.return?.(undefined);
    }
  })();
  const encoder = new TextEncoder();
  const iterator = encoded[Symbol.asyncIterator]();
  let completed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          if (!completed) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          completed = true;
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (cause) {
        completed = true;
        controller.error(cause);
      }
    },
    async cancel() {
      cancel();
      completed = true;
      await iterator.return?.();
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
