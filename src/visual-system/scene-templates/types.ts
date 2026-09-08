/** Internal props for the chapter and footage renderers. */
export interface SceneTemplateProps {
  variables: Record<string, unknown>;
  /** Full scene clock, from 0 to 1. */
  progress: number;
  /** Chapter presentation clock; may hold its final readable frame. */
  motionProgress?: number;
  width: number;
  height: number;
  sceneDuration?: number;
  /** Undefined is treated as playing for static capture. */
  isPlaying?: boolean;
}
