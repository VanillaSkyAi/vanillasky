/** Shared render context for built-in and project-owned scene templates. */
export interface TemplateStyle {
  preset?: string;
  density?: string;
  motion?: string;
  defaultTextArchetype?: string;
  defaultTransition?: string;
  defaultBackgroundEffect?: string;
}

export interface SafeZone {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
