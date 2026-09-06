import { describe, expect, it } from "vitest";

describe("acceptance template catalog", () => {
  it("loads the complete packaged template metadata without renderer services", async () => {
    const api = await import("../scripts/acceptance/catalog").catch(() => undefined);
    expect(api?.loadAcceptanceKit).toBeTypeOf("function");
    if (!api?.loadAcceptanceKit) return;

    const kit = api.loadAcceptanceKit();
    expect(kit.templates).toHaveLength(7);
    expect(kit.capabilities.templates).toContain("mobileMessage");
    expect(kit.capabilities.templates).toContain("keyFigure");
    expect(kit.capabilities.templates).toContain("chapterTitle");

    const starter = api.loadAcceptanceKit(["chapterTitle", "cinemaMedia"]);
    expect(starter.templates).toHaveLength(2);
    expect(starter.capabilities.templates).not.toContain("quote");
  });
});
