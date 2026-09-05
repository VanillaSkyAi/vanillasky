/** Canonical contracts for the eight cinematic templates. */
import type { TemplateJsonSchema } from "../catalog/types";

export const BUILTIN_TEMPLATE_SCHEMAS = {
  "cinemaMedia": {
    "type": "object",
    "properties": {
      "mediaKeyword": {
        "type": "string",
        "format": "stock-media-keyword",
        "minLength": 1,
        "maxLength": 80,
        "description": "2\u20138 word literal subject/action search intent, max80characters. Host resolves URLs.",
        "examples": [
          "Ocean waves breaking on a rocky shore"
        ]
      },
      "mediaUrl": {
        "type": "string",
        "format": "uri",
        "description": "Host-only approved photo or video URL.",
        "default": ""
      },
      "mediaType": {
        "type": "string",
        "enum": [
          "photo",
          "video"
        ],
        "default": "video",
        "description": "Host-resolved asset kind."
      },
      "mediaPoster": {
        "type": "string",
        "format": "uri",
        "description": "Host-only approved poster URL for video decoding.",
        "default": ""
      },
      "mediaSource": {
        "type": "string",
        "enum": [
          "generate",
          "stock"
        ],
        "description": "Generate distinctive illustrative shots; use approved stock for familiar observable subjects."
      },
      "fallbackText": {
        "type": "string",
        "maxLength": 65,
        "description": "Optional grounded concise chapter text if this shot cannot be resolved; not visible over footage."
      }
    },
    "required": [],
    "additionalProperties": false,
    "x-vanillasky": {
      "allowsStockMedia": true,
      "requiredAnyOf": [
        [
          "mediaKeyword",
          "mediaUrl"
        ]
      ]
    }
  },
  "chapterTitle": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "maxLength": 65,
        "description": "Short title. Line breaks optional.",
        "default": "A different perspective"
      }
    },
    "required": [
      "title"
    ],
    "additionalProperties": false
  },
  "focusCards": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "minItems": 2,
        "maxItems": 4,
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 55
        },
        "default": [
          "Listen closely",
          "Notice the pattern",
          "Make room for change"
        ],
        "description": "2\u20134 parallel phrases, about2\u20136words each; no heading or numbering."
      }
    },
    "required": [
      "items"
    ],
    "additionalProperties": false
  },
  "editorialTimeline": {
    "type": "object",
    "properties": {
      "events": {
        "type": "array",
        "minItems": 3,
        "maxItems": 5,
        "items": {
          "type": "object",
          "properties": {
            "label": {
              "type": "string",
              "minLength": 1,
              "maxLength": 45
            }
          },
          "required": [
            "label"
          ],
          "additionalProperties": false
        },
        "default": [
          {
            "label": "Observe"
          },
          {
            "label": "Understand"
          },
          {
            "label": "Act"
          }
        ],
        "description": "3\u20135 ordered events or actions, each with one shortlabel; no dates."
      }
    },
    "required": [
      "events"
    ],
    "additionalProperties": false
  },
  "mobileMessage": {
    "type": "object",
    "properties": {
      "mediaKeyword": {
        "type": "string",
        "format": "stock-media-keyword",
        "minLength": 1,
        "maxLength": 80,
        "description": "2\u20138 word literal subject/action search intent, max80characters. Host resolves URLs.",
        "examples": [
          "Ocean waves breaking on a rocky shore"
        ]
      },
      "mediaUrl": {
        "type": "string",
        "format": "uri",
        "description": "Host-only approved photo or video URL.",
        "default": ""
      },
      "mediaType": {
        "type": "string",
        "enum": [
          "photo",
          "video"
        ],
        "default": "video",
        "description": "Host-resolved asset kind."
      },
      "mediaPoster": {
        "type": "string",
        "format": "uri",
        "description": "Host-only approved poster URL for video decoding.",
        "default": ""
      },
      "message": {
        "type": "string",
        "maxLength": 120,
        "default": "Can we talk?",
        "description": "Exact supplied or explicitly illustrative message, preferably6\u201316words."
      },
      "app": {
        "type": "string",
        "maxLength": 24,
        "default": "Messages",
        "description": "Optional app label; Messages is the visualdefault."
      },
      "mediaSource": {
        "type": "string",
        "enum": [
          "generate",
          "stock"
        ],
        "description": "Generate distinctive illustrative shots; use approved stock for familiar observable subjects."
      }
    },
    "required": [
      "message"
    ],
    "additionalProperties": false,
    "x-vanillasky": {
      "allowsStockMedia": true,
      "requiredAnyOf": [
        [
          "mediaKeyword",
          "mediaUrl"
        ]
      ]
    }
  },
  "comparison": {
    "type": "object",
    "properties": {
      "leftLabel": {
        "type": "string",
        "maxLength": 20,
        "description": "Optional shortidentifier for the first alternative."
      },
      "rightLabel": {
        "type": "string",
        "maxLength": 20,
        "description": "Optional shortidentifier for the second alternative."
      },
      "leftText": {
        "type": "string",
        "minLength": 1,
        "maxLength": 60,
        "default": "More distractions",
        "description": "First real alternative in one shortphrase."
      },
      "rightText": {
        "type": "string",
        "minLength": 1,
        "maxLength": 60,
        "default": "More room to think",
        "description": "Second real alternative, parallel to the first."
      }
    },
    "required": [
      "leftText",
      "rightText"
    ],
    "additionalProperties": false
  },
  "quote": {
    "type": "object",
    "properties": {
      "quote": {
        "type": "string",
        "minLength": 1,
        "maxLength": 140,
        "format": "grounded-quote",
        "examples": [
          "Look closely. There is always more to see."
        ],
        "description": "Exact supplied quotation; do not paraphrase or invent."
      },
      "attribution": {
        "type": "string",
        "minLength": 1,
        "maxLength": 60,
        "examples": [
          "Illustrative example"
        ],
        "description": "Grounded attribution belonging to these exact quotedwords."
      }
    },
    "required": [
      "quote",
      "attribution"
    ],
    "additionalProperties": false
  },
  "keyFigure": {
    "type": "object",
    "properties": {
      "value": {
        "type": "string",
        "minLength": 1,
        "maxLength": 14,
        "format": "grounded-stat",
        "examples": [
          "42%"
        ],
        "description": "One supplied supported quantity, preserving its unit."
      },
      "label": {
        "type": "string",
        "minLength": 1,
        "maxLength": 50,
        "examples": [
          "Illustrative example"
        ],
        "description": "Exactly one shortlabel identifying the quantity and its context."
      }
    },
    "required": [
      "value",
      "label"
    ],
    "additionalProperties": false,
    "x-vanillasky": {
      "requiresStat": true
    }
  }
} as const satisfies Record<string, TemplateJsonSchema>;
