let primed: { context: AudioContext; resumed: Promise<void> } | undefined;

/** Reserve a background sink inside Ask/Replay's gesture, before a player exists. */
export function primeSoundtrackGesture(): void {
  if (primed || !globalThis.navigator?.userActivation?.isActive) return;
  try {
    const Context = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const context = new Context();
    primed = { context, resumed: context.resume().catch(() => undefined) };
  } catch { /* Background audio is optional. */ }
}

export async function claimSoundtrackGesture(): Promise<AudioContext | undefined> {
  const pending = primed;
  primed = undefined;
  if (!pending) return;
  await pending.resumed;
  if (pending.context.state === 'running') return pending.context;
  void pending.context.close();
}
