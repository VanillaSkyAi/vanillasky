import { expect, it, vi } from "vitest";
import { createOfflineChatHandler, readFixtureOptions } from "../dev/chat/offline";
import { decodeVideoSse } from "../src/protocol/sse";
it("bounds fixture choices and never opts into live providers", () => {
  expect(readFixtureOptions(new URL("http://localhost/?scenario=unknown&intent=unknown"))).toEqual({ scenario: "ready", intent: "explanation" });
});
it("exercises the actual handler with a deterministic creative ending and only local footage", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline harness must not fetch"));
  try {
    const handler = createOfflineChatHandler({scenario: "ready", intent: "story"});
    const response = await handler(new Request("http://localhost/__chat/offline?action=response", {method: "POST", body: JSON.stringify({prompt: "A tiny robot story", orientation: "portrait"})}));
    const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
    expect(events.at(-1)?.type).toBe("response.complete");
    const scenes = events.flatMap(event => event.type === "scene.add" ? [event.data.scene] : []);
    expect(scenes.length).toBeGreaterThan(1);
    expect(scenes.at(-1)?.narration).toContain("garden");
    expect(scenes.every(scene => String(scene.variables.mediaUrl).startsWith("http://127.0.0.1:4281/tests/browser/fixtures/"))).toBe(true);
    expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
});
