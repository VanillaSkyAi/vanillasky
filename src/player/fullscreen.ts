type FullscreenToggleResult = "entered" | "exited" | "fallback" | "exit-failed";

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitCancelFullScreen?: () => Promise<void> | void;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
};

async function toggleFullscreen(container: HTMLElement): Promise<FullscreenToggleResult> {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  const standardFullscreenElement = document.fullscreenElement;
  const webkitFullscreenElement = fullscreenDocument.webkitFullscreenElement;
  const fullscreenElement = standardFullscreenElement ?? webkitFullscreenElement;

  if (fullscreenElement === container) {
    const exitFullscreen = standardFullscreenElement === container
      ? document.exitFullscreen
        ?? fullscreenDocument.webkitExitFullscreen
        ?? fullscreenDocument.webkitCancelFullScreen
      : fullscreenDocument.webkitExitFullscreen
        ?? fullscreenDocument.webkitCancelFullScreen
        ?? document.exitFullscreen;
    try {
      await exitFullscreen?.call(document);
      return "exited";
    } catch {
      return "exit-failed";
    }
  }

  const fullscreenContainer = container as WebkitFullscreenElement;
  const requestFullscreen = container.requestFullscreen
    ?? fullscreenContainer.webkitRequestFullscreen
    ?? fullscreenContainer.webkitRequestFullScreen;
  if (!requestFullscreen) return "fallback";

  try {
    await requestFullscreen.call(container);
    return "entered";
  } catch {
    return "fallback";
  }
}

function subscribeFullscreen(container: HTMLElement, onChange: (active: boolean) => void): () => void {
  const fullscreenDocument = document as WebkitFullscreenDocument;
  const update = () => onChange(
    (document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement) === container,
  );
  document.addEventListener("fullscreenchange", update);
  document.addEventListener("webkitfullscreenchange", update);
  return () => {
    document.removeEventListener("fullscreenchange", update);
    document.removeEventListener("webkitfullscreenchange", update);
  };
}

function installFallbackFullscreen(onEscape: () => void): () => void {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const exitOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") onEscape();
  };
  document.addEventListener("keydown", exitOnEscape);
  return () => {
    document.removeEventListener("keydown", exitOnEscape);
    document.body.style.overflow = previousOverflow;
  };
}

export interface FullscreenController {
  toggle(): Promise<void>;
  dispose(): void;
}

export function createFullscreenController(
  container: HTMLElement,
  onModeChange: (mode: "none" | "native" | "fallback") => void,
): FullscreenController {
  if (!document.getElementById("vanillasky-fullscreen")) {
    const style = document.createElement("style");
    style.id = "vanillasky-fullscreen";
    style.textContent = `
      [data-fullscreen="native"], [data-fullscreen="fallback"] { width: 100vw !important; height: 100dvh !important; border: none !important; border-radius: 0 !important; }
      [data-fullscreen="fallback"] { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; }
      [data-fullscreen="native"] > [data-video-frame="ready"], [data-fullscreen="fallback"] > [data-video-frame="ready"] { left: var(--vs-frame-left) !important; top: var(--vs-frame-top) !important; transform: scale(var(--vs-frame-scale)) !important; }
      [data-fullscreen="fallback"] [data-testid="video-primary-controls"] { left: calc(20px + env(safe-area-inset-left, 0px)) !important; bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important; }
      [data-fullscreen="fallback"] [data-testid="video-secondary-controls"] { right: calc(20px + env(safe-area-inset-right, 0px)) !important; bottom: calc(20px + env(safe-area-inset-bottom, 0px)) !important; }
    `;
    document.head.append(style);
  }
  let mode: "none" | "native" | "fallback" = "none";
  let removeFallback: (() => void) | undefined;
  let frame = 0;
  const present = () => {
    const surface = container.querySelector<HTMLElement>(':scope > [data-video-frame="ready"]');
    if (!surface) return;
    const width = parseFloat(surface.style.width);
    const height = parseFloat(surface.style.height);
    const scale = Math.min(container.clientWidth / width, container.clientHeight / height);
    container.style.setProperty("--vs-frame-scale", String(scale));
    container.style.setProperty("--vs-frame-left", `${(container.clientWidth - width * scale) / 2}px`);
    container.style.setProperty("--vs-frame-top", `${(container.clientHeight - height * scale) / 2}px`);
  };
  const schedulePresentation = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(present);
  };
  const resize = () => mode !== "none" && schedulePresentation();
  window.addEventListener("resize", resize);
  const setMode = (next: typeof mode) => {
    if (mode === next) return;
    removeFallback?.();
    removeFallback = undefined;
    mode = next;
    if (next === "fallback") {
      removeFallback = installFallbackFullscreen(() => setMode("none"));
    }
    onModeChange(next);
    if (next === "none") {
      container.style.removeProperty("--vs-frame-scale");
      container.style.removeProperty("--vs-frame-left");
      container.style.removeProperty("--vs-frame-top");
    } else schedulePresentation();
  };
  const unsubscribe = subscribeFullscreen(container, (active) => {
    if (active) setMode("native");
    else if (mode === "native") setMode("none");
  });

  return {
    async toggle() {
      if (mode === "fallback") {
        setMode("none");
        return;
      }
      const result = await toggleFullscreen(container);
      if (result === "entered") setMode("native");
      else if (result === "fallback") setMode("fallback");
      else setMode("none");
    },
    dispose() {
      unsubscribe();
      removeFallback?.();
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frame);
    },
  };
}
