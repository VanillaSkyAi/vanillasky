// Only server-owned actions can grant provider access.
const ACTIONS = {
  streamText: new Set(['response']),
  generateText: new Set(['response', 'narration', 'suggestions']),
  generateSpeech: new Set(['speech']),
  generateVideo: new Set(['response']),
  searchMedia: new Set(['response', 'suggestions', 'opening-media']),
};

/** Capture server-owned admission before a provider callback can run. */
export function guardPaidProvider(kind, admission, provider) {
  const check = (context) => {
    if (!ACTIONS[kind]?.has(admission.action) ||
      typeof admission.reservation !== 'string' || !admission.reservation ||
      admission.isReleased() || admission.signal.aborted || context.signal?.aborted)
      throw new Error('Provider request is not admitted.');
  };
  const prepare = (context) => {
    check(context);
    return { ...context, signal: context.signal
      ? AbortSignal.any([admission.signal, context.signal]) : admission.signal };
  };
  if (kind === 'streamText') return async function* (context) {
    // Text providers are lazy: admission must hold when iteration starts and
    // before each subsequent pull, not merely when the iterable was created.
    const prepared = prepare(context);
    const iterator = provider(prepared)[Symbol.asyncIterator]();
    try {
      while (true) {
        check(prepared);
        const result = await iterator.next();
        check(prepared);
        if (result.done) return;
        yield result.value;
      }
    } finally { await iterator.return?.(); }
  };
  const media = kind === 'generateVideo' || kind === 'searchMedia';
  const invoke = async (context, query) => {
    const prepared = prepare(context);
    const result = await (media ? provider(query, prepared) : provider(prepared));
    check(prepared);
    return result;
  };
  return media ? (query, context) => invoke(context, query) : (context) => invoke(context);
}
