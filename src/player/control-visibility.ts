import { createFullscreenController, type FullscreenController } from "./fullscreen.js";

const STYLE_ID = "vanillasky-player-control-visibility";

interface SoundtrackOutput {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

interface SoundtrackPlayer {
  context: AudioContext;
  outputs: Map<HTMLAudioElement, SoundtrackOutput | undefined>;
}

const soundtrackPlayers = new Map<HTMLElement, SoundtrackPlayer>();
const fullscreenControllers = new Map<HTMLElement, FullscreenController>();

export async function togglePlayerFullscreen(container: HTMLElement, onModeChange: (mode: "none" | "native" | "fallback") => void): Promise<void> {
  let controller = fullscreenControllers.get(container);
  if (!controller) {
    controller = createFullscreenController(container, onModeChange);
    fullscreenControllers.set(container, controller);
  }
  await controller.toggle();
}

function detachSoundtrack(player: SoundtrackPlayer, audio: HTMLAudioElement): void {
  const output = player.outputs.get(audio);
  output?.source.disconnect();
  output?.gain.disconnect();
  delete audio.dataset.audioOutput;
  if (output) Reflect.deleteProperty(audio, "volume");
  player.outputs.delete(audio);
}

function routeSoundtrack(player: SoundtrackPlayer, audio: HTMLAudioElement): void {
  if (player.outputs.has(audio)) return;
  const url = new URL(audio.currentSrc || audio.src, document.baseURI);
  audio.dataset.audioOutput = "true";
  // Routing a remote, non-CORS source would silence it outright.
  if (url.origin !== location.origin && url.protocol !== "blob:" && url.protocol !== "data:") {
    player.outputs.set(audio, undefined);
    return;
  }
  try {
    const source = player.context.createMediaElementSource(audio);
    const gain = player.context.createGain();
    let volume = Number(audio.dataset.v ?? audio.volume);
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(player.context.destination);
    Object.defineProperty(audio, "volume", {
      configurable: true,
      get: () => volume,
      set: (next: number) => {
        volume = next;
        gain.gain.value = next;
      },
    });
    player.outputs.set(audio, { source, gain });
  } catch {
    // Leave other crossfade outputs intact when one optional track fails.
    player.outputs.set(audio, undefined);
  }
}

export default function attachSoundtrack(audio: HTMLAudioElement, context: AudioContext): void {
  const container = audio.closest<HTMLElement>('[data-testid="video-player"]');
  if (!container?.isConnected || !audio.isConnected) {
    void context.close();
    return;
  }
  const existing = soundtrackPlayers.get(container);
  if (existing) {
    void context.close();
    void existing.context.resume().catch(() => undefined);
    for (const track of container.querySelectorAll('audio')) routeSoundtrack(existing, track);
    return;
  }
  const original = audio.volume;
  let settable = false;
  try {
    audio.volume = original === 0.5 ? 0.25 : 0.5;
    settable = audio.volume !== original;
    audio.volume = original;
  } catch {
    // iOS may reject element-volume writes; the gain fallback still works.
  }
  if (settable) {
    audio.dataset.audioOutput = "true";
    void context.close();
    return;
  }
  const player: SoundtrackPlayer = { context, outputs: new Map() };
  soundtrackPlayers.set(container, player);
  for (const track of container.querySelectorAll('audio')) routeSoundtrack(player, track);
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const container = target.closest<HTMLElement>('[data-testid="video-player"]');
  const player = container ? soundtrackPlayers.get(container) : undefined;
  if (player) void player.context.resume().catch(() => undefined);
}, true);

new MutationObserver(() => {
  for (const [container, player] of soundtrackPlayers) {
    if (!container.isConnected) {
      for (const audio of player.outputs.keys()) detachSoundtrack(player, audio);
      void player.context.close();
      soundtrackPlayers.delete(container);
    } else {
      const tracks = new Set(container.querySelectorAll('audio'));
      for (const audio of player.outputs.keys()) if (!tracks.has(audio)) detachSoundtrack(player, audio);
      for (const audio of tracks) routeSoundtrack(player, audio);
    }
  }
  for (const [container, controller] of fullscreenControllers) {
    if (!container.isConnected) {
      controller.dispose();
      fullscreenControllers.delete(container);
    }
  }
}).observe(document, { childList: true, subtree: true });

if (!document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
      [data-testid="video-controls"] { opacity: 1; transition: opacity 160ms ease; }
      [data-playing="true"] > [data-testid="video-controls"] { opacity: 0; }
      [data-playing="true"][data-touch-controls="true"] > [data-testid="video-controls"],
      [data-playing="true"]:focus-visible > [data-testid="video-controls"],
      [data-playing="true"] > [data-testid="video-controls"]:has(:focus-visible) { opacity: 1; }
      [data-playing="true"] > [data-testid="video-controls"] > div { pointer-events: none; }
      [data-playing="true"][data-touch-controls="true"] > [data-testid="video-controls"] > div,
      [data-playing="true"]:focus-visible > [data-testid="video-controls"] > div,
      [data-playing="true"] > [data-testid="video-controls"]:has(:focus-visible) > div { pointer-events: auto; }
      @media (hover: hover) {
        [data-playing="true"]:hover > [data-testid="video-controls"] { opacity: 1; }
        [data-playing="true"]:hover > [data-testid="video-controls"] > div { pointer-events: auto; }
      }
  `;
  document.head.append(style);
  document.addEventListener("touchstart", (event) => {
    const target = event.target as Element;
    const container = target.closest<HTMLElement>('[data-testid="video-player"]');
    if (container && !target.closest("button")) {
      container.dataset.touchControls = String(container.dataset.touchControls !== "true");
    }
  });
}
