import { CaptionPages } from "./caption-pages";
import { MEDIA_RECOVERY_NOTICE } from "./recovery";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { VideoOrientation } from "../protocol/types.js";
import { VideoPlayer } from "../player/video-player.js";
import { useVideoChatSession, type UseVideoChatOptions, type VideoChatTurn } from "./use-video-chat.js";
import type { VideoChatSuggestion, VideoChatMode } from "./types.js";
import { ChevronUp, Close, Gear, Mic, Replay, Send, Sound, Stop, Muted, Play, Plus, Sessions, Warning } from "./icons";
import { useDismiss, useFocusTrap } from "./use-dismiss";
import { Welcome } from "./welcome";
import { OpeningChapter } from "./opening-chapter";
import { SuggestionCards } from "./suggestion-cards";
import { useVoiceInput } from "./use-voice-input";
import { useImmersiveControls } from "./use-immersive-controls";
import { Logo } from "./logo";
import { visualModes } from "./modes";
import { AudioSettings } from "./audio-settings";
import { Soundtrack } from "../player/soundtrack";
const DESKTOP_WIDTH = 900;

type Status = "idle" | "drawing" | "narrating" | "paused" | "ended";

function useViewportOrientation(): VideoOrientation {
  const [portrait, setPortrait] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${DESKTOP_WIDTH - 1}px) and (orientation: portrait)`).matches
      : false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(max-width: ${DESKTOP_WIDTH - 1}px) and (orientation: portrait)`);
    const update = () => setPortrait(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return portrait ? "portrait" : "landscape";
}

function Waveform({ active, listening }: { active: boolean; listening?: boolean }) {
  return <span className={`waveform${active ? " on" : ""}${listening ? " hearing" : ""}`} aria-hidden="true">
    {[0, 1, 2, 3, 4].map((bar) => <span key={bar} style={{ animationDelay: `${bar * 140}ms`, animationDuration: `${900 + bar * 130}ms` }} />)}
  </span>;
}

export interface VideoChatProps {
  /** Connection, voice, and rendering defaults for the session. */
  options?: UseVideoChatOptions;
  /** Added to the scoped component root for application layout and branding. */
  className?: string;
  /** Replaces the default two-line welcome heading without changing the interaction. */
  welcomeTitle?: ReactNode;
  /** Application identity only; does not change scenes, prompts or playback. */
  branding?: {
    /** Visible fallback when logo is omitted, and the home link's accessible name. */
    name: string;
    /** App-owned logo element. Give images/SVGs explicit dimensions. */
    logo?: ReactNode;
    /** HTTP(S) or root-relative destination. Omit to preserve the Home/reset shortcut. */
    homeUrl?: string;
    /** Keep the Docs/About/GitHub section in Settings. Defaults to true. */
    showDeveloperLinks?: boolean;
  };
  /** Show a dismissible safe notice when generated visuals fall back. Defaults to false. */
  showRecoveryNotice?: boolean;
}

/** A complete voice-and-video chat interface backed by createVideoChatHandler. */
export function VideoChat({ options = {}, className, welcomeTitle, branding, showRecoveryNotice = false }: VideoChatProps) {
  const appName = branding?.name.trim() || "VanillaSky";
  const customHome = safeHomeUrl(branding?.homeUrl);
  const [dismissedNoticeTurn, setDismissedNoticeTurn] = useState<string>();
  const [draft, setDraft] = useState("");
  const [selectedMode, setSelectedMode] = useState<VideoChatMode>();
  const [savedSessions, setSavedSessions] = useState<Array<{ id: string; turns: readonly VideoChatTurn[] }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [captionsExpanded, setCaptionsExpanded] = useState(false);
  const [alwaysShowControls, setAlwaysShowControls] = useState(false);
  const [editing, setEditing] = useState(false);
  const resumeAfterInput = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const viewportOrientation = useViewportOrientation();
  const sessionOrientation = options.orientation ?? viewportOrientation;
  const { chat, restoreSession, getCaptionProgress } = useVideoChatSession({
    ...options,
    orientation: sessionOrientation,
    mode: selectedMode ?? options.mode,
  });

  const observedMode = useRef<{ id: string; mode: VideoChatMode } | undefined>(undefined);
  useEffect(() => {
    const turn = chat.currentTurn;
    if (!turn?.mode) { observedMode.current = undefined; return; }
    const previous = observedMode.current;
    observedMode.current = { id: turn.id, mode: turn.mode };
    if (turn.id !== chat.shownTurn?.id) return;
    if (previous?.id !== turn.id || previous.mode !== turn.mode) setSelectedMode(turn.mode);
  }, [chat.currentTurn, chat.shownTurn?.id]);

  const instanceId = useId();
  const historyId = `${instanceId}-history`;
  const settingsId = `${instanceId}-settings`;
  const promptId = `${instanceId}-prompt`;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const listen = useVoiceInput(setDraft, chat.capabilities?.transcription ?? false, {
    endpoint: options.endpoint,
    headers: options.headers,
    credentials: options.credentials,
    fetcher: options.fetcher,
  });

  const historySurfaces = useMemo(() => [historyRef, historyButtonRef], []);
  const settingsSurfaces = useMemo(() => [settingsRef, settingsButtonRef], []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismiss(historyOpen, closeHistory, historySurfaces);
  useDismiss(settingsOpen, closeSettings, settingsSurfaces);
  useFocusTrap(settingsOpen, settingsRef);
  useFocusTrap(historyOpen, historyRef);

  const ask = useCallback((value: string | VideoChatSuggestion) => {
    const prompt = (typeof value === "string" ? value : value.prompt).trim();
    if (!prompt) return;
    setDraft("");
    listen.stop();
    setHistoryOpen(false);
    setSettingsOpen(false);
    setCaptionsExpanded(false);
    setEditing(false);
    resumeAfterInput.current = false;
    inputRef.current?.blur();
    void chat.ask(prompt, typeof value === "string" ? undefined : {
      opening: value.opening,
    });
  }, [chat, listen]);

  const newSession = useCallback(() => {
    if (chat.turns.length === 0) {
      setHistoryOpen(false);
      setSettingsOpen(false);
      inputRef.current?.focus();
      return;
    }
    listen.stop();
    setDraft("");
    const completed = chat.turns.filter((turn) => turn.completed && turn.video);
    if (completed.length) setSavedSessions((sessions) => [{ id: completed[0]!.id, turns: completed }, ...sessions].slice(0, 10));
    chat.reset();
    setHistoryOpen(false);
    setSettingsOpen(false);
    setCaptionsExpanded(false);
    setEditing(false);
    resumeAfterInput.current = false;
    inputRef.current?.blur();
  }, [chat, listen]);

  const shown = chat.shownTurn;
  const soundtrackRef = useRef<HTMLAudioElement | null>(null);
  const showing = chat.playerProps != null;
  const handoffKey = `${shown?.id ?? ""}:${chat.playerKey}`;
  const [presentedBody, setPresentedBody] = useState<string>();
  const handoff = useRef({key: handoffKey, live: showing, active: false, frame: 0});
  const handoffStopped = chat.status === "error" || chat.status === "cancelled";
  const waitingForBody = showing && presentedBody !== handoffKey;
  const openingChapter = Boolean(shown?.prompt) && (!showing || waitingForBody)
    && chat.status !== "error" && chat.status !== "cancelled" && chat.status !== "ended";
  const [preparingKey, setPreparingKey] = useState<string>();
  useEffect(() => {
    setPreparingKey(undefined);
    if (!openingChapter || !shown?.opening || chat.speaking) return;
    const timer = setTimeout(() => setPreparingKey(shown.id), 1000);
    return () => clearTimeout(timer);
  }, [openingChapter, shown?.opening, shown?.id, chat.speaking]);
  useLayoutEffect(() => {
    const current = {key: handoffKey, live: showing && !handoffStopped, active: openingChapter && showing, frame: 0};
    handoff.current = current;
    return () => {current.live = false; current.active = false; cancelAnimationFrame(current.frame);};
  }, [handoffKey, openingChapter, showing, handoffStopped]);
  const cueBody: NonNullable<NonNullable<typeof chat.playerProps>["onSceneChange"]> = (scene, index) => {
    const current = handoff.current;
    if (!current.live || current.key !== handoffKey) return;
    chat.playerProps?.onSceneChange?.(scene, index);
    if (!current.active) return;
    cancelAnimationFrame(current.frame);
    // The player cues only after its actual visual readiness gate. Keep the
    // opening above that mounted player until the existing voice gate settles.
    const reveal = () => {
      if (!current.active || handoff.current !== current) return;
      let ready = false;
      try { ready = chat.playerProps?.narrationReady?.() !== false; }
      catch { /* The player owns narration errors and its bounded deadline. */ }
      if (ready) {current.active = false; setPresentedBody(handoffKey);}
      else current.frame = requestAnimationFrame(reveal);
    };
    reveal();
  };
  const openingTitle = shown?.opening ?? shown?.prompt ?? "";
  const status: Status = chat.turns.length === 0 ? "idle"
    : chat.status === "composing" ? "drawing"
    : chat.status === "playing" ? "narrating"
    : chat.status === "error" || chat.status === "cancelled" ? "ended"
    : chat.status;

  const shownOrientation = shown?.orientation ?? sessionOrientation;
  const stageOrientation = shown?.fixedOrientation ? shownOrientation : sessionOrientation;
  useEffect(() => {
    setCaptionsExpanded(false);
  }, [chat.playbackEnded, shown?.id, chat.playerKey]);
  const line = chat.caption ?? "";
  const fullTranscript = shown?.video ? [shown.opening, ...shown.video.scenes.map((scene) => scene.narration)].filter((entry): entry is string => Boolean(entry)) : chat.transcript;
  const transport = status === "narrating" || (status === "drawing" && chat.soundtrack)
    ? { label: "Pause", action: chat.pause, icon: <Stop /> }
    : status === "paused"
      ? { label: "Continue", action: chat.resume, icon: <Play /> }
      : status === "ended" && shown?.completed && shown.video
        ? { label: "Play again", action: chat.replay, icon: <Replay /> }
        : undefined;

  const cancelInput = useCallback(() => {
    listen.stop();
    setDraft("");
    setEditing(false);
    inputRef.current?.blur();
    if (resumeAfterInput.current) chat.resume();
    resumeAfterInput.current = false;
  }, [listen, chat]);
  const beginInput = (speak = false) => {
    if (!editing) {
      resumeAfterInput.current = chat.status === "playing" || chat.status === "composing";
      if (resumeAfterInput.current) chat.pause();
    }
    setEditing(true);
    setSettingsOpen(false);
    setHistoryOpen(false);
    if (speak) listen.toggle();
  };
  const controls = useImmersiveControls(
    !chat.playbackEnded && (status === "narrating" || (Boolean(line) && status !== "paused")),
    chat.playbackEnded || alwaysShowControls || captionsExpanded || editing || historyOpen || settingsOpen || listen.listening || listen.thinking || Boolean(chat.error || listen.error),
    captionsOn && Boolean(line),
  );
  const captionControls = useImmersiveControls(Boolean(line), captionsExpanded, false);
  const controlEvents = {
    onPointerEnter: controls.onPointerEnter, onPointerLeave: controls.onPointerLeave,
    onFocusCapture: controls.onFocusCapture, onBlurCapture: controls.onBlurCapture,
  };
  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const measure = () => panelRef.current?.style.setProperty("--composer-height", `${composer.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);

  return <div
    className={`vanillasky-video-chat${className ? ` ${className}` : ""}`}
    data-soundtrack-owner=""
    data-orientation={stageOrientation}
    data-controls-visible={controls.visible}
    tabIndex={0}
    aria-label="Video conversation"
    onPointerMove={controls.reveal}
    onPointerDown={controls.reveal}
    onKeyDownCapture={controls.reveal}
  >
    {shown && !["idle", "cancelled", "error"].includes(chat.status) && <Soundtrack
      key={`${shown.id}:${chat.playerProps?.video ? chat.playerKey : "live"}`}
      audio={chat.playbackEnded ? undefined : chat.soundtrack} audioRef={soundtrackRef}
      playing={chat.status !== "paused"} muted={chat.muted} volume={chat.audioPreferences.musicVolume}
      ducked={chat.backgroundDucked} waiting={chat.backgroundWaiting}
      time={0} duration={0} terminal={false} />}
    <header className="chrome" {...controlEvents}>
      <div className="session-brand"><a className="home-link" href={customHome ?? "/"} aria-label={branding ? `${appName} home` : "Home"}
        style={branding ? { color: "inherit", textDecoration: "none" } : undefined} onClick={event => {
        if (customHome || window.location.pathname !== "/" || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        newSession();
      }}>{branding ? branding.logo ?? appName : <Logo />}</a></div>
      <div className="group">
        <button
          ref={historyButtonRef}
          type="button"
          className="pill"
          aria-expanded={historyOpen}
          aria-label="Sessions"
          aria-haspopup="dialog"
          aria-controls={historyId}
          onClick={() => { setHistoryOpen((open) => !open); setSettingsOpen(false); }}
        >
          <Sessions /><span className="nav-label">Sessions</span>
        </button>
        <button
          ref={settingsButtonRef}
          type="button"
          className="round"
          aria-label="Settings"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          aria-haspopup="dialog"
          onClick={() => { setSettingsOpen((open) => !open); setHistoryOpen(false); }}
        ><Gear /></button>
        <button
          type="button"
          className="round"
          aria-label={chat.muted ? "Unmute sound" : "Mute sound"}
          aria-pressed={chat.muted}
          onClick={() => chat.setMuted(!chat.muted)}
        >{chat.muted ? <Muted /> : <Sound />}</button>
      </div>
    </header>

    <div className="stage-area">
      <div className="stage" style={{ background: "#000" }}>
        {openingChapter && <OpeningChapter key={shown!.id} preparing={preparingKey === shown!.id && !chat.speaking} title={openingTitle.length > 120 ? `${openingTitle.slice(0, 117).trimEnd()}…` : openingTitle} />}
        {!showing && chat.turns.length === 0 && <Welcome data={chat.welcome} onAsk={ask} title={welcomeTitle} />}
        {chat.playerProps && <div className="player-fit" style={{ width: stageOrientation === "portrait" ? "min(100cqw, 56.25cqh)" : "min(100cqw, 177.7778cqh)" }}><VideoPlayer
          key={chat.playerKey}
          {...chat.playerProps}
          soundtrack={false}
          onSceneChange={cueBody}
          orientation={stageOrientation}
          responsiveBreakpoint={DESKTOP_WIDTH}
          ariaLabel={chat.playerProps.video ? "Replay" : "The response"}
        /></div>}

        {showing && chat.playbackEnded && chat.suggestions.length > 0 && <div className="ending">
          <div className="ending-wash" aria-hidden="true" />
          <div className="ending-body">
            <p className="ending-label">Ask next</p>
            <SuggestionCards suggestions={[...chat.suggestions]} label="Follow-up prompts" onAsk={ask} />
          </div>
        </div>}
      </div>

      {historyOpen && <nav ref={historyRef} id={historyId} className="sheet-popover history" role="dialog" aria-modal="true" aria-label="Sessions">
        <div className="popover-heading"><h2>Sessions</h2><button type="button" className="round" aria-label="Close sessions" onClick={closeHistory}><Close /></button></div>
        <button type="button" className="history-row session-new" aria-label="New session" onClick={newSession}><Plus /><span className="prompt">New session<small>Start a fresh conversation</small></span></button>
        <h3 className="section-label">Current session</h3>
        {chat.turns.length === 0 && <p className="history-empty">Your questions will appear here.</p>}
        {chat.turns.map((turn, index) => <button key={turn.id} type="button"
          className={`history-row${turn.id === shown?.id ? " current" : ""}`}
          aria-current={turn.id === shown?.id ? true : undefined}
          disabled={!turn.completed || !turn.video}
          onClick={() => { listen.stop(); setDraft(""); setEditing(false); resumeAfterInput.current = false; chat.selectTurn(turn.id); setHistoryOpen(false); }}>
          <span className="index">{String(index + 1).padStart(2, "0")}</span>
          <span className="prompt">{turn.prompt}<small>{turn.id === shown?.id ? "Now showing" : turn.completed ? "Play answer" : "Unfinished answer"}</small></span>
        </button>)}
        {savedSessions.length > 0 && <><h3 className="section-label">Earlier sessions</h3>
          {savedSessions.map((session) => <button type="button" className="history-row" key={session.id} onClick={() => {
            listen.stop(); setDraft(""); setEditing(false); resumeAfterInput.current = false;
            const completed = chat.turns.filter((turn) => turn.completed && turn.video);
            setSavedSessions((sessions) => [...(completed.length ? [{ id: completed[0]!.id, turns: completed }] : []), ...sessions.filter((entry) => entry.id !== session.id)].slice(0, 10));
            restoreSession(session.turns); setHistoryOpen(false); setCaptionsExpanded(false);
          }}><Replay /><span className="prompt">{session.turns[0]?.prompt}<small>{session.turns.length} {session.turns.length === 1 ? "answer" : "answers"}</small></span></button>)}
        </>}
      </nav>}

      {settingsOpen && <div
        ref={settingsRef}
        id={settingsId}
        className="sheet-popover settings"
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
      >
        <div className="popover-heading"><h2>Settings</h2><button type="button" className="round" aria-label="Close settings" onClick={closeSettings}><Close /></button></div>
        <fieldset className="playback-options"><legend>Video source</legend>
          {visualModes.filter((mode) => chat.availableModes.includes(mode.id)).map((mode) =>
            <label className="switch-row" key={mode.id}><span><strong>{mode.label}</strong><small>{mode.note}</small></span><input
              type="radio" name={`${instanceId}-source`} value={mode.id}
              checked={(selectedMode ?? options.mode ?? "cinematic") === mode.id}
              onChange={() => setSelectedMode(mode.id)} /></label>)}
        </fieldset>
        <AudioSettings preferences={chat.audioPreferences} change={chat.setAudioPreferences} reset={chat.resetAudioPreferences}
          shuffle={chat.shuffleMusic} trackId={chat.soundtrack?.trackId}
          sceneAudioAvailable={Boolean((chat.capabilities?.generatedVideoAudio && (selectedMode ?? options.mode ?? "cinematic") === "cinematic")
            || shown?.video?.scenes.some(scene => scene.variables.mediaAudio === "ambient"))} />
        <fieldset className="playback-options"><legend>Watching</legend>
          <label className="switch-row"><span><strong>Subtitles</strong><small>Read along with the answer</small></span><input type="checkbox" role="switch" checked={captionsOn} onChange={(event) => { setCaptionsOn(event.target.checked); setCaptionsExpanded(false); }} /></label>
          <label className="switch-row"><span><strong>Keep controls visible</strong><small>Keep the input bar on screen</small></span><input type="checkbox" role="switch" checked={alwaysShowControls} onChange={(event) => setAlwaysShowControls(event.target.checked)} /></label>
        </fieldset>
        {branding?.showDeveloperLinks !== false && <nav className="developer-links" aria-label="Build with VanillaSky">
          <p className="section-label">Build with VanillaSky</p>
          <a href="https://github.com/VanillaSkyAi/video/blob/main/docs/getting-started.md" target="_blank" rel="noopener noreferrer">Docs<span aria-hidden="true">↗</span></a>
          <button type="button" aria-expanded={aboutOpen} aria-controls={`${instanceId}-about`} onClick={() => setAboutOpen((open) => !open)}>About<span aria-hidden="true">{aboutOpen ? "−" : "+"}</span></button>
          <div id={`${instanceId}-about`} className="developer-about" role="region" aria-label="About VanillaSky" hidden={!aboutOpen}><p>VanillaSky is an open-source application for conversations that answer in video. Run it with your own AI providers and make it yours.</p></div>
          <a href="https://github.com/VanillaSkyAi/video" target="_blank" rel="noopener noreferrer">GitHub<span aria-hidden="true">↗</span></a>
        </nav>}
      </div>}
    </div>

    <div ref={panelRef} className="panel" data-input-visible={controls.visible || !captionsOn || !line}>
      <div className="panel-inner">
        <div className="caption-slot" data-captions={captionsOn && Boolean(line)} aria-hidden={!captionsOn || !line}>
          <div className="caption-clip">
            {chat.playbackEnded && !captionsExpanded ? <button type="button" className="transcript-toggle" aria-expanded={false} onClick={() => setCaptionsExpanded(true)}>Show transcript<ChevronUp /></button> : <div className="line-row" data-expanded={captionsExpanded} data-actions-visible={captionControls.visible}
              onPointerMove={captionControls.onPointerEnter} onPointerLeave={captionControls.onPointerLeave}
              onPointerDown={captionControls.reveal} onFocusCapture={captionControls.onFocusCapture} onBlurCapture={captionControls.onBlurCapture}>
              {captionsOn && line && <div className="caption-actions">
                <button type="button" className="caption-action" aria-label={captionsExpanded ? "Collapse subtitles" : "Expand subtitles"} aria-expanded={captionsExpanded} onClick={() => setCaptionsExpanded((open) => !open)}>{captionsExpanded ? "Collapse" : "Expand"}<ChevronUp /></button>
                <button type="button" className="caption-action" aria-label="Hide subtitles" onClick={() => { setCaptionsOn(false); setCaptionsExpanded(false); }}><Close /></button>
              </div>}
              {captionsExpanded ? <div className="expanded-captions" role="region" tabIndex={0} aria-label="Expanded subtitles">
                {fullTranscript.map((entry, index) => <p key={index}>{entry}</p>)}
              </div> : <CaptionPages key={`${shown?.id}:${chat.playerKey}`} text={line} getProgress={getCaptionProgress} />}
            </div>}
          </div>
        </div>
        {showRecoveryNotice && chat.shownTurn && dismissedNoticeTurn !== chat.shownTurn.id && chat.warnings.includes(MEDIA_RECOVERY_NOTICE) && !chat.error && <div className="recovery-notice">
          <p role="status">{MEDIA_RECOVERY_NOTICE}</p>
          <button type="button" className="round" aria-label="Dismiss notice" onClick={() => setDismissedNoticeTurn(chat.shownTurn?.id)}><Close /></button>
        </div>}
        {(chat.error || listen.error) && <p className="error" role="status"><Warning /><span>{chat.error?.message ?? listen.error}</span></p>}
        <div ref={composerRef} className="conversation-composer" data-editing={editing} {...controlEvents}>
          {(listen.listening || listen.thinking) && <div className="composer-meta"><span role="status">{listen.listening ? "Listening… Tap the mic to finish, then review and send." : "Turning your words into a draft…"}</span></div>}
          <form className="composer" aria-label="Ask a question" onSubmit={(event) => { event.preventDefault(); ask(draft); }}>
            {transport && <button type="button" className="ghost transport" aria-label={transport.label} onClick={() => { listen.stop(); setEditing(false); resumeAfterInput.current = false; inputRef.current?.blur(); transport.action(); }}>{transport.icon}</button>}
            <Waveform active={listen.listening || (chat.speaking && !chat.muted && status !== "paused")} listening={listen.listening} />
            <label className="sr-only" htmlFor={promptId}>Prompt</label>
            <textarea id={promptId} ref={inputRef} rows={1} value={draft}
              placeholder={listen.listening ? "Listening…" : chat.turns.length ? "Ask a follow-up…" : "Ask anything…"}
              onFocus={() => { if (!editing) beginInput(); }}
              onChange={(event) => { setDraft(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`; }}
              onKeyDown={(event) => {
                if (event.key === "Escape") { event.stopPropagation(); cancelInput(); }
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); ask(draft); }
              }} />
            {listen.supported && <button type="button" className={`ghost${listen.listening ? " listening" : ""}`} aria-label={listen.listening ? "Stop listening" : "Ask by voice"} aria-pressed={listen.listening} disabled={listen.thinking} onClick={() => beginInput(true)}><Mic /></button>}
            <button type="submit" className="send" aria-label="Ask" disabled={!draft.trim() || listen.thinking}><Send /></button>
            {editing && <button type="button" className="ghost" aria-label="Cancel question" onClick={cancelInput}><Close /></button>}
          </form>
        </div>
        {!showing && chat.turns.length === 0 && <p className="dock-hint">Speak or type. See where it takes you.</p>}
      </div>
    </div>
  </div>;
}

function safeHomeUrl(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  if (!candidate || !/^(?:https?:\/\/|\/(?![/\\]))/i.test(candidate)) return undefined;
  try {
    const url = new URL(candidate, "https://vanillasky.local");
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
    return candidate.startsWith("/") ? `${url.pathname}${url.search}${url.hash}` : url.href;
  } catch { return undefined; }
}
