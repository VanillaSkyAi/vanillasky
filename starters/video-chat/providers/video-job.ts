/** App-owned queue lifecycle. No automatic resubmission of paid work. */
export async function runVideoJob<Job extends { id: string }, Value>(options: {
  signal: AbortSignal;
  deadlineAt: number;
  pollIntervalMs: number;
  submit: (signal: AbortSignal) => Promise<Job>;
  poll: (job: Job, signal: AbortSignal) => Promise<Value | null>;
  cancel?: (job: Job, signal: AbortSignal) => Promise<void>;
  /** Persist this ID in your job ledger if work must survive a server restart. */
  onSubmitted?: (job: Job, signal: AbortSignal) => void | Promise<void>;
}): Promise<{ job: Job; value: Value }> {
  options.signal.throwIfAborted();
  const remaining = options.deadlineAt - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Video deadline expired before submission");
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(new Error("Video deadline expired")), remaining);
  const signal = AbortSignal.any([options.signal, timer.signal]);
  let job: Job | undefined;
  let stopped = false;
  let cancellation: Promise<void> | undefined;
  const cancelJob = (): Promise<void> => {
    if (!job || !options.cancel) return Promise.resolve();
    const accepted = job;
    return cancellation ??= (async () => {
      // A fresh signal permits cleanup after the request's signal has stopped.
      const cleanup = new AbortController();
      const cleanupTimer = setTimeout(() => cleanup.abort(new Error("Video cancellation timed out")), 3000);
      try { await withSignal(() => options.cancel!(accepted, cleanup.signal), cleanup.signal); }
      catch { /* Best effort: cancellation promises no refund. */ }
      finally { clearTimeout(cleanupTimer); }
    })();
  };
  try {
    // A transport error here can mean the provider accepted the job. NEVER retry.
    job = await withSignal(async () => {
      const accepted = await options.submit(signal);
      if (typeof accepted?.id !== "string" || !accepted.id) throw new Error("Missing provider job ID");
      job = accepted;
      // An uncooperative submit may reveal its ID after our bounded wait ends.
      if (stopped) void cancelJob();
      return accepted;
    }, signal);
    if (options.onSubmitted) await withSignal(() => options.onSubmitted!(job!, signal), signal);
    while (true) {
      signal.throwIfAborted();
      const value = await withSignal(() => options.poll(job!, signal), signal);
      signal.throwIfAborted();
      if (value !== null) return { job, value };
      await pause(options.pollIntervalMs, signal);
    }
  } catch {
    stopped = true;
    // A failed callback abandons this job, too. Stop sibling work and attempt
    // cleanup; adapters decide whether an already-completed job is cancellable.
    timer.abort(new Error("Video job stopped"));
    await cancelJob();
    throw Object.assign(new Error(job
      ? "Video job did not complete; inspect the retained job ID before retrying"
      : "Video submission outcome unknown; inspect the provider dashboard before retrying"), { jobId: job?.id });
  } finally {
    clearTimeout(timeout);
  }
}

/** Bound application promises even when they ignore the cancellation signal. */
async function withSignal<T>(operation: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); },
    );
  });
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Keep provider response bodies, URLs and credentials out of errors. */
export async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return await response.json() as T;
}

export function providerUrl(value: string, origin: string): string {
  const url = new URL(value);
  if (url.origin !== origin || url.username || url.password) throw new Error("Unexpected provider URL");
  return url.href;
}

export function videoPrompt(query: string, context: { shotDirection: string; generatedLook?: string }): string {
  return [query, context.shotDirection, context.generatedLook,
    "One continuous moving shot. No text, logos, captions, dialogue, music or narration."].filter(Boolean).join("\n");
}
