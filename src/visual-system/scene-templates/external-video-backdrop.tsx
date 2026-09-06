import React from "react";

// Source-owned templates may live in a consumer's tree while VideoFrame comes
// from the package. Both copies must observe the same internal context or the
// consumer template would mount a second video over the player-owned plane,
// and would never inherit the player's native media audio state.
export type ExternalVideoBackdropMode = false | "pending" | "ready" | "fallback";

interface BackdropContextValue {
  mode: ExternalVideoBackdropMode;
  audioMuted: boolean;
  audioVolume: number;
  preparingNarration?: boolean;
  onMediaError?: () => void;
}

const DEFAULT: BackdropContextValue = { mode: false, audioMuted: true, audioVolume: 1 };

const sharedContext = globalThis as typeof globalThis & {
  __vanillaskyVideoBackdropContext?: React.Context<BackdropContextValue>;
};
const BackdropContext = sharedContext.__vanillaskyVideoBackdropContext
  ??= React.createContext<BackdropContextValue>(DEFAULT);

export function ExternalVideoBackdropProvider({
  mode,
  audioMuted = true,
  audioVolume = 1,
  preparingNarration = false,
  onMediaError,
  children,
}: {
  mode: ExternalVideoBackdropMode;
  audioMuted?: boolean;
  audioVolume?: number;
  preparingNarration?: boolean;
  onMediaError?: () => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(
    () => ({ mode, audioMuted, audioVolume, preparingNarration, onMediaError }),
    [mode, audioMuted, audioVolume, preparingNarration, onMediaError],
  );
  return (
    <BackdropContext.Provider value={value}>
      {children}
    </BackdropContext.Provider>
  );
}

export function useExternalVideoBackdrop(): ExternalVideoBackdropMode {
  return React.useContext(BackdropContext).mode;
}

export function useMediaAudio(): { muted: boolean; volume: number } {
  const { audioMuted, audioVolume } = React.useContext(BackdropContext);
  return { muted: audioMuted, volume: audioVolume };
}

/** Internal first-frame priming state; an explicit viewer pause never sets it. */
export function useNarrationPreroll(): boolean {
  return React.useContext(BackdropContext).preparingNarration === true;
}

/** Routes local decoder/playback failures to the scene-owned recovery surface. */
export function useMediaFailure(): (() => void) | undefined {
  return React.useContext(BackdropContext).onMediaError;
}
