import { describe, expect, it } from "vitest";
import { runVideoJob } from "../starters/video-chat/providers/video-job";

describe("app-owned video job lifecycle", () => {
  it("submits once, retains the job ID and delivers only the completed output", async () => {
    let submissions = 0;
    let polls = 0;
    const ids: string[] = [];
    const result = await runVideoJob({
      signal: new AbortController().signal, deadlineAt: Date.now() + 1000, pollIntervalMs: 1,
      submit: async () => { submissions++; return { id: "paid-job" }; },
      onSubmitted: (job) => { ids.push(job.id); },
      poll: async (job) => { expect(job.id).toBe("paid-job"); return ++polls === 1 ? null : "video-url"; },
    });
    expect(result).toEqual({ value: "video-url", job: { id: "paid-job" } });
    expect(submissions).toBe(1);
    expect(ids).toEqual(["paid-job"]);
  });

  it("never retries an ambiguous submission failure", async () => {
    let submissions = 0;
    await expect(runVideoJob({
      signal: new AbortController().signal, deadlineAt: Date.now() + 1000, pollIntervalMs: 1,
      submit: async () => { submissions++; throw new Error("connection lost after POST"); },
      poll: async () => "unused",
    })).rejects.toThrow(/submission.*unknown/i);
    expect(submissions).toBe(1);
  });

  it("cancels an accepted job after abort using a fresh bounded signal", async () => {
    const controller = new AbortController();
    const cancelled: string[] = [];
    await expect(runVideoJob({
      signal: controller.signal, deadlineAt: Date.now() + 1000, pollIntervalMs: 1,
      submit: async () => ({ id: "accepted" }),
      poll: async () => { controller.abort(); return null; },
      cancel: async (job, signal) => { expect(signal.aborted).toBe(false); cancelled.push(job.id); },
    })).rejects.toMatchObject({ jobId: "accepted" });
    expect(cancelled).toEqual(["accepted"]);
  });

  it("does not spend when already aborted or expired", async () => {
    let submissions = 0;
    const submit = async () => { submissions++; return { id: "never" }; };
    await expect(runVideoJob({ signal: AbortSignal.abort(), deadlineAt: Date.now() + 1000, pollIntervalMs: 1, submit, poll: async () => "x" })).rejects.toThrow();
    await expect(runVideoJob({ signal: new AbortController().signal, deadlineAt: Date.now() - 1, pollIntervalMs: 1, submit, poll: async () => "x" })).rejects.toThrow();
    expect(submissions).toBe(0);
  });
});
