export interface TemplateJsonSchemaProperty {
  readonly type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  /** Semantic formats enforced by runtime validation instead of inferred from field names. */
  readonly format?: "uri" | "supplied-image" | "grounded-quote" | "grounded-stat" | "stock-media-keyword" | "emoji";
  readonly enum?: readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly examples?: readonly unknown[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: TemplateJsonSchemaProperty;
  readonly properties?: Readonly<Record<string, TemplateJsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface TemplateJsonSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, TemplateJsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly "x-vanillasky"?: {
    readonly requiresStat?: boolean;
    readonly allowsStockMedia?: boolean;
    /** Every group requires at least one declared top-level field with a meaningful non-empty value. */
    readonly requiredAnyOf?: readonly (readonly string[])[];
  };
}

export type TemplateJob =
  | "setup"
  | "claim"
  | "proof"
  | "atmosphere"
  | "payoff"
  | "punctuation"
  | "ask";

export type TemplateRegister =
  | "motion-led"
  | "typography-led"
  | "device-led"
  | "card-led"
  | "mockup-led";

export type TemplateFamily =
  | "Media & motion"
  | "Data & metrics"
  | "Product showcase"
  | "Social & messaging"
  | "Explainers"
  | "Calls to action";

export interface TemplateTimingMetadata {
  /** Schema fields whose rendered content may inform a future adaptive duration. */
  readonly contentFields: readonly string[];
  /** Authored motion and uninterrupted reading minimums in seconds. */
  readonly revealSeconds?: number;
  readonly holdSeconds?: number;
  readonly exitSeconds?: number;
  /** How content in contentFields should be measured; no runtime behavior is implied. */
  readonly contentUnit: "words" | "characters" | "items";
}

export interface TemplateTransitionTiming {
  /** Earliest readable local motion point used when this scene enters from a global transition. */
  readonly entryReadyProgress: number;
  /** Audited readable checkpoint before the template's own exit animation begins. */
  readonly holdProgress: number;
}

export interface SceneTemplateMetadata {
  id: string;
  label?: string;
  description?: string;
  category?: string | null;
  /** Human-readable browse group. */
  family?: TemplateFamily;
  jobs?: TemplateJob[];
  register?: TemplateRegister;
  useWhen?: string;
  avoidWhen?: string;
  usesGlobalTextEffect: boolean;
  /** Opts into renderer-owned transitions. Defaults to false for customer templates. */
  usesGlobalTransition: boolean;
  /** Required exactly when usesGlobalTransition is true. */
  transitionTiming?: TemplateTransitionTiming;
  usesGlobalBackgroundEffect: boolean;
  textCanvas?: "tight" | "open";
  /** The only authoring contract for defaults, validation, planning, grounding, and editor fields. */
  schema: TemplateJsonSchema;
  minDuration?: number;
  preferredDuration?: number;
  /** Declarative hints for future content-aware duration selection. */
  timing?: TemplateTimingMetadata;
}

export interface TemplateMetadataCatalog {
  listTemplateMetadata(): SceneTemplateMetadata[];
}
