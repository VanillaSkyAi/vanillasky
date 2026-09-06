// @vitest-environment jsdom

import { createElement, lazy } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Video } from "../src/internal";
import { VideoFrame } from "../src/player/video-frame";
import {
  BUILTIN_PLAYER_KIT,
  preloadBuiltinTemplate,
} from "../src/visual-system/catalog/builtin-player";
import {
  createRenderTemplateRegistry,
  defineTemplate,
} from "../src/visual-system/catalog/internal";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";

function video(templateId: string): Video {
  return {
    schemaVersion: "0.2",
    orientation: "landscape",
    style: TEST_VIDEO_STYLE,
    scenes: [
      {
        id: "scene",
        templateId,
        variables: {},
        timing: { fixedDuration: 5 },
      },
    ],
  };
}

describe("built-in template loading", () => {
  it("warms the same renderer state used by the player", async () => {
    await preloadBuiltinTemplate("chapterTitle");

    const view = render(createElement(VideoFrame, {
      kit: BUILTIN_PLAYER_KIT,
      config: video("chapterTitle"),
      time: 0,
      width: 960,
      height: 540,
    }));

    expect(view.container.querySelector('[data-template-loading="chapterTitle"]')).toBeNull();
    expect(view.container.querySelector('[data-layer-template-id="chapterTitle"]')).not.toBeNull();
  });

  it("keeps the player-owned black background visible while a cold renderer suspends", () => {
    const ColdTemplate = lazy(() => new Promise<never>(() => undefined));
    const cold = defineTemplate({
      id: "cold-template",
      schema: { type: "object", properties: {}, additionalProperties: false },
      component: ColdTemplate,
    });
    const kit = createRenderTemplateRegistry({ templates: [cold] });

    const view = render(createElement(VideoFrame, {
      kit,
      config: video(cold.id),
      time: 0,
      width: 960,
      height: 540,
    }));

    expect(view.container.querySelector('[data-template-loading="cold-template"]')).not.toBeNull();
    const playerBackground = view.container.querySelector<HTMLElement>('[data-player-background="black"]');
    expect(playerBackground).not.toBeNull();
    expect(playerBackground?.style.backgroundColor).toBe("rgb(0, 0, 0)");
  });
});
