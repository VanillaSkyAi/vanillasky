/** App-owned queue lifecycle. No automatic resubmission of paid work. */
export async function runVideoJob<Job extends { id: string }, Value>(options: {
  signal: AbortSignal;
  deadlineAt: number;
  pollIntervalMs: number;
  submit: (signal: AbortSignal) => Promise<Job>;
  poll: (job: Job, signal: AbortSignal) => Promise<Value | null>;
  cancel?: (job: Job, signal: AbortSignal) => Promise<void>;
  /** Persist this ID in your job ledger if work must survive a server restart. */
  onSubmitted?: (job: Job) => void | Promise<void>;
}): Promise<{ job: Job; value: Value }> {
  options.signal.throwIfAborted();
  const remaining = options.deadlineAt - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Video deadline expired before submission");
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(new Error("Video deadline expired")), remaining);
  const signal = AbortSignal.any([options.signal, timer.signal]);
  let job: Job | undefined;
  try {
    // A transport error here can mean the provider accepted the job. NEVER retry.
    job = await options.submit(signal);
    if (!job.id) throw new Error("Missing provider job ID");
    await options.onSubmitted?.(job);
    while (true) {
      signal.throwIfAborted();
      const value = await options.poll(job, signal);
      signal.throwIfAborted();
      if (value !== null) return { job, value };
      await pause(options.pollIntervalMs, signal);
    }
  } catch {
    // Cancellation is best effort, may race completion, and promises no refund.
    if (job && options.cancel && signal.aborted) {
      try { await options.cancel(job, AbortSignal.timeout(3000)); } catch { /* retain original outcome */ }
    }
    throw Object.assign(new Error(job
      ? "Video job did not complete; inspect the retained job ID before retrying"
      : "Video submission outcome unknown; inspect the provider dashboard before retrying"), { jobId: job?.id });
  } finally {
    clearTimeout(timeout);
  }
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
