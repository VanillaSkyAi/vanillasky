import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Video } from "../src/internal";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

describe("React renderer", () => {
  it("lets same-black scenes start their native template motion at zero", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry } = await import("../src/visual-system/catalog/internal");
    const { getTemplate } = await import("../src/visual-system/scene-templates/registry");
    const opening = getTemplate("mobileMessage");
    const cardList = getTemplate("focusCards");
    expect(opening).toBeDefined();
    expect(cardList).toBeDefined();
    if (!opening || !cardList) return;
    const kit = createRenderTemplateRegistry({ templates: [opening, cardList] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        {
          id: "opening",
          templateId: "mobileMessage",
          variables: { message: "Opening" },
          timing: { fixedDuration: 5 },
        },
        {
          id: "cards",
          templateId: "focusCards",
          variables: {
            texts: "Daybreak access is gated",
            items: [
              "Blue: approved defensive work",
              "Red: authorized engagements",
              "Both need separate approval",
            ],
            itemEmojis: ["🔵", "🔴", "🔐"],
          },
          timing: { fixedDuration: 5 },
        },
      ],
    };

    const beforeBoundary = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 4.85,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(beforeBoundary).toContain('data-scene-layer="active"');
    expect(beforeBoundary).not.toContain('data-scene-layer="incoming"');

    const atBoundary = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 5,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(atBoundary).toContain('data-layer-scene-id="cards"');
    expect(atBoundary).toMatch(/data-template-item="cardList" style="[^"]*opacity:0(?:;|")/);
  });

  it("crossfades only when the effective scene background media changes", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const probe = defineTemplate({
      id: "background-probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: true },
      component: ({ progress, motionProgress }) => createElement("div", {
        "data-progress": progress.toFixed(3),
        "data-motion-progress": motionProgress?.toFixed(3),
      }),
    });
    const kit = createRenderTemplateRegistry({ templates: [probe] });
    const frameFor = (firstVariables: Record<string, unknown>, secondVariables: Record<string, unknown>) =>
      renderToStaticMarkup(createElement(VideoFrame, {
        config: {
          schemaVersion: "0.2",
          orientation: "portrait",
          style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
          scenes: [
            { id: "first", templateId: probe.id, variables: firstVariables, timing: { fixedDuration: 5 } },
            { id: "second", templateId: probe.id, variables: secondVariables, timing: { fixedDuration: 5 } },
          ],
        },
        time: 4.85,
        width: 1080,
        height: 1920,
        kit,
      }));

    for (const markup of [
      frameFor({}, {}),
      frameFor({ mediaUrl: "same.jpg" }, { mediaUrl: "same.jpg" }),
      frameFor(
        { mediaUrl: "ignored-a.jpg", mediaType: "gradient" },
        { mediaUrl: "ignored-b.jpg", mediaType: "gradient" },
      ),
    ]) {
      expect(markup).toContain('data-scene-layer="active"');
      expect(markup).not.toContain('data-scene-layer="incoming"');
    }

    const changedMedia = frameFor(
      { mediaUrl: "before.jpg", mediaType: "photo" },
      { mediaUrl: "after.jpg", mediaType: "photo" },
    );
    expect(changedMedia).toContain('data-scene-layer="outgoing"');
    expect(changedMedia).toContain('data-scene-layer="incoming"');
  });

  it("runs body transitions through their timeline and holds the terminal poster pose", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const probe = (id: string) => defineTemplate({
      id,
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress, motionProgress }) => createElement("div", {
        "data-probe": id,
        "data-progress": progress.toFixed(3),
        "data-motion-progress": motionProgress?.toFixed(3),
      }),
    });
    const kit = createRenderTemplateRegistry({ templates: [probe("opening"), probe("next")] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "opening-scene", templateId: "opening", variables: { mediaUrl: "opening.jpg" }, timing: { fixedDuration: 5 } },
        { id: "next-scene", templateId: "next", variables: { mediaUrl: "next.jpg" }, timing: { fixedDuration: 6 } },
      ],
    };
    const frame = (time: number) => renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time,
      width: 1080,
      height: 1920,
      kit,
    }));

    const transitionMidpoint = frame(4.85);
    expect(transitionMidpoint).toContain('data-scene-layer="outgoing"');
    expect(transitionMidpoint).toContain('data-layer-scene-id="opening-scene"');
    expect(transitionMidpoint).toContain('data-progress="0.970"');
    expect(transitionMidpoint).toContain('data-motion-progress="0.970"');
    expect(transitionMidpoint).toContain('data-scene-layer="incoming"');
    expect(transitionMidpoint).toContain('data-layer-scene-id="next-scene"');
    expect(transitionMidpoint).toContain('data-progress="0.000"');
    expect(transitionMidpoint).toContain('data-motion-progress="0.000"');
    expect(transitionMidpoint.match(/opacity:0\.5/g)).toHaveLength(2);

    const boundary = frame(5);
    expect(boundary).not.toContain('data-scene-layer="outgoing"');
    expect(boundary).toContain('data-scene-layer="active"');
    expect(boundary).toContain('data-layer-scene-id="next-scene"');
    expect(boundary).toContain('data-progress="0.000"');
    expect(boundary).toContain('data-motion-progress="0.000"');

    expect(frame(8)).toContain('data-progress="0.500" data-motion-progress="0.500"');
    expect(frame(10.1)).toContain('data-progress="0.850" data-motion-progress="0.700"');
    expect(frame(11)).toContain('data-progress="1.000" data-motion-progress="0.700"');
  });

  it("keeps a readable frame across explicit scene transitions", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const probe = (id: string) => defineTemplate({
      id,
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress, motionProgress }) => createElement("div", {
        "data-probe": id,
        "data-progress": progress.toFixed(3),
        "data-motion-progress": motionProgress?.toFixed(3),
      }, id),
    });
    const kit = createRenderTemplateRegistry({ templates: [probe("opening"), probe("counter")] });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "opening-scene", templateId: "opening", variables: { mediaUrl: "opening.jpg" }, timing: { fixedDuration: 5 } },
        { id: "counter-scene", templateId: "counter", variables: { mediaUrl: "counter.jpg" }, timing: { fixedDuration: 6 } },
      ],
    };

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const transitionStart = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 4.7,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(transitionStart).toContain('data-scene-layer="outgoing"');
    expect(transitionStart).toContain('data-layer-scene-id="opening-scene"');
    expect(transitionStart).toContain('data-progress="0.940"');
    expect(transitionStart).toContain('data-motion-progress="0.940"');
    expect(transitionStart).toContain('data-scene-layer="incoming"');
    expect(transitionStart).toContain('data-layer-scene-id="counter-scene"');
    expect(transitionStart).toContain('data-progress="0.000"');
    expect(transitionStart).toContain('data-motion-progress="0.000"');
    expect(transitionStart).toContain("opacity:1");
    expect(transitionStart).toMatch(/inert="(?:inert)?"/);
    expect(transitionStart.match(/data-scene-id=/g)).toHaveLength(1);
    expect(transitionStart.match(/data-template-id="opening"/g)).toHaveLength(1);
    expect(transitionStart.match(/data-layer-template-id="counter"/g)).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();

    const midpoint = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 4.85,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(midpoint).toContain('data-scene-layer="outgoing"');
    expect(midpoint).toContain('data-scene-layer="incoming"');
    expect(midpoint).toContain('data-progress="0.970"');
    expect(midpoint).toContain('data-motion-progress="0.970"');
    expect(midpoint).toContain('data-motion-progress="0.000"');
    expect(midpoint.match(/opacity:0\.5/g)).toHaveLength(2);

    const faded = renderToStaticMarkup(createElement(VideoFrame, {
      config: { ...config, style: { ...config.style, defaultTransition: "fade" } },
      time: 4.85,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(faded).toContain('data-scene-layer="outgoing"');
    expect(faded).toContain('data-scene-layer="incoming"');
    expect(faded.match(/opacity:0\.5/g)).toHaveLength(2);

    const settled = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 5,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(settled).not.toContain('data-scene-layer="outgoing"');
    expect(settled).toContain('data-scene-layer="active"');
    expect(settled).toContain('data-layer-scene-id="counter-scene"');
    expect(settled).toContain('data-progress="0.000"');
    expect(settled).toContain('data-motion-progress="0.000"');

    const caughtUp = renderToStaticMarkup(createElement(VideoFrame, {
      config,
      time: 8,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(caughtUp).toContain('data-progress="0.500"');
    expect(caughtUp).toContain('data-motion-progress="0.500"');
  });

  it("preserves the existing hard-cut progress contract when no transition is configured", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const kit = createRenderTemplateRegistry({
      templates: [defineTemplate({
        id: "probe",
        usesGlobalTransition: true,
        transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
        schema: { type: "object", properties: {}, additionalProperties: false },
        component: ({ progress, motionProgress }) => createElement("div", {
          "data-progress": progress.toFixed(3),
          "data-motion-progress": motionProgress?.toFixed(3),
        }),
      })],
    });
    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [
        { id: "first", templateId: "probe", variables: {}, timing: { fixedDuration: 5 } },
        { id: "second", templateId: "probe", variables: {}, timing: { fixedDuration: 5 } },
      ],
    };

    for (const defaultTransition of [undefined, "wipe"]) {
      const markup = renderToStaticMarkup(createElement(VideoFrame, {
        config: {
          ...config,
          style: { ...config.style, ...(defaultTransition ? { defaultTransition } : {}) },
        },
        time: 5.15,
        width: 1080,
        height: 1920,
        kit,
      }));
      expect(markup).not.toContain('data-scene-layer="outgoing"');
      expect(markup).toContain('data-progress="0.030"');
      expect(markup).toContain('data-motion-progress="0.030"');
    }
  });

  it("preserves body-scene timelines while holding final and single scenes at their poster pose", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const template = defineTemplate({
      id: "edge-probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress, motionProgress }) => createElement("div", {
        "data-progress": progress.toFixed(3),
        "data-motion-progress": motionProgress?.toFixed(3),
      }),
    });
    const kit = createRenderTemplateRegistry({ templates: [template] });
    const render = (scenes: Video["scenes"], time: number) => renderToStaticMarkup(createElement(VideoFrame, {
      config: {
        schemaVersion: "0.2",
        orientation: "portrait",
        style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
        scenes,
      },
      time,
      width: 1080,
      height: 1920,
      kit,
    }));
    const threeScenes: Video["scenes"] = ["first", "middle", "last"].map((id) => ({
      id,
      templateId: template.id,
      variables: { mediaUrl: `${id}.jpg` },
      timing: { fixedDuration: 4 },
    }));

    expect(render(threeScenes, 0)).toContain('data-motion-progress="0.000"');
    expect(render(threeScenes, 2)).toContain('data-motion-progress="0.500"');
    expect(render(threeScenes, 6)).toContain('data-motion-progress="0.500"');
    expect(render(threeScenes, 10)).toContain('data-motion-progress="0.500"');
    expect(render(threeScenes, 3.4)).toContain('data-progress="0.850" data-motion-progress="0.850"');
    expect(render(threeScenes, 7.4)).toContain('data-progress="0.850" data-motion-progress="0.850"');
    expect(render(threeScenes, 11.4)).toContain('data-progress="0.850" data-motion-progress="0.700"');
    expect(render(threeScenes, 11.9)).toContain('data-progress="0.975" data-motion-progress="0.700"');
    expect(render(threeScenes, 3.9)).toContain('data-progress="0.975" data-motion-progress="0.975"');
    expect(render(threeScenes, 12)).toContain('data-progress="1.000" data-motion-progress="0.700"');
    const single = render([{ ...threeScenes[0], id: "single" }], 2);
    expect(single).toContain('data-progress="0.500"');
    expect(single).toContain('data-motion-progress="0.500"');
    const singleHolding = render([{ ...threeScenes[0], id: "single" }], 3.9);
    expect(singleHolding).toContain('data-progress="0.975"');
    expect(singleHolding).toContain('data-motion-progress="0.700"');
    const singleAtEnd = render([{ ...threeScenes[0], id: "single" }], 4);
    expect(singleAtEnd).toContain('data-progress="1.000"');
    expect(singleAtEnd).toContain('data-motion-progress="0.700"');

    const gapScenes: Video["scenes"] = [
      { ...threeScenes[0], timing: { startTime: 0, endTime: 4 } },
      { ...threeScenes[1], timing: { startTime: 5, endTime: 9 } },
      { ...threeScenes[2], timing: { startTime: 10, endTime: 14 } },
    ];
    expect(render(gapScenes, 7)).toContain('data-motion-progress="0.500"');
    expect(render(gapScenes, 12)).toContain('data-motion-progress="0.500"');

    const shortScenes: Video["scenes"] = [
      { ...threeScenes[0], timing: { fixedDuration: 0.1 } },
      { ...threeScenes[1], timing: { fixedDuration: 0.1 } },
    ];
    const shortMidpoint = render(shortScenes, 0.05);
    expect(shortMidpoint.match(/opacity:0\.5/g)).toHaveLength(2);
  });

  it("renders gaps explicitly and never transitions overlapping ranges", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const template = defineTemplate({
      id: "probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress }) => createElement("div", { "data-progress": progress.toFixed(3) }),
    });
    const kit = createRenderTemplateRegistry({ templates: [template] });
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
          { id: "first", templateId: "probe", variables: {}, timing: { startTime: 0, endTime: 5 } },
          { id: "second", templateId: "probe", variables: {}, timing: { startTime: 10, endTime: 15 } },
        ],
      },
      time: 7,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(gap).toContain('data-video-frame="gap"');
    expect(gap).not.toContain('data-scene-id="first"');

    const overlap = renderToStaticMarkup(createElement(VideoFrame, {
      config: {
        ...base,
        scenes: [
          { id: "first", templateId: "probe", variables: {}, timing: { startTime: 0, endTime: 6 } },
          { id: "second", templateId: "probe", variables: {}, timing: { startTime: 5, endTime: 10 } },
        ],
      },
      time: 6.1,
      width: 1080,
      height: 1920,
      kit,
    }));
    expect(overlap).not.toContain('data-scene-layer="outgoing"');
    expect(overlap).toContain('data-scene-id="second"');
    expect(overlap).toContain('data-progress="0.220"');
  });

  it("treats only ULP-scale timeline drift as contiguous", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const template = defineTemplate({
      id: "probe",
      usesGlobalTransition: true,
      transitionTiming: { entryReadyProgress: 0.2, holdProgress: 0.7 },
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ({ progress }) => createElement("div", { "data-progress": progress.toFixed(3) }),
    });
    const kit = createRenderTemplateRegistry({ templates: [template] });
    const configFor = (secondStart: number): Video => ({
      schemaVersion: "0.2",
      orientation: "portrait",
      style: { ...TEST_VIDEO_STYLE, defaultTransition: "crossfade" },
      scenes: [
        { id: "first", templateId: "probe", variables: { mediaUrl: "first.jpg" }, timing: { startTime: 0, endTime: 0.1 + 0.2 } },
        { id: "second", templateId: "probe", variables: { mediaUrl: "second.jpg" }, timing: { startTime: secondStart, endTime: secondStart + 1 } },
      ],
    });
    const frameAt = (secondStart: number) => renderToStaticMarkup(createElement(VideoFrame, {
      config: configFor(secondStart), time: 0.2, width: 1080, height: 1920, kit,
    }));

    expect(frameAt(0.3)).toContain('data-scene-layer="outgoing"');
    expect(frameAt(0.3001)).not.toContain('data-scene-layer="outgoing"');

    const largeStart = 1_000_000_000;
    const largeConfig: Video = {
      ...configFor(0.3),
      scenes: [
        { id: "first", templateId: "probe", variables: { mediaUrl: "first.jpg" }, timing: { startTime: largeStart, endTime: largeStart + 0.1 + 0.2 } },
        { id: "second", templateId: "probe", variables: { mediaUrl: "second.jpg" }, timing: { startTime: largeStart + 0.3, endTime: largeStart + 1.3 } },
      ],
    };
    expect(renderToStaticMarkup(createElement(VideoFrame, {
      config: largeConfig,
      time: largeStart + 0.2,
      width: 1080,
      height: 1920,
      kit,
    }))).toContain('data-scene-layer="outgoing"');

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
      kit,
    }))).not.toContain('data-scene-layer="outgoing"');
  });

  it("keeps templates on the canonical canvas while scaling and centering the frame viewport", async () => {
    const { VideoFrame } = await import("../src/player/video-frame");
    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const kit = createRenderTemplateRegistry({
      templates: [defineTemplate({
        id: "canvasProbe",
        schema: { type: "object", properties: {}, additionalProperties: false },
        component: ({ width, height }) => createElement("div", {
          "data-probe-width": width,
          "data-probe-height": height,
        }),
      })],
    });
    const config = (orientation: "portrait" | "landscape"): Video => ({
      schemaVersion: "0.2",
      orientation,
      style: TEST_VIDEO_STYLE,
      scenes: [{ id: "probe", templateId: "canvasProbe", variables: {}, timing: { fixedDuration: 5 } }],
    });

    for (const width of [180, 380, 600, 960]) {
      const height = Math.round(width * 16 / 9);
      const markup = renderToStaticMarkup(createElement(VideoFrame, {
        config: config("portrait"),
        time: 2.5,
        width,
        height,
        kit,
      }));

      expect(markup).toContain(`width:${width}px`);
      expect(markup).toContain(`height:${height}px`);
      expect(markup).toContain('data-video-canvas="true"');
      expect(markup).toContain('data-probe-width="1080"');
      expect(markup).toContain('data-probe-height="1920"');
    }

    const letterboxed = renderToStaticMarkup(createElement(VideoFrame, {
      config: config("landscape"),
      time: 2.5,
      width: 600,
      height: 600,
      kit,
    }));
    expect(letterboxed).toContain('data-probe-width="1920"');
    expect(letterboxed).toContain('data-probe-height="1080"');
    expect(letterboxed).toContain("transform:scale(0.3125)");
    expect(letterboxed).toContain("top:131.25px");
    expect(letterboxed).toContain("left:0");
  });

  it("renders a deterministic video frame from the public config", async () => {
    let api: typeof import("../src/player/video-frame") | undefined;
    try {
      api = await import("../src/player/video-frame");
    } catch {
      // The assertion below is the expected red phase before the renderer exists.
    }
    expect(api, "the React renderer entry point should exist").toBeDefined();
    if (!api) return;

    const { createRenderTemplateRegistry, defineTemplate } = await import("../src/visual-system/catalog/internal");
    const kit = createRenderTemplateRegistry({
      templates: [defineTemplate({
        id: "customerOpening",
        jobs: ["setup"],
        register: "card-led",
        useWhen: "The customer wants to open with a personalized greeting.",
        schema: {
          type: "object",
          properties: { message: { type: "string", default: "Your update is ready." } },
          required: ["message"],
          additionalProperties: false,
        },
        preferredDuration: 5,
        component: ({ variables, width, height }) => createElement(
          "div",
          { style: { width, height } },
          String(variables.message),
        ),
      })],
    });

    const config: Video = {
      schemaVersion: "0.2",
      orientation: "portrait",
      style: TEST_VIDEO_STYLE,
      scenes: [{
        id: "opening",
        templateId: "customerOpening",
        variables: { message: "Acme’s customer-owned opening." },
        timing: { fixedDuration: 5 },
      }],
    };

    const markup = renderToStaticMarkup(createElement(api.VideoFrame, {
      config,
      time: 2.5,
      width: 1080,
      height: 1920,
      kit,
    }));

    expect(markup).toContain('data-template-id="customerOpening"');
    expect(markup).toContain("Acme’s customer-owned opening.");
    expect(markup).toContain("1080px");
    expect(markup).toContain("1920px");
  });
});
