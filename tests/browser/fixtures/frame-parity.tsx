import React from "react";
import { createRoot } from "react-dom/client";
import { createVideo, type Video } from "../../../src/internal";
import { VideoFrame } from "../../../src/player/video-frame";
import { VideoPlayer } from "../../../src/player/video-player";
import { BUILTIN_PLAYER_KIT } from "../../../src/visual-system/catalog/builtin-player";
import { createRenderTemplateRegistry, defineTemplate } from "../../../src/visual-system/catalog/internal";
import { SceneBackground } from "../../../src/visual-system/scene-templates/scene-background";
import { TEST_VIDEO_STYLE as style } from "../../semantic-brand-fixture";
import firstVideo from "./media-transition/waterfall.mp4?url";
import secondVideo from "./media-transition/tram.mp4?url";

const widths = [180, 380, 600, 960];
const scenes = {
  keyFigure: {value: "128%", label: "Faster deployment cycles"},
  editorialTimeline: {events: [{label: "Connect"}, {label: "Review"}, {label: "Publish"}]},
  focusCards: {items: ["Instant updates", "Grounded messaging", "Ready motion"]},
} as const;
const transitionScenes: Video["scenes"] = [
 {id:"opening", templateId:"mobileMessage", variables:{app:"Messages",message:"The opening remains readable."},timing:{fixedDuration:5}},
 {id:"proof",templateId:"keyFigure",variables:{value:"128%",label:"Faster deployment cycles"},timing:{fixedDuration:6}},
];
const transientSemanticScenes = {
 keyFigure: {value:"128%",label:"Faster deployment cycles"},
 focusCards: {items:["Grounded explanation", "Source preserved"]},
 editorialTimeline: {events:[{label:"First"},{label:"Second"},{label:"Final event"}]},
} as const;

function transitionConfig(orientation: Video["orientation"]): Video {
  return {
    schemaVersion: "0.2",
    orientation,
    style: { ...style, defaultTransition: "crossfade" },
    scenes: transitionScenes,
  };
}

function transientSemanticConfig(
  orientation: Video["orientation"],
  templateId: keyof typeof transientSemanticScenes,
): Video {
  return {
    schemaVersion: "0.2",
    orientation,
    style: { ...style, defaultTransition: "crossfade" },
    scenes: [
      transitionScenes[0],
      {
        id: `semantic-${templateId}`,
        templateId,
        variables: { ...transientSemanticScenes[templateId], mediaUrl: `${templateId}.jpg` },
        timing: { fixedDuration: 6 },
      },
    ],
  };
}

const focusKit = createRenderTemplateRegistry({
  templates: ["focus-opening", "focus-incoming"].map((id) => defineTemplate({
    id,
    usesGlobalTransition: true,
    transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
    schema: { type: "object", properties: {}, additionalProperties: false },
    component: ({ motionProgress }) => <button data-motion-progress={motionProgress?.toFixed(3)}>{id}</button>,
  })),
});

const focusConfig: Video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  style: { ...style, defaultTransition: "crossfade" },
  scenes: [
    { id: "focus-opening-scene", templateId: "focus-opening", variables: { mediaUrl: "focus-opening.jpg" }, timing: { fixedDuration: 5 } },
    { id: "focus-incoming-scene", templateId: "focus-incoming", variables: { mediaUrl: "focus-incoming.jpg" }, timing: { fixedDuration: 5 } },
  ],
};

const decoderKit = createRenderTemplateRegistry({
  templates: [defineTemplate({
    id: "decoder-probe",
    usesGlobalTransition: true,
    transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
    schema: {
      type: "object",
      properties: {
        mediaUrl: { type: "string" },
        mediaType: { type: "string", enum: ["video"] },
      },
      required: ["mediaUrl", "mediaType"],
      additionalProperties: false,
    },
    component: ({ variables, style, progress, width, height, isPlaying }) => <SceneBackground
      style={style}
      progress={progress}
      width={width}
      height={height}
      mediaUrl={String(variables.mediaUrl)}
      mediaType="video"
      backgroundEffect="static"
      isPlaying={isPlaying}
    />,
  })],
});

const decoderConfig: Video = {
  schemaVersion: "0.2",
  orientation: "portrait",
  style: { ...style, defaultTransition: "crossfade" },
  scenes: [
    { id: "decoder-first", templateId: "decoder-probe", variables: { mediaUrl: firstVideo, mediaType: "video" }, timing: { fixedDuration: 5 } },
    { id: "decoder-second", templateId: "decoder-probe", variables: { mediaUrl: secondVideo, mediaType: "video" }, timing: { fixedDuration: 5 } },
  ],
};

function configFor(templateId: keyof typeof scenes): Video {
  return {
    schemaVersion: "0.2",
    orientation: "portrait",
    style,
    scenes: [{ id: templateId, templateId, variables: scenes[templateId], timing: { fixedDuration: 4 } }],
  };
}

function streamFor(templateId: keyof typeof scenes) {
  return createVideo({
    input: "Frame parity fixture",
    orientation: "portrait",
  }, {
    generate: async function* () {
      yield {
        type: "scene.add" as const,
        scene: { id: templateId, templateId, variables: scenes[templateId], timing: { fixedDuration: 4 } },
      };
      yield { type: "plan.complete" as const };
    },
  }).stream;
}

function Fixture() {
  return <main>
    {(Object.keys(scenes) as Array<keyof typeof scenes>).flatMap((templateId) => widths.flatMap((width) => {
      const height = Math.round(width * 16 / 9);
      return ([
        <section key={`${templateId}-frame-${width}`} data-case={`${templateId}-frame-${width}`} data-surface="frame" style={{ width, height }}>
          <VideoFrame kit={BUILTIN_PLAYER_KIT} config={configFor(templateId)} time={2} width={width} height={height} />
        </section>,
        <section key={`${templateId}-player-${width}`} data-case={`${templateId}-player-${width}`} data-surface="player" style={{ width, height }}>
          <VideoPlayer stream={streamFor(templateId)} width={width} autoPlay={false} />
        </section>,
        <section key={`${templateId}-saved-${width}`} data-case={`${templateId}-saved-${width}`} data-surface="saved" style={{ width, height }}>
          <VideoPlayer video={configFor(templateId)} width={width} autoPlay={false} />
        </section>,
      ]);
    }))}
    {(["portrait", "landscape"] as const).flatMap((orientation) => {
      const dimensions = orientation === "portrait"
        ? { width: 270, height: 480 }
        : { width: 480, height: 270 };
      return ([4.7, 4.71, 4.85, 5] as const).map((time) => (
        <section
          key={`${orientation}-transition-${time}`}
          data-case={`${orientation}-transition-${time}`}
          data-surface="transition"
          style={dimensions}
        >
          <VideoFrame
            kit={BUILTIN_PLAYER_KIT}
            config={transitionConfig(orientation)}
            time={time}
            width={dimensions.width}
            height={dimensions.height}
          />
        </section>
      ));
    })}
    {(["portrait", "landscape"] as const).flatMap((orientation) => {
      const dimensions = orientation === "portrait"
        ? { width: 270, height: 480 }
        : { width: 480, height: 270 };
      return (Object.keys(transientSemanticScenes) as Array<keyof typeof transientSemanticScenes>).map((templateId) => (
        <section
          key={`${orientation}-semantic-${templateId}`}
          data-case={`${orientation}-semantic-${templateId}`}
          data-surface="transition-semantic"
          style={dimensions}
        >
          <VideoFrame
            kit={BUILTIN_PLAYER_KIT}
            config={transientSemanticConfig(orientation, templateId)}
            time={5.25}
            width={dimensions.width}
            height={dimensions.height}
          />
        </section>
      ));
    })}
    <section data-case="brand-baseline" style={{ width: 270, height: 480 }}>
      <VideoFrame
        kit={BUILTIN_PLAYER_KIT}
        config={{ schemaVersion: "0.2", orientation: "portrait", style, scenes: [] }}
        time={0}
        width={270}
        height={480}
      />
    </section>
    {([4.7, 4.85, 5] as const).map((time) => (
      <section key={`focus-transition-${time}`} data-case={`focus-transition-${time}`} style={{ width: 270, height: 480 }}>
        <VideoFrame kit={focusKit} config={focusConfig} time={time} width={270} height={480} />
      </section>
    ))}
    <section data-case="mobile-video-transition" style={{ width: 270, height: 480 }}>
      <VideoFrame kit={decoderKit} config={decoderConfig} time={4.85} width={270} height={480} />
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
