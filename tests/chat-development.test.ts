import { expect, it, vi } from "vitest";
import { createOfflineChatHandler, readFixtureOptions } from "./support/chat/offline";
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
    const footage = scenes.filter(scene => scene.templateId === "cinemaMedia");
    expect(footage.length).toBeGreaterThan(0);
    expect(footage.every(scene => String(scene.variables.mediaUrl).startsWith("http://127.0.0.1:4281/tests/browser/fixtures/"))).toBe(true);
    // A longer authored line retains its local footage and complete speech;
    // playback can repeat the clip without another provider request.
    expect(scenes[0]).toMatchObject({templateId:"cinemaMedia",narration:"The robot plants its seed beside an empty house."});
    expect(network).not.toHaveBeenCalled();
  } finally {network.mockRestore();}
});
it("serves distinct matching spoken audio for every offline answer beat instead of a timing cue", async () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Offline speech must not fetch"));
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const uniqueAudio = new Set<string>();
  try {
    for (const intent of ["explanation", "story", "comedy", "imagination", "practical", "golf"] as const) {
      const handler = createOfflineChatHandler({scenario: "ready", intent});
      const response = await handler(new Request("http://localhost/__chat/offline?action=response", {method: "POST", body: JSON.stringify({prompt: "Try the selected fixture"})}));
      const lines: string[] = [];
      for await (const event of decodeVideoSse(response.body!)) {
        if (event.type === "data.video-chat-opening") lines.push((event.data as {line: string}).line);
        if (event.type === "scene.add") lines.push(event.data.scene.narration!);
      }
      expect(lines).toHaveLength(3);
      for (const text of lines) {
        const speech = await handler(new Request("http://localhost/__chat/offline?action=speech", {method: "POST", body: JSON.stringify({text})}));
        expect(speech.status).toBe(200);
        expect(speech.headers.get("content-type")).toBe("audio/mpeg");
        const bytes = Buffer.from(await speech.arrayBuffer());
        expect(bytes.length).toBeGreaterThan(8_000);
        uniqueAudio.add(bytes.toString("base64"));
      }
    }
    expect(uniqueAudio.size).toBe(18);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); log.mockRestore(); }
});
