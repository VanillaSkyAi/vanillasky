type MediaPosition = "center" | "top" | "bottom" | "left" | "right";

const MEDIA_POSITIONS: Record<MediaPosition, string> = {
  center: "center center",
  top: "center top",
  bottom: "center bottom",
  left: "left center",
  right: "right center",
};

export function resolveMediaPosition(value: string): string {
  return MEDIA_POSITIONS[value as MediaPosition] ?? MEDIA_POSITIONS.center;
}
