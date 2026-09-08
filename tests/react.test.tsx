import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import type { Video } from "../src/protocol/types";
import { VideoFrame } from "../src/player/video-frame";
import { preloadBuiltinTemplate } from "../src/visual-system/catalog/builtin-player";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

beforeAll(async () => { await preloadBuiltinTemplate("cinemaMedia"); await preloadBuiltinTemplate("chapterTitle"); });
describe("VideoFrame layout", () => {
  it("renders gaps explicitly and never transitions overlapping ranges", async () => {
    const base: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [],
    };
    const gap = renderToStaticMarkup(createElement(VideoFrame, {
      config: {
        ...base,
        scenes: [
          { id: "first", templateId: "cinemaMedia", variables: {}, timing: { startTime: 0, endTime: 5 } },
          { id: "second", templateId: "cinemaMedia", variables: {}, timing: { startTime: 10, endTime: 15 } },
        ],
      },
      time: 7,
      width: 1080,
      height: 1920,
    }));
    expect(gap).toContain('data-video-frame="gap"');
    expect(gap).not.toContain('data-scene-id="first"');

    const overlap = renderToStaticMarkup(createElement(VideoFrame, {
      config: {
        ...base,
        scenes: [
          { id: "first", templateId: "cinemaMedia", variables: {}, timing: { startTime: 0, endTime: 6 } },
          { id: "second", templateId: "cinemaMedia", variables: {}, timing: { startTime: 5, endTime: 10 } },
        ],
      },
      time: 6.1,
      width: 1080,
      height: 1920,
    }));
    expect(overlap).not.toContain('data-scene-layer="incoming"');
    expect(overlap).toContain('data-scene-id="second"');
  });

  it("treats only ULP-scale timeline drift as contiguous", async () => {
    const configFor = (secondStart: number): Video => ({
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "first", templateId: "cinemaMedia", variables: { mediaUrl: "first.jpg" }, timing: { startTime: 0, endTime: 0.1 + 0.2 } },
        { id: "second", templateId: "cinemaMedia", variables: { mediaUrl: "second.jpg" }, timing: { startTime: secondStart, endTime: secondStart + 1 } },
      ],
    });
    const frameAt = (secondStart: number) => renderToStaticMarkup(createElement(VideoFrame, {
      config: configFor(secondStart), time: 0.2, width: 1080, height: 1920,
    }));

    expect(frameAt(0.3)).toContain('data-scene-layer="incoming"');
    expect(frameAt(0.3001)).not.toContain('data-scene-layer="incoming"');

    const largeStart = 1_000_000_000;
    const largeConfig: Video = {
      ...configFor(0.3),
      scenes: [
        { id: "first", templateId: "cinemaMedia", variables: { mediaUrl: "first.jpg" }, timing: { startTime: largeStart, endTime: largeStart + 0.1 + 0.2 } },
        { id: "second", templateId: "cinemaMedia", variables: { mediaUrl: "second.jpg" }, timing: { startTime: largeStart + 0.3, endTime: largeStart + 1.3 } },
      ],
    };
    expect(renderToStaticMarkup(createElement(VideoFrame, {
      config: largeConfig,
      time: largeStart + 0.2,
      width: 1080,
      height: 1920,
    }))).toContain('data-scene-layer="incoming"');

    const largeRealGap: Video = {
      ...largeConfig,
      scenes: [
        largeConfig.scenes[0],
        { ...largeConfig.scenes[1], timing: { startTime: largeStart + 0.301, endTime: largeStart + 1.301 } },
      ],
    };
    expect(renderToStaticMarkup(createElement(VideoFrame, {
      config: largeRealGap,
      time: largeStart + 0.301001,
      width: 1080,
      height: 1920,
    }))).not.toContain('data-scene-layer="incoming"');
  });

  it("keeps templates on the canonical canvas while scaling and centering the frame viewport", async () => {
    const config = (orientation: "portrait" | "landscape"): Video => ({
      schemaVersion: "0.2",
      orientation,
      style: TEST_VIDEO_STYLE,
      scenes: [{ id: "probe", templateId: "chapterTitle", variables: {}, timing: { fixedDuration: 5 } }],
    });

    for (const width of [180, 380, 600, 960]) {
      const height = Math.round(width * 16 / 9);
      const markup = renderToStaticMarkup(createElement(VideoFrame, {
        config: config("portrait"),
        time: 2.5,
        width,
        height,
        }));

      expect(markup).toContain(`width:${width}px`);
      expect(markup).toContain(`height:${height}px`);
      expect(markup).toContain('data-video-canvas="true"');
      expect(markup).toContain('width:1080px');
      expect(markup).toContain('height:1920px');
    }

    const letterboxed = renderToStaticMarkup(createElement(VideoFrame, {
      config: config("landscape"),
      time: 2.5,
      width: 600,
      height: 600,
    }));
    expect(letterboxed).toContain('width:1920px');
    expect(letterboxed).toContain('height:1080px');
    expect(letterboxed).toContain("transform:scale(0.3125)");
    expect(letterboxed).toContain("top:131.25px");
    expect(letterboxed).toContain("left:0");
  });

});
