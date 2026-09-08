/** Internal monochrome render tokens for cinematic scenes and shared primitives. */
import type { TemplateStyle } from "../template-context";

// ─── Canonical defaults (the only place these values are defined) ──

export const TOKEN_DEFAULTS = {
  /** Primary brand colour — CTA, highlights. */
  primary: "#00E5A0",
  /** Deepest background surface. */
  surface: "#0A0A14",
  /** Elevated card / panel surface. */
  surfaceElevated: "#14152A",
  /** Primary text color. */
  foreground: "#FFFFFF",
  /** Muted text — labels, footers, supporting copy. */
  muted: "#A7A6B0",
  /** Primary sans font family (first name of the stack). */
  font: "Inter",
  /** Script accent font family for handwritten callouts. */
  scriptFont: "Caveat",
} as const;

/**
 * The canonical template font stack: first family of the resolved brand font, backed by
 * OS-native sans fallbacks that render identically in preview and the
 * SVG-as-image export path.
 */
export function fontStack(styleFont: string | undefined): string {
  return `${(styleFont || "").split(",")[0].trim() || TOKEN_DEFAULTS.font}, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

// ─── Resolved tokens ───────────────────────────────────────────────

// ─── Style presets ─────────────────────────────────────────────────

/**
 * Background families a preset can pick. Each resolves to a pure CSS
 * background string in `gradientBackground` — no CSS `filter`, which the
 * SVG export path cannot rasterize.
 */
export type BackgroundFamily = "mesh" | "wash" | "spotlight";

/** Title placement a preset defaults to (SceneFrameVariant, minus no-title). */
export type PresetTitlePlacement = "title-top" | "title-center";

export interface TypeTreatment {
  /** Added to the computed fontWeight (clamped 100–900). */
  weightDelta: number;
  /** Added to the size role's letterSpacing, in em. */
  trackingDeltaEm: number;
  /** Multiplies the computed fontSize. */
  sizeScale: number;
  /** Applied as CSS text-transform when set. */
  transform?: "uppercase";
  /**
   * Multiplies every text-archetype entrance/exit phase duration. Set by
   * `resolveTokens` from `style.motion`; absent on the raw preset literals,
   * where it reads as 1.
   *
   * It rides on the type treatment because that object is the one channel
   * that already flows from `style` into text rendering. Pacing of
   * typographic motion is part of how the type is treated, so this isn't a
   * smuggled payload.
   */
  phaseScale?: number;
}

export interface StylePreset {
  id: string;
  /** Agent-facing use-when — surfaced in the registry index. */
  useWhen: string;
  background: BackgroundFamily;
  titlePlacement: PresetTitlePlacement;
  type: TypeTreatment;
}

/**
 * The named looks. `bold` is the default and is a deliberate no-op: a config
 * with no `preset` resolves to it and renders byte-identically to the
 * pre-preset output, so adding presets can't restyle anyone's existing video.
 *
 * Deliberately small. Every preset multiplies the QA surface by every
 * template at both orientations — grow this only when a brief can't be
 * expressed by the ones here.
 */
export const STYLE_PRESETS: Record<string, StylePreset> = {
  bold: {
    id: "bold",
    useWhen:
      "The default. Drifting two-color brand mesh, heavy tight headlines at the top. Launches, hype, product moments — the loudest of the three.",
    background: "mesh",
    titlePlacement: "title-top",
    type: { weightDelta: 0, trackingDeltaEm: 0, sizeScale: 1 },
  },
  editorial: {
    id: "editorial",
    useWhen:
      "Calm vertical wash, lighter and wider-tracked headlines, centered. Reviews, thoughtful updates, premium or B2B brands — when the copy should feel considered rather than shouted.",
    background: "wash",
    titlePlacement: "title-center",
    type: { weightDelta: -200, trackingDeltaEm: 0.01, sizeScale: 1.08 },
  },
  stark: {
    id: "stark",
    useWhen:
      "Single hard spotlight on near-black, uppercase and tightly tracked. Dev tools, technical claims, high-contrast statements — maximum weight on very few words.",
    background: "spotlight",
    titlePlacement: "title-top",
    type: { weightDelta: 100, trackingDeltaEm: -0.01, sizeScale: 1, transform: "uppercase" },
  },
};

export const DEFAULT_PRESET_ID = "bold";
export const PRESET_IDS = Object.keys(STYLE_PRESETS);

/** Unknown/unset ids fall back to the default rather than throwing — a bad
 *  preset should never be the reason a render fails. */
export function resolvePreset(id: string | undefined): StylePreset {
  return (id && STYLE_PRESETS[id]) || STYLE_PRESETS[DEFAULT_PRESET_ID];
}

// ─── Density & motion ──────────────────────────────────────────────
//
// Two dimensions orthogonal to the named preset. `preset` answers "which
// look"; these answer "how loud". Splitting them is what lets "make the
// whole video more understated" be one instruction instead of hand-tuning
// every scene: they resolve into multipliers on levers that already reach
// all 28 templates, so no template file knows they exist.
//
// Both default to `normal`, whose multipliers are all 1 — a config that sets
// neither renders byte-identically to the pre-density output. Same invariant
// the presets hold.

export type StyleDensity = "airy" | "normal" | "packed";
export type StyleMotion = "calm" | "normal" | "punchy";

export interface DensityScale {
  id: StyleDensity;
  /** Agent-facing use-when — surfaced in the registry index. */
  useWhen: string;
  /** Multiplies the headline font size (via the preset's `type.sizeScale`). */
  typeScale: number;
  /** Multiplies the frame's safe-zone insets — bigger insets, more air. */
  safeZoneScale: number;
}

export interface MotionScale {
  id: StyleMotion;
  /** Agent-facing use-when — surfaced in the registry index. */
  useWhen: string;
  /** Multiplies every text-archetype entrance/exit phase duration. */
  phaseScale: number;
}

export const DENSITY_SCALES: Record<StyleDensity, DensityScale> = {
  airy: {
    id: "airy",
    useWhen:
      "Smaller headlines held further off the frame edges. Premium, considered, editorial — when the copy should have room to breathe.",
    typeScale: 0.92,
    safeZoneScale: 1.3,
  },
  normal: {
    id: "normal",
    useWhen: "The default. No change to type size or frame padding.",
    typeScale: 1,
    safeZoneScale: 1,
  },
  packed: {
    id: "packed",
    useWhen:
      "Bigger headlines pushed closer to the edges. Dense, urgent, information-heavy — when the frame should feel full.",
    typeScale: 1.08,
    safeZoneScale: 0.8,
  },
};

export const MOTION_SCALES: Record<StyleMotion, MotionScale> = {
  calm: {
    id: "calm",
    useWhen:
      "Slower entrances and exits — text eases in rather than arriving. Founder stories, sober data, anything reflective.",
    phaseScale: 1.4,
  },
  normal: {
    id: "normal",
    useWhen: "The default. Archetype timings as authored.",
    phaseScale: 1,
  },
  punchy: {
    id: "punchy",
    useWhen:
      "Snappier entrances and exits — text lands fast and clears fast. Hype, launches, hot takes.",
    phaseScale: 0.7,
  },
};

export const DEFAULT_DENSITY_ID: StyleDensity = "normal";
export const DEFAULT_MOTION_ID: StyleMotion = "normal";
export const DENSITY_IDS = Object.keys(DENSITY_SCALES) as StyleDensity[];
export const MOTION_IDS = Object.keys(MOTION_SCALES) as StyleMotion[];

/** Unknown/unset ids fall back to `normal`, same as `resolvePreset`. */
export function resolveDensity(id: string | undefined): DensityScale {
  return (id && DENSITY_SCALES[id as StyleDensity]) || DENSITY_SCALES[DEFAULT_DENSITY_ID];
}

/** Unknown/unset ids fall back to `normal`, same as `resolvePreset`. */
export function resolveMotion(id: string | undefined): MotionScale {
  return (id && MOTION_SCALES[id as StyleMotion]) || MOTION_SCALES[DEFAULT_MOTION_ID];
}

export interface ResolvedTokens {
  /** Primary brand colour. */
  primary: string;
  /** Secondary brand colour. */
  secondary: string;
  /** Visual background, deliberately separate from semantic foreground colours. */
  background: { type: "solid"; color: string } | { type: "gradient"; colors: [string, string] };
  /** Deepest background surface. */
  surface: string;
  /** Elevated card / panel surface. */
  surfaceElevated: string;
  /** Primary foreground colour. */
  foreground: string;
  /** Muted text color. */
  muted: string;
  /** Full font fallback stack (see fontStack). */
  font: string;
  /** Script accent font family. */
  scriptFont: string;
  logoUrl?: string;
  name?: string;
  /**
   * Resolved style preset — frame-level look. Always set.
   *
   * `preset.type` is the composed treatment, not the raw preset literal:
   * `sizeScale` already carries the density multiplier and `phaseScale`
   * carries the motion one, which is how both dials reach text rendering
   * without a template edit.
   */
  preset: StylePreset;
  /** Resolved density dial. Always set; `normal` when unset. */
  density: DensityScale;
  /** Resolved motion dial. Always set; `normal` when unset. */
  motion: MotionScale;
}

export function resolveTokens(
  style: TemplateStyle,
): ResolvedTokens {

  // Compose the two dials into the preset's type treatment here, once, so
  // folding them in at the resolver is what makes them bite everywhere with
  // no template edits. At `normal`/`normal` both multipliers are 1 and the
  // object is value-identical to the preset literal.
  const preset = resolvePreset(style.preset);
  const density = resolveDensity(style.density);
  const motion = resolveMotion(style.motion);
  const composedPreset: StylePreset = {
    ...preset,
    type: {
      ...preset.type,
      sizeScale: preset.type.sizeScale * density.typeScale,
      phaseScale: motion.phaseScale,
    },
  };

  return {
    primary: "#FFFFFF",
    secondary: "#FFFFFF",
    background: { type: "solid", color: "#000000" },
    surface: "#000000",
    surfaceElevated: "#171717",
    foreground: "#FFFFFF",
    muted: "#B7B7BC",
    font: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Roboto, Arial, sans-serif',
    scriptFont: "Georgia",
    preset: composedPreset,
    density,
    motion,
  };
}

// ─── Color math the resolver depends on ────────────────────────────
// (Lives beside the resolver because theme owns both token resolution and
// color derivation.)

/**
 * Shift a hex color's hue by a number of degrees.
 * Used by internal template treatments that need a related hue.
 */
export function shiftHue(hex: string, degrees: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  h = (h + degrees / 360 + 1) % 1;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r2: number, g2: number, b2: number;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/** Lighten a hex color by a 0-1 factor. */
/** Scale a hex color toward black by `factor` (0 = unchanged, 1 = black). */
export function darken(hex: string, factor: number): string {
  if (!hex.startsWith("#") || (hex.length !== 4 && hex.length !== 7)) {
    return hex;
  }
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const ch = (i: number) =>
    Math.max(0, Math.round(parseInt(full.slice(i, i + 2), 16) * (1 - factor)))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

export function lighten(hex: string, factor: number): string {
  if (!hex.startsWith("#") || (hex.length !== 4 && hex.length !== 7)) {
    return hex;
  }
  const full = hex.length === 4
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(full.slice(1, 3), 16);
  const g = parseInt(full.slice(3, 5), 16);
  const b = parseInt(full.slice(5, 7), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * factor));
  const lg = Math.min(255, Math.round(g + (255 - g) * factor));
  const lb = Math.min(255, Math.round(b + (255 - b) * factor));
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/**
 * Per-glyph halo for type sitting directly on photo or video.
 *
 * A frame-wide scrim can only trade picture for contrast, and it loses that
 * trade against blown-out highlights: holding white type at 4.5:1 over a
 * near-white region needs ~0.8 alpha of black across the whole plate. A
 * two-layer shadow buys the same local separation for free — a tight 8px pass
 * for edge definition against fine texture, a wide 16px pass for the soft
 * falloff that separates the word from whatever sits behind it. Export-safe:
 * `text-shadow` survives SVG capture, `filter`/`backdrop-filter` do not.
 */
export const MEDIA_TEXT_SHADOW =
  "0 2px 8px rgba(0,0,0,0.55), 0 6px 16px rgba(0,0,0,0.35)";
