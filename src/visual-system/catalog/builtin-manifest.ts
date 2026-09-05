import { BUILTIN_TEMPLATE_SCHEMAS } from "../scene-templates/schemas.js";
import type { SceneTemplateMetadata, TemplateTimingMetadata } from "./catalog-types.js";

export type BuiltinTemplateId = keyof typeof BUILTIN_TEMPLATE_SCHEMAS;
export interface BuiltinTemplateManifestEntry extends SceneTemplateMetadata { id: BuiltinTemplateId; timing: TemplateTimingMetadata; }

export const BUILTIN_TEMPLATE_MANIFEST: readonly BuiltinTemplateManifestEntry[] = [
{
  "label": "Full-bleed",
  "description": "Immersive photo or video without a headline.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "cinemaMedia",
  "family": "Media & motion",
  "jobs": [
    "setup",
    "atmosphere",
    "payoff"
  ],
  "register": "motion-led",
  "useWhen": "Show a relevant place, activity or subject. The asset is resolved separately from a shot description. ",
  "avoidWhen": "No relevant asset can be resolved or the scene needs structured explanation.",
  "minDuration": 3,
  "preferredDuration": 6,
  "timing": {
    "contentFields": [],
    "contentUnit": "words",
    "revealSeconds": 0,
    "holdSeconds": 3,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.cinemaMedia
},
{
  "label": "Chapter",
  "description": "Centered white typography fades in, holds, and fades out on black.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "chapterTitle",
  "family": "Explainers",
  "jobs": [
    "setup",
    "payoff"
  ],
  "register": "motion-led",
  "useWhen": "An opening, new chapter or deliberate short takeaway needs its own visual beat. ",
  "avoidWhen": "A headline would merely repeat subtitles over an ordinary footage scene.",
  "minDuration": 3,
  "preferredDuration": 4,
  "timing": {
    "contentFields": [
      "title"
    ],
    "contentUnit": "words",
    "revealSeconds": 0.8,
    "holdSeconds": 1.5,
    "exitSeconds": 0.8
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.chapterTitle
},
{
  "label": "Focus cards",
  "description": "Two to four short phrases fade in sequentially on black; no boxes or heading.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "focusCards",
  "family": "Explainers",
  "jobs": [
    "setup",
    "proof"
  ],
  "register": "card-led",
  "useWhen": "Two to four short parallel points support an explanation. ",
  "avoidWhen": "The points require an order, long paragraphs, numerical data or additional images to make sense.",
  "minDuration": 4,
  "preferredDuration": 5,
  "timing": {
    "contentFields": [
      "items"
    ],
    "contentUnit": "items",
    "revealSeconds": 2.4,
    "holdSeconds": 1.8,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.focusCards
},
{
  "label": "Timeline",
  "description": "Three to five events on a fine continuous line on black; without dates.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "editorialTimeline",
  "family": "Explainers",
  "jobs": [
    "setup",
    "proof"
  ],
  "register": "card-led",
  "useWhen": "Events unfold in an order, or actions form a process. No dates or heading. ",
  "avoidWhen": "The points are unordered or the story needs branching relationships.",
  "minDuration": 5,
  "preferredDuration": 6,
  "timing": {
    "contentFields": [
      "events"
    ],
    "contentUnit": "items",
    "revealSeconds": 3.2,
    "holdSeconds": 1.8,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.editorialTimeline
},
{
  "label": "Reach out",
  "description": "A frosted glass message over resolved media, without sender or timestamp.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "mobileMessage",
  "family": "Social & messaging",
  "jobs": [
    "setup"
  ],
  "register": "card-led",
  "useWhen": "A person or organization reaches out with a short message, alert or invitation. Message must be supplied or explicitly illustrative.",
  "avoidWhen": "The scene is a generic fact, a long exchange, or a message that would fabricate evidence.",
  "minDuration": 4,
  "preferredDuration": 6,
  "timing": {
    "contentFields": [
      "message",
      "app"
    ],
    "contentUnit": "words",
    "revealSeconds": 1,
    "holdSeconds": 2.2,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.mobileMessage
},
{
  "label": "Comparison",
  "description": "Two short statements with equal weight on black, side by side or stacked in portrait.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "comparison",
  "family": "Explainers",
  "jobs": [
    "proof"
  ],
  "register": "motion-led",
  "useWhen": "Explain a before/after change or two alternatives with short parallel statements. ",
  "avoidWhen": "There are more than two alternatives or a numerical chart is needed.",
  "minDuration": 4,
  "preferredDuration": 6,
  "timing": {
    "contentFields": [
      "leftText",
      "rightText",
      "leftLabel",
      "rightLabel"
    ],
    "contentUnit": "words",
    "revealSeconds": 1.2,
    "holdSeconds": 2.5,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.comparison
},
{
  "label": "Quote",
  "description": "A short exact quotation with a legible attribution on black.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "quote",
  "family": "Explainers",
  "jobs": [
    "proof"
  ],
  "register": "motion-led",
  "useWhen": "A supplied quotation deserves its own moment. Use exact source words and attribution only.",
  "avoidWhen": "No exact quotation or reliable attribution is supplied; never invent testimony.",
  "minDuration": 5,
  "preferredDuration": 7,
  "timing": {
    "contentFields": [
      "quote",
      "attribution"
    ],
    "contentUnit": "words",
    "revealSeconds": 1.2,
    "holdSeconds": 3,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.quote
},
{
  "label": "Key figure",
  "description": "One supplied figure with one short label on black.",
  "usesGlobalTextEffect": false,
  "usesGlobalTransition": false,
  "usesGlobalBackgroundEffect": false,
  "textCanvas": "tight",
  "id": "keyFigure",
  "family": "Explainers",
  "jobs": [
    "proof"
  ],
  "register": "motion-led",
  "useWhen": "One verified quantity or supplied target anchors the explanation. Value, unit and context must match supplied evidence.",
  "avoidWhen": "No reliable figure is supplied or multiple values require a chart.",
  "minDuration": 4,
  "preferredDuration": 5,
  "timing": {
    "contentFields": [
      "value",
      "label"
    ],
    "contentUnit": "words",
    "revealSeconds": 0.8,
    "holdSeconds": 2.5,
    "exitSeconds": 0
  }
,
  schema: BUILTIN_TEMPLATE_SCHEMAS.keyFigure
},
];
