import type { SceneTemplateProps } from "./types";
import { SceneBackground, getMediaBackgroundProps } from "./scene-background";

/** The shared media plane owns decoding, playback, and poster handoff. */
export function MediaScene({ variables, width, height, progress, sceneDuration, isPlaying }: SceneTemplateProps) {
  return <div data-template="cinemaMedia" style={{ width, height, position: "relative", overflow: "hidden" }}>
    <SceneBackground progress={progress} sceneDuration={sceneDuration} {...getMediaBackgroundProps(variables)} isPlaying={isPlaying} />
  </div>;
}
