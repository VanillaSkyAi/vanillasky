# Architecture

VanillaSky turns context into a visual response. Your application and its AI
decide what matters; VanillaSky turns that decision into a grounded, validated,
embedded video that starts playing while it is still being composed.

## The shortest mental model

```text
user message + conversation context
  → app-owned model
  → trusted scene plan
  → validation and streaming protocol
  → synchronized voice-and-video response
```

VanillaSky does not choose your model, retrieve private application context, or
own your product policy. It supplies the complete default chat, video-planning
prompts, trusted visual vocabulary, conversation and narration lifecycle,
validation, streaming, and player.

## Start here

Six files, in this order, are enough to hold the whole system in your head.
About 2,600 lines total, and two of them are most of it.

1. `src/protocol/types.ts` — the `Video` shape. Everything else exists to
   produce, validate, transport, or play this one object.
2. `src/server/prompts/system-prompt.ts` — what the model is actually asked
   for. The product's behavior is mostly here, not in the code around it.
3. `src/server/create-video-chat-handler.ts` — the one endpoint. Where an
   application's providers and policy attach.
4. `src/protocol/events.ts` — the wire contract between server and browser.
5. `src/video-chat/use-video-chat.ts` — the client lifecycle, as a reducer.
   Read `reducer` first and the hook second.
6. `src/visual-system/scene-templates/quote.tsx` — one complete scene, small
   enough to read in a sitting. Every other template has this shape.

To watch it run instead, `npm run dev:chat` renders the real `VideoChat` from
source against fixtures, with no provider credentials and no spend.

## Repository map

| Location | Purpose |
| --- | --- |
| `src/server/create-video-chat-handler.ts` | Complete chat endpoint and capability boundary |
| `src/server/create-video-handler.ts` | Internal composition and provider adapter boundary |
| `src/server/prompts/` | System and user prompts sent to the app-owned model |
| `src/server/model/` | Converts provider text deltas into typed video plan parts |
| `src/protocol/` | Shared request, event, validation, checksum, and SSE contract |
| `src/player/` | Internal stream client, timeline, and React player |
| `src/video-chat/` | Default `VideoChat` interface and headless conversation/session engine |
| `src/visual-system/catalog/` | Template metadata, schemas, loading, and planner catalog |
| `src/visual-system/scene-templates/` | Complete scenes the model may select |
| `src/visual-system/backgrounds/` | Standalone background renderers |
| `src/visual-system/motion/` | Animation functions and timing behavior |
| `src/visual-system/theme/` | Color and design tokens |
| `src/visual-system/typography/` | Text fitting, formatting, and kinetic type lifecycles |
| `src/cli/` | `vanillasky init`, `doctor`, and `providers add`, plus `vanillasky templates create`, `add`, `sync`, `check`, `list`, and `describe` |
| `registry/items/` | Generated distributable copies installed into customer projects |
| `src/index.ts`, `src/server.ts`, `src/react.ts`, `src/templates.ts`, `src/template-catalog.ts`, `src/test.ts`, `styles/video-chat.css` | The six small code entry points and one scoped stylesheet |

The source of truth for built-in visuals is `src/visual-system`. The JSON files
in `registry/items` are distribution artifacts, kept flat so the CLI can address
every installable item by a stable name. Their `meta.vanillasky.layer` field is
`template` for a complete scene the model may select, or `lib` for shared
support code a template imports. Run `npm run registry:sync` after changing
canonical visual source.

Customer applications do not edit those internal locations. Their source of
truth is one file per visual under `vanillasky/templates/`; `vanillasky templates sync`
derives a browser registry in `vanillasky/index.ts` and a React-free
prompt/validation registry in `vanillasky/server.ts`.

## Request flow

1. `VideoChat` uses `useVideoChat` to send the user's message. A clicked
   suggestion can start its prewritten hook and existing media immediately.
2. For a typed prompt, the model emits a short hook first and then continues
   planning scenes in the same response stream. Its stock-search keyword is
   resolved separately while the hook is spoken.
3. `createVideoChatHandler(...)` owns chat actions, suggestions, narration,
   capability discovery, and generated-video budgets. The application supplies
   provider callbacks and policy.
4. Video answers flow into the internal composition pipeline, which calls the
   application's `streamText` adapter. This is where Anthropic, OpenAI, or
   another text model is connected.
5. The system prompt combines the opening and composition rules with the trusted template
   catalog, including generated metadata for customer-owned templates. The user
   prompt serializes the prompt, completed conversation, instructions,
   style, and approved media.
6. The model streams one host-consumed opening object followed by NDJSON plan
   parts. The server emits the opening event, then parses and validates complete
   scenes before emitting them.
7. The browser reduces those events into a deterministic `Video`. The opening
   loops or holds until its voice ends and the first playable scene is ready;
   the planned playback and narration then take over in one cut.

`VideoPlayer` also replays completed chat videos parsed at the storage boundary.

## Where to change common behavior

- Model connection: `src/server/create-video-handler.ts`
- Base planning rules: `src/server/prompts/system-prompt.ts`
- Per-request context formatting: `src/server/prompts/user-prompt.ts`
- Template-specific prompt catalog: `src/visual-system/catalog/prompt.ts`
- Wire contract: `src/protocol/types.ts` and `src/protocol/events.ts`
- Scene rendering: `src/visual-system/scene-templates/`
- Background effects: `src/visual-system/backgrounds/` and
  `src/visual-system/scene-templates/background-effect.ts`
- Text effects: `src/visual-system/scene-templates/text-archetypes.ts`
- Gradients and design tokens: `src/visual-system/theme/`

## Public vocabulary

Use `VideoChat`, `useVideoChat`, `createVideoChatHandler`, `Video`, and `VideoPlayer` for the product API. Use “video response” when
describing the lifecycle or output category. Use “motion” only for animation
behavior inside the visual system.
