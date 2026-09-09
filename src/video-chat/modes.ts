import type { VideoChatMode } from "./types";

export interface VisualMode {
  id: VideoChatMode;
  label: string;
  note: string;
}
export const visualModes: VisualMode[] = [
  { id: "cinematic", label: "AI video", note: "Generated footage shaped by your prompt" },
  { id: "pexels", label: "Pexels", note: "Stock footage with lower generation costs" },
];
