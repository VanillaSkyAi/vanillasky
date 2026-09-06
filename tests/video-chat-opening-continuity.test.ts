import { describe, expect, it, vi } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
import { chatShot, streamChatShots } from "./helpers/chat-shot-fixture";
const hook = "The Moon keeps one face turned toward Earth.";
async function run(narration: string, supplied = false) {
 const generateVideo = vi.fn(() => ({ type: "video" as const, url: "https://media.example/moon.mp4" }));
 const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false, generateVideo, generateText: () => "",
  streamText: () => streamChatShots([chatShot("moon rotation", narration), chatShot("moon orbit", "Its rotation and orbit take the same time.")], supplied ? "A different opening must not be used." : hook, "moon"),
 });
 const response = await handler(new Request("https://app.example/api?action=response", { method: "POST", body: JSON.stringify({ prompt: "Why does the Moon show one face?", ...(supplied ? { opening: hook } : {}) }) }));
 const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
 return { events, generateVideo, scenes: events.flatMap(e => e.type === "scene.add" ? [e.data.scene] : []) };
}
describe("streamed opening continuation", () => {
 it("does not spend on a body shot that exactly repeats the opening", async () => {
  const result = await run(hook);
  expect(result.generateVideo).toHaveBeenCalledTimes(1);
  expect(result.scenes[0].narration).toBe("Its rotation and orbit take the same time.");
 });
 it("retains the next whole thought after a repeated opening sentence", async () => {
  const result = await run(`${hook} It also rotates around its own axis.`);
  expect(result.scenes[0].narration).toBe("It also rotates around its own axis.");
 });
 it("honors an already-spoken opening through the same shot path", async () => {
  const result = await run(`${hook} It also rotates around its own axis.`, true);
  expect(result.events.find(e => e.type === "data.video-chat-opening")?.data).toMatchObject({ line: hook });
  expect(result.scenes[0].narration).toBe("It also rotates around its own axis.");
 });
});
