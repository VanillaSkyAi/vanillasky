/** The director combines footage and graphics per scene. */
export interface VisualMode {
  id: "cinematic";
  label: string;
  note: string;
}
export const visualModes: VisualMode[] = [
  { id: "cinematic", label: "Cinematic", note: "A coherent mix of footage and editorial graphics" },
];
export const defaultMode = visualModes[0];
export const modeById = (_id: string): VisualMode => defaultMode;
