import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATE_MANIFEST } from "../src/visual-system/catalog/builtin-manifest";
import { getTemplate } from "../src/visual-system/scene-templates/registry";
import { TEST_VIDEO_STYLE } from "./semantic-brand-fixture";
function markup(id: string, variables: Record<string, unknown>, progress: number) {
  const template = getTemplate(id)!;
  return renderToStaticMarkup(createElement(template.component, {variables, style: TEST_VIDEO_STYLE, progress, motionProgress: progress, beatIntensity: 0, width: 1080, height: 1920, safeZone: {top: 100, right: 60, bottom: 100, left: 60}, sceneDuration: 6, isPlaying: false}));
}
describe("cinematic semantic progress", () => {
  it("keeps authored motion independent of global fades", () => {
    expect(BUILTIN_TEMPLATE_MANIFEST).toHaveLength(8);
    for (const template of BUILTIN_TEMPLATE_MANIFEST) expect(template.usesGlobalTransition).toBe(false);
  });
  it.each([0, 0.2, 0.7, 1])("never invents an intermediate key figure at progress %s", progress => {
    const html = markup("keyFigure", {value: "75%", label: "successful runs"}, progress);
    expect(html).toContain("75%"); expect(html).not.toContain(">0<"); expect(html).not.toContain("70%");
  });
  it.each([0, 0.2, 0.7, 1])("preserves a supplied zero at progress %s", progress => {
    expect(markup("keyFigure", {value: "0", label: "incidents"}, progress)).toContain(">0<");
  });
  it("keeps the final focus point and timeline event through the exit", () => {
    expect(markup("focusCards", {items: ["Listen", "Explore", "FINAL POINT"]}, 0.99)).toContain("FINAL POINT");
    expect(markup("editorialTimeline", {events: [{label: "Listen"}, {label: "Explore"}, {label: "FINAL EVENT"}]}, 0.99)).toContain("FINAL EVENT");
  });
  it("reveals a complete message without fabricated sender or timestamp", () => {
    const html = markup("mobileMessage", {message: "Your release video is ready", app: "Messages"}, 0.6);
    expect(html).toContain("Your release video is ready"); expect(html).not.toContain("Alex Morgan"); expect(html).not.toContain("now");
  });
});
