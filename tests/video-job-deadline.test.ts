import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runVideoJob } from "../starters/video-chat/providers/video-job";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("bounded application video callbacks", () => {
  it.each(["ledger", "poll"])("cancels the accepted job when a %s callback ignores its deadline", async (blocked) => {
    const cancelled: string[] = [];
    let error: (Error & { jobId?: string }) | undefined;
    let callbackSignal: AbortSignal | undefined;
    void runVideoJob({
      signal: new AbortController().signal, deadlineAt: Date.now() + 25, pollIntervalMs: 1,
      submit: async () => ({ id: "accepted" }),
      onSubmitted: (_job, signal) => { callbackSignal = signal; return blocked === "ledger" ? new Promise(() => {}) : undefined; },
      poll: async (_job, signal) => { callbackSignal = signal; return new Promise(() => {}); },
      cancel: async (job) => { cancelled.push(job.id); },
    }).catch((cause) => { error = cause; });
    await vi.advanceTimersByTimeAsync(25);
    expect(error?.jobId).toBe("accepted");
    expect(cancelled).toEqual(["accepted"]);
    expect(callbackSignal?.aborted).toBe(true);
  });

  it("limits uncooperative cancellation to three seconds", async () => {
    const controller = new AbortController();
    let cancellationSignal: AbortSignal | undefined;
    let error: (Error & { jobId?: string }) | undefined;
    void runVideoJob({
      signal: controller.signal, deadlineAt: Date.now() + 1000, pollIntervalMs: 1,
      submit: async () => ({ id: "accepted" }),
      poll: async () => { controller.abort(); return null; },
      cancel: async (_job, signal) => { cancellationSignal = signal; return new Promise(() => {}); },
    }).catch((cause) => { error = cause; });
    await vi.advanceTimersByTimeAsync(0);
    expect(cancellationSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2999);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error?.jobId).toBe("accepted");
    expect(cancellationSignal?.aborted).toBe(true);
  });

  it("cleans up a failed poll without resubmitting or exposing the private failure", async () => {
    let submissions = 0;
    const cancelled: string[] = [];
    const result = runVideoJob({
      signal: new AbortController().signal, deadlineAt: Date.now() + 1000, pollIntervalMs: 1,
      submit: async () => { submissions++; return { id: "accepted" }; },
      poll: async () => { throw new Error("Provider HTTP 503: private response"); },
      cancel: async (job) => { cancelled.push(job.id); },
    }).catch((error: Error & { jobId?: string }) => error);
    const error = await result;
    expect(cancelled).toEqual(["accepted"]);
    expect(submissions).toBe(1);
    expect(error).toMatchObject({ jobId: "accepted" });
    expect(String(error)).not.toContain("private response");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles at the deadline and cancels a job ID received after submission finishes late", async () => {
    let finishSubmit!: (job: { id: string }) => void;
    let submissions = 0;
    const cancelled: string[] = [];
    let error: (Error & { jobId?: string }) | undefined;
    void runVideoJob({
      signal: new AbortController().signal, deadlineAt: Date.now() + 25, pollIntervalMs: 1,
      submit: () => { submissions++; return new Promise<{ id: string }>((resolve) => { finishSubmit = resolve; }); },
      poll: async () => { throw new Error("A stopped job must not be polled"); },
      cancel: async (job) => { cancelled.push(job.id); },
    }).catch((cause) => { error = cause; });
    await vi.advanceTimersByTimeAsync(25);
    expect(error?.message).toMatch(/submission outcome unknown/);
    finishSubmit({ id: "late-accepted" });
    await vi.advanceTimersByTimeAsync(0);
    expect(cancelled).toEqual(["late-accepted"]);
    expect(submissions).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
