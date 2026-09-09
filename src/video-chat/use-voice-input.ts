import { useCallback, useEffect, useRef, useState } from "react";
import { beginIosAudioInput } from "../player/ios-audio-output";

/**
 * Asking out loud, where the browser can hear.
 *
 * The mic used to be rendered disabled - an affordance that looked like a
 * feature and did nothing, which is worse than no mic at all: it is a control
 * that fails silently every time it is pressed. `SpeechRecognition` is real in
 * Chrome and Safari and absent in Firefox, so this reports whether it exists
 * and the chrome renders the button only when it does. A button that is not
 * there explains itself; a dead one does not.
 *
 * Interim results are surfaced as they arrive, so the words appear in the
 * composer while the sentence is still being said and can be corrected by
 * hand. Nothing is submitted automatically - what was heard is a draft, and
 * a mis-heard prompt costs a response.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

type RecognitionConstructor = new () => SpeechRecognitionLike;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  const holder = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
}

function recorderAvailable(): boolean {
  return typeof window !== "undefined"
    && typeof window.MediaRecorder === "function"
    && Boolean(window.navigator.mediaDevices?.getUserMedia);
}

function supportsVoiceInput(transcriptionAvailable: boolean): boolean {
  return recognitionConstructor() !== undefined
    || (transcriptionAvailable && recorderAvailable());
}

export interface VoiceInput {
  /** False in browsers with no speech recognition, where no button is drawn. */
  supported: boolean;
  listening: boolean;
  /** Recording is over and the words are being worked out. */
  thinking: boolean;
  /**
   * Why it stopped, when it stopped badly.
   *
   * A recogniser fails for reasons the person can act on - the microphone was
   * refused, there is no connection to the service that transcribes - and it
   * fails by simply ending. Swallowing that leaves a button that does nothing
   * when pressed and says nothing about why, which is the exact failure this
   * whole control was rebuilt to avoid.
   */
  error?: string;
  toggle: () => void;
  stop: () => void;
}

export interface VoiceInputRequestOptions {
  endpoint?: string | URL;
  headers?: HeadersInit;
  credentials?: RequestCredentials;
  fetcher?: typeof fetch;
}

const WHY: Record<string, string> = {
  "not-allowed": "The microphone is blocked for this site. Allow it in your browser's settings, then try again.",
  "service-not-allowed": "The microphone is blocked for this site. Allow it in your browser's settings, then try again.",
  "no-speech": "I did not catch that.",
  "audio-capture": "No microphone was found.",
};

/**
 * The way back when the browser's own recogniser cannot reach its service.
 *
 * Chrome's implementation ships audio to a Google server, and when that is
 * unreachable it fails with `network` - which no amount of retrying on this
 * side fixes. So the recording is made here instead and transcribed by the
 * video chat's own route. Slower, because nothing appears until the sentence is
 * finished, and it costs a fraction of a cent - which is why it is what
 * happens after the free path fails rather than instead of it.
 */
function actionEndpoint(endpoint: string | URL): string {
  const value = String(endpoint);
  return `${value}${value.includes("?") ? "&" : "?"}action=transcription`;
}

/** Internal request seam kept separate from microphone capture for deterministic testing. */
export async function transcribeRecording(
  clip: Blob,
  signal: AbortSignal,
  options: VoiceInputRequestOptions,
): Promise<string> {
  const headers = new Headers(options.headers);
  headers.set("content-type", clip.type);
  const response = await (options.fetcher ?? fetch)(actionEndpoint(options.endpoint ?? "/api/video-chat"), {
    method: "POST",
    headers,
    body: clip,
    signal,
    credentials: options.credentials,
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as {
      error?: string | { message?: string };
    };
    const message = typeof detail.error === "string" ? detail.error : detail.error?.message;
    throw new Error(message ?? "The recording could not be transcribed.");
  }
  return String(((await response.json()) as { text?: string }).text ?? "").trim();
}

async function recordAndTranscribe(
  signal: AbortSignal,
  ready: (finish: () => void) => void,
  captured: () => void,
  options: VoiceInputRequestOptions,
): Promise<string> {
  if (signal.aborted) return "";
  const endInput = beginIosAudioInput();
  let stream: MediaStream | undefined;
  let finish: (() => void) | undefined;
  const releaseCapture = () => {
    const capturedStream = stream;
    stream = undefined;
    try {
      for (const track of capturedStream?.getTracks() ?? []) track.stop();
    } finally { endInput(); }
  };
  const abortCapture = () => {
    try { finish?.(); } finally { releaseCapture(); }
  };
  signal.addEventListener("abort", abortCapture, { once: true });
  let clip: Blob | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission can resolve after Stop or unmount. Do not construct a recorder
    // for an operation that has already ended, but always release its tracks.
    if (signal.aborted) return "";
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    const finished = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    finish = () => { if (recorder.state !== "inactive") recorder.stop(); };
    ready(finish);
    if (signal.aborted) return "";
    // A timeslice makes data land while capture is active rather than relying
    // on the final stop event to both flush and finish.
    recorder.start(250);
    await finished;
    if (signal.aborted || chunks.length === 0) return "";

    clip = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
  } finally {
    // Every permission outcome owns tracks, including cancellation races and
    // constructor/start failures.
    signal.removeEventListener("abort", abortCapture);
    releaseCapture();
  }
  if (!clip) return "";
  captured();
  return transcribeRecording(clip, signal, options);
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  transcriptionAvailable = false,
  options: VoiceInputRequestOptions = {},
): VoiceInput {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const [thinking, setThinking] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike>(undefined);
  const recognitionInputRef = useRef<() => void>(undefined);
  // Set once the browser's recogniser has proved it cannot reach its service.
  // It does not recover within a session, so every later press goes straight
  // to the route rather than failing again first.
  const useRecorderRef = useRef(false);
  const operationRef = useRef<{ controller: AbortController; finish?: () => void }>(undefined);
  // Read inside the recogniser's own callbacks, which outlive the render that
  // created them.
  const handlerRef = useRef(onTranscript);
  handlerRef.current = onTranscript;

  useEffect(() => {
    setSupported(supportsVoiceInput(transcriptionAvailable));
  }, [transcriptionAvailable]);

  const abortRecognition = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = undefined;
    const endInput = recognitionInputRef.current;
    recognitionInputRef.current = undefined;
    // Abort may synchronously dispatch an error/end. Revoke ownership first.
    try { recognition?.abort(); } catch { /* Recognition may have already ended. */ }
    finally { endInput?.(); }
  }, []);

  const stop = useCallback(() => {
    abortRecognition();
    const operation = operationRef.current;
    operationRef.current = undefined;
    operation?.controller.abort();
    operation?.finish?.();
    setListening(false);
    setThinking(false);
  }, [abortRecognition]);

  useEffect(() => () => {
    abortRecognition();
    const operation = operationRef.current;
    operationRef.current = undefined;
    operation?.controller.abort();
    operation?.finish?.();
  }, [abortRecognition]);

  const finish = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      return;
    }
    const operation = operationRef.current;
    if (operation?.finish) {
      operation.finish();
      setListening(false);
      return;
    }
    // Permission is still pending, so there is no useful recording to finish.
    stop();
  }, [stop]);

  /** The fallback path: record here, transcribe on the server. */
  const record = useCallback(async () => {
    if (!transcriptionAvailable || !recorderAvailable()) {
      setError("Server transcription is not configured.");
      return;
    }
    if (operationRef.current) return;
    const operation = { controller: new AbortController(), finish: undefined as (() => void) | undefined };
    operationRef.current = operation;
    setError(undefined);
    setListening(true);
    try {
      const heard = await recordAndTranscribe(
        operation.controller.signal,
        (halt) => { if (operationRef.current === operation) operation.finish = halt; },
        () => {
          if (operationRef.current !== operation) return;
          setListening(false);
          setThinking(true);
        },
        options,
      );
      if (!heard || operation.controller.signal.aborted || operationRef.current !== operation) return;
      handlerRef.current(heard);
    } catch (cause) {
      if (operation.controller.signal.aborted || operationRef.current !== operation) return;
      setListening(false);
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/denied|not allowed/i.test(message)
        ? "The microphone is blocked for this site. Allow it in your browser's settings, then try again."
        : message);
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = undefined;
        setListening(false);
        setThinking(false);
      }
    }
  }, [transcriptionAvailable, options.endpoint, options.headers, options.credentials, options.fetcher]);

  const toggle = useCallback(() => {
    if (listening) {
      finish();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition || useRecorderRef.current) {
      void record();
      return;
    }
    setError(undefined);
    const recognition = new Recognition();
    recognition.lang = document.documentElement.lang || "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;
    const endInput = beginIosAudioInput();
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) return;
      let heard = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        heard += event.results[index]?.[0]?.transcript ?? "";
      }
      if (heard.trim()) handlerRef.current(heard.trim());
    };
    // Both endings are the same ending as far as the button is concerned: a
    // permission refusal, a timeout and a finished sentence all mean it is no
    // longer listening, and a mic that stays lit after that is a lie.
    recognition.onend = () => {
      endInput();
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = undefined;
      recognitionInputRef.current = undefined;
      setListening(false);
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) { endInput(); return; }
      abortRecognition();
      setListening(false);
      // A service the browser cannot reach is not something to report as a
      // failure - it is the moment to take the other road, silently, and to
      // keep taking it for the rest of the session.
      if ((event.error === "network" || event.error === "service-not-allowed")
          && transcriptionAvailable && recorderAvailable()) {
        useRecorderRef.current = true;
        void record();
        return;
      }
      setError(event.error === "network"
        ? "Speech recognition is unavailable in this browser."
        : WHY[event.error ?? ""] ?? "The microphone stopped unexpectedly.");
    };
    recognitionRef.current = recognition;
    recognitionInputRef.current = endInput;
    try {
      recognition.start();
      if (recognitionRef.current === recognition) setListening(true);
    } catch {
      if (recognitionRef.current === recognition) abortRecognition();
      else endInput();
      setListening(false);
      setError("The microphone could not be started.");
    }
  }, [listening, finish, record, transcriptionAvailable, abortRecognition]);

  return { supported, listening, thinking, error, toggle, stop };
}
