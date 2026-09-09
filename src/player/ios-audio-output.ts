type AudioSession = { type: string };
type InputSession = { session: AudioSession; previousType: string };

let context: AudioContext | undefined;
let inputCount = 0;
let inputSession: InputSession | undefined;
let playbackRequestedDuringInput = false;

/** iPadOS can identify itself as a desktop Mac, but still uses iOS audio policy. */
export function isIosAudioOutput(): boolean {
  try {
    const navigator = globalThis.navigator;
    return !!navigator && (
      /iPhone|iPad|iPod/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
  } catch { return false; }
}

function audioSession(): AudioSession | undefined {
  try {
    const session = (globalThis.navigator as Navigator & { audioSession?: AudioSession } | undefined)?.audioSession;
    return session && typeof session.type === 'string' ? session : undefined;
  } catch { return undefined; }
}

function setSessionType(session: AudioSession, type: string): boolean {
  try {
    session.type = type;
    return session.type === type;
  } catch { return false; }
}

/** Shared decode/output context. Consumers must not close or suspend it. */
export function getIosAudioContext(): AudioContext | undefined {
  if (!isIosAudioOutput()) return;
  try {
    if (!context) {
      const Context = globalThis.AudioContext
        ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) return;
      context = new Context();
    }
    return context.state === 'closed' ? undefined : context;
  } catch { return undefined; }
}

/** Call directly from the user gesture, before awaiting media or provider work. */
export function resumeIosAudioContext(): Promise<AudioContext | undefined> {
  const output = getIosAudioContext();
  if (!output) return Promise.resolve(undefined);
  if (inputCount) playbackRequestedDuringInput = true;
  else {
    const session = audioSession();
    if (session) setSessionType(session, 'playback');
  }
  try {
    // Do not defer this call: Safari checks activation when resume is requested.
    return output.resume().then(() => output.state === 'running' ? output : undefined).catch(() => undefined);
  } catch { return Promise.resolve(undefined); }
}

/** Bracket microphone capture, including its async permission request and lifetime. */
export function beginIosAudioInput(): () => void {
  if (!isIosAudioOutput()) return () => {};
  if (inputCount++ === 0) {
    playbackRequestedDuringInput = false;
    const session = audioSession();
    if (session) {
      try {
        const previousType = session.type;
        if (setSessionType(session, 'auto')) inputSession = { session, previousType };
      } catch { /* Audio-session control is optional. */ }
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--inputCount) return;
    const owned = inputSession;
    inputSession = undefined;
    const restore = playbackRequestedDuringInput ? 'playback' : owned?.previousType;
    playbackRequestedDuringInput = false;
    // Preserve a policy another owner selected while capture was active.
    if (owned && restore && audioSession() === owned.session) {
      try {
        if (owned.session.type === 'auto') setSessionType(owned.session, restore);
      } catch { /* Audio-session control is optional. */ }
    }
  };
}
