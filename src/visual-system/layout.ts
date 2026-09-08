import type { VideoOrientation } from "../protocol/types.js";

export interface VideoDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

export function getDimensions(orientation: VideoOrientation = "portrait"): VideoDimensions {
  return orientation === "landscape"
    ? { width: 1920, height: 1080, aspectRatio: "16 / 9" }
    : { width: 1080, height: 1920, aspectRatio: "9 / 16" };
}
