[← Documentation home](../README.md) · [Previous: Customization](customization.md) · [Next: Motion and effects →](motion-and-effects.md)

# Custom templates

VanillaSky turns context into a visual response. Your AI determines what matters
from the available context; a template defines how one kind of grounded answer
appears in motion. Custom templates let your application own that visual
vocabulary without letting the model generate React, HTML, or CSS.

You edit one source file. VanillaSky derives the model-facing description,
server validation, browser registry, and TypeScript variable shape from it.

## The shortest path

The playback and server package does not install a TypeScript compiler. Install
the optional compiler only for source-owned templates and the template
ownership commands below:

```bash
npm install --save-dev tsx
```

List the effective catalog, including project-owned templates, before choosing
what to build or copy:

```bash
npx vanillasky templates list
```

Create an original template:

```bash
npx vanillasky templates create customer-health
npx vanillasky templates describe customer-health
```

Or copy a built-in when its behavior is already close:

```bash
npx vanillasky templates add bigNumber
```

Then edit the owned `.tsx` file, regenerate the two small registries, and check
the complete contract:

```bash
npx vanillasky templates sync
npx vanillasky templates check
```

For an original template, the source is
`vanillasky/templates/customer-health.tsx`. For the copied built-in, it is
`vanillasky/templates/bigNumber.tsx`. These are application source: commit them,
review them, and change them like any other React component.

`create` and `add` run `sync` once, so the generated entry points exist
immediately. Run `sync` again after every source edit. Run `check` before every
commit. `check` validates metadata, schema/default validity, named examples, deterministic
renders at progress boundaries in portrait and landscape, and browser/server
registry parity.

Preview either operation without applying the proposed file writes:

```bash
npx vanillasky templates add bigNumber --dry-run
npx vanillasky templates add bigNumber --diff
```

`--dry-run` lists every proposed file and `--diff` shows its content changes,
including the generated browser and server registries. The CLI does not apply
any proposed file write. When project templates already exist, these previews
execute that trusted application source to derive the complete registry plan.
Because trusted project source can have its own side effects, preview execution is
resource-bounded but is not a sandbox and does not guarantee that the entire
project remains byte-identical. Review project template code before running
preview commands.

An edited file is never replaced unless you explicitly pass `--overwrite`.

## One file is the contract

The file created by `vanillasky templates create` is a complete working template. Keep
these concerns together:

- `useWhen` and `avoidWhen` tell the AI when the visual is appropriate;
- `jobs` declares the narrative roles the template can fill, and decides
  whether it may close a video;
- `schema` defines allowed variables, validation, defaults, labels, and
  grounding formats;
- named `examples` provide complete deterministic preview values;
- `component` receives only validated variables and render context;
- raw `progress`, dimensions, and `safeZone` make semantic state deterministic
  and layout safe in portrait and landscape.

### Which templates may close a video

Every complete plan ends on exactly one closer, and the runtime only accepts a
closer whose `jobs` include `"ask"` or `"payoff"`. Marking any other template as
the closer rejects that scene with `Scene template <id> cannot be used as a
closer`, and the reserved closing time is given to a template that qualifies.

Declare `jobs: ["ask"]` on a call to action and `jobs: ["payoff"]` on a
celebration or resolution beat. A template that only presents evidence keeps
`jobs: ["proof"]` and is never asked to close.

The same rule reads the built-in catalog, so an application that wants to
constrain how its videos end can compute the eligible IDs instead of guessing:

```ts
import { builtinTemplates } from "@vanillaskyai/video/templates/catalog";

const closerTemplateIds = builtinTemplates
  .filter((template) => template.jobs.some((job) => job === "ask" || job === "payoff"))
  .map((template) => template.id);
```

Pacing uses the same signal: the planner reserves time for the closer whenever
the selected catalog contains a template with one of those two jobs.

Customer templates hard-cut by default. Opt into renderer-owned fades only
for scenes that use the standard media-background variables, and only after
both timing points are visually tested in portrait and landscape. Shared render
gradients and unchanged media do not crossfade:

```tsx
export default defineTemplate({
  // ...the normal one-file contract
  usesGlobalTransition: true,
  transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
  component: ({ progress, motionProgress = progress, ...props }) => {
    // Both clocks cover the complete declared 0→1 scene duration.
    // Use progress for facts/media/screens; motionProgress for presentation.
    return <CustomerScene {...props} dataProgress={progress} motionProgress={motionProgress} />;
  },
});
```

`entryReadyProgress` must show recognizable content in verification captures.
`holdProgress` is the audited complete-readable checkpoint before the
template's own exit begins. These values document and test the choreography;
they never advance or shorten the runtime clock. The SDK validates
`0 <= entryReadyProgress < holdProgress <= 1`.

When changed media crossfades, the incoming layer can be partly visible while
raw `progress` is exactly zero. A custom template that counts or types a value
from a synthetic placeholder must hide only that transient wrapper during the
crossfade. Compare the formatted display value to the formatted final value so
a sourced zero is not mistaken for a placeholder:

<!-- verify:transition-semantic-value:start -->
```tsx
import type { CSSProperties } from "react";

interface TransitionSemanticValueProps {
  displayValue: string;
  finalValue: string;
}

export function TransitionSemanticValue({
  displayValue,
  finalValue,
}: TransitionSemanticValueProps) {
  const isTransient = displayValue !== finalValue;

  return <span
    data-transition-semantic={isTransient ? "transient" : undefined}
    style={isTransient ? {
      visibility: "var(--vanillasky-transition-semantic-visibility, visible)" as CSSProperties["visibility"],
    } : undefined}
  >
    {displayValue}
  </span>;
}
```
<!-- verify:transition-semantic-value:end -->

The variable defaults to `visible`, so direct rendering and hard cuts are
unchanged. Do not apply it to grounded headings, CTA copy, supplied media, or
the whole scene: those must remain recognizable at `entryReadyProgress`.

The only SDK import an original one-file template needs is public:

```tsx
import { defineTemplate } from "@vanillaskyai/video/templates";
```

Start from the generated file or one of the packaged references:

| Content shape | Reference |
| --- | --- |
| One headline and supporting line | [Minimal text](../examples/custom-template/minimal-text.tsx) |
| One exact metric and its change | [Structured data](../examples/custom-template/structured-data.tsx) |

The [reference comparison](../examples/custom-template/README.md) explains when
to choose each. Copy a file into `vanillasky/templates/`, change its ID and
content contract, then run `sync` and `check`.

## Connect the generated registries

`sync` generates two files from the owned templates:

```text
vanillasky/
├── templates/
│   └── customer-health.tsx  # source you edit
├── index.ts                 # browser registry, generated
└── server.ts                # React-free model/validation registry, generated
```

The server registry connects custom template metadata to the prompt, model
selection, and validator. Import it in the route that connects your model:

```ts
// src/video-route.ts
import { generateText, streamText } from "ai";
import { createVideoChatHandler } from "@vanillaskyai/video/server";
import { videoModel } from "./video-model";
import { templates } from "../vanillasky/server";

export const handleVideoChat = createVideoChatHandler({
  templates,
  authorize: (request) => {
    if (process.env.VANILLASKY_LOCAL_DEMO !== "1") return false;
    const hostname = new URL(request.url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  },
  generateText: async ({ systemPrompt, userPrompt, signal }) => {
    const result = await generateText({
      model: videoModel,
      system: systemPrompt,
      prompt: userPrompt,
      abortSignal: signal,
    });
    return result.text;
  },
  streamText: ({ systemPrompt, userPrompt, signal }) => streamText({
    model: videoModel,
    system: systemPrompt,
    prompt: userPrompt,
    abortSignal: signal,
  }),
});
```

The local-only authorization above is intentionally narrow. Supply its marker
only from the development command; replace it with your application's session
check before deployment, as shown in
[Getting started](getting-started.md).

Use the browser registry for generation and playback:

```tsx
// src/video-chat.tsx
import { VideoChat } from "@vanillaskyai/video/react";
import "@vanillaskyai/video/video-chat.css";
import { templates } from "../vanillasky";

export function App() {
  return <VideoChat options={{ templates }} />;
}
```

Adjust relative paths for your application layout. Do not edit `index.ts` or
`server.ts`; `sync` replaces them. A matching ID replaces that built-in on both
sides, a new ID extends the catalog, and every other built-in remains available.

## Preview without an LLM

Template rendering is deterministic. Preview a saved `Video` directly in your
application so iteration uses your actual CSS, fonts, container, React version,
and browser. This path calls no model and needs no server route:

<!-- verify:custom-template-preview:start -->
```tsx
import type { Video } from "@vanillaskyai/video";
import { VideoPlayer } from "@vanillaskyai/video/react";
import { templates } from "../vanillasky";

const savedVideo: Video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  scenes: [{
    id: "customer-health-preview",
    templateId: "customer-health",
    variables: {
      title: "Customer health is improving",
      subtitle: "Activation increased after guided onboarding.",
    },
    timing: { fixedDuration: 5 },
  }],
  style: {},
};

export function TemplatePreview() {
  return <VideoPlayer video={savedVideo} templates={templates} autoPlay={false} />;
}
```
<!-- verify:custom-template-preview:end -->

Change the saved variables to each named example, inspect both orientations,
and play the scene to inspect its full progress range. This is also the
production replay path for a completed chat turn saved from `chat.turns`.

## Schema and grounding

Use JSON Schema as the single source of truth.

Property defaults are optional authoring and renderer smoke values; they do not
need to form a complete scene. Named examples must resolve to complete valid
scenes. They may inherit omitted values from property defaults. Never invent
media URLs or actions just to supply a default. Put complete scene examples in
the top-level `examples` array, and do not maintain parallel variable or default
maps.

Useful formats add grounding behavior:

- `grounded-stat` marks numeric statistical evidence for the planner; it does
  not compare the value against raw input at runtime;
- `grounded-quote` requires the quote to exist verbatim in the input;
- `uri` validates approved media URLs restored by the server;
- `stock-media-keyword` is only for hosts that resolve stock media before a
  scene is committed.

Templates whose core proof needs a real statistic can add
`"x-vanillasky": { "requiresStat": true }`. See the structured-data reference for a complete example.

For media-backed chat scenes, copy the built-in `media` template and keep its
`mediaKeyword`, `mediaUrl`, and `mediaType` contract. Configure `searchMedia` on
the chat handler so the server resolves semantic searches into approved assets.
The chat request does not accept a separate supplied-media input list.

The automatic `opening` uses the built-in `media` variables (`texts` and
`mediaType: "gradient"`). If you replace `media` while using automatic
openings, keep that variable contract.

## What belongs where

Your application owns the model, credentials, live context, custom template
source, authentication, media authorization, and saved `Video` values.
VanillaSky owns the generated planning instructions, streaming protocol,
runtime validation, built-in template catalog, and player. The model selects a
trusted template and fills its declared schema; it never writes executable UI
code.

For the exact request path and source locations, see
[Architecture](architecture.md). For media policies and provider callbacks,
see [Media and audio](media-and-audio.md).
