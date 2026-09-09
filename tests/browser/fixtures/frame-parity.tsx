import React from "react";
import { createRoot } from "react-dom/client";
import { createVideo } from "../../../src/server/compose-video";
import { type Video } from "../../../src/protocol/types";
import { VideoFrame } from "../../../src/player/video-frame";
import { VideoPlayer } from "../../../src/player/video-player";
import { TEST_VIDEO_STYLE as style } from "../../helpers/video-style";
import firstVideo from "./media-transition/waterfall.mp4?url";
import firstPoster from "./media-transition/waterfall.jpg?url";
import secondVideo from "./media-transition/tram.mp4?url";

const widths = [180, 380, 600, 960];
const scenes = {
  chapterTitle: { title: "A new perspective" },
  cinemaMedia: { mediaUrl: firstVideo, mediaPoster: firstPoster, mediaType: "video" },
} as const;

const decoderConfig: Video = {
  schemaVersion: "0.2", orientation: "portrait", style,
  scenes: [
    { id: "decoder-first", templateId: "cinemaMedia", variables: { mediaUrl: firstVideo, mediaType: "video" }, timing: { fixedDuration: 5 } },
    { id: "decoder-second", templateId: "cinemaMedia", variables: { mediaUrl: secondVideo, mediaType: "video" }, timing: { fixedDuration: 5 } },
  ],
};

function configFor(templateId: keyof typeof scenes): Video {
  return {
    schemaVersion: "0.2", orientation: "portrait", style,
    scenes: [{ id: templateId, templateId, variables: scenes[templateId], timing: { fixedDuration: 4 } }],
  };
}

function streamFor(templateId: keyof typeof scenes) {
  return createVideo({ input: "Frame parity fixture", orientation: "portrait" }, {
    generate: async function* () {
      yield { type: "scene.add" as const, scene: configFor(templateId).scenes[0] };
      yield { type: "plan.complete" as const };
    },
  }).stream;
}

function Fixture() {
  return <main>
    {(Object.keys(scenes) as Array<keyof typeof scenes>).flatMap(templateId => widths.flatMap(width => {
      const height = Math.round(width * 16 / 9);
      return [
        <section key={`${templateId}-frame-${width}`} data-case={`${templateId}-frame-${width}`} data-surface="frame" style={{ width, height }}>
          <VideoFrame config={configFor(templateId)} time={2} width={width} height={height} />
        </section>,
        <section key={`${templateId}-player-${width}`} data-case={`${templateId}-player-${width}`} data-surface="player" style={{ width, height }}>
          <VideoPlayer stream={streamFor(templateId)} width={width} autoPlay={false} />
        </section>,
        <section key={`${templateId}-saved-${width}`} data-case={`${templateId}-saved-${width}`} data-surface="saved" style={{ width, height }}>
          <VideoPlayer video={configFor(templateId)} width={width} autoPlay={false} />
        </section>,
      ];
    }))}
    <section data-case="mobile-video-transition" style={{ width: 270, height: 480 }}>
      <VideoFrame config={decoderConfig} time={4.85} width={270} height={480} />
    </section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
