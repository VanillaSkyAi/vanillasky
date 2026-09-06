import { expect, it } from "vitest";
import { createChatDiagnostics } from "../dev/chat/diagnostics";
it("records safe stream phases and resets metrics for the next response", async () => {
  const snapshots: unknown[] = [];
  const diagnostics = createChatDiagnostics(rows => snapshots.push(rows));
  const text = 'data: {"type":"response.start","data":{"prompt":"private prompt"}}\n\ndata: {"type":"data.video-chat-preparation","data":{"sceneId":"private id","narration":"private narration"}}\n\n';
  const fetcher = diagnostics.wrapFetch(async () => new Response(text));
  await (await fetcher("http://localhost/?action=response")).text();
  diagnostics.playback({type:"first-media-frame", elapsedMs:350, turnId:"private id", mode:"cinematic"});
  expect(JSON.stringify(snapshots)).not.toContain("private");
  expect(diagnostics.rows().map(row => row.phase)).toContain("shot authored");
  expect(diagnostics.rows().find(row => row.phase === "moving footage")?.elapsedMs).toBe(350);
  await fetcher("http://localhost/?action=response");
  expect(diagnostics.rows().some(row => row.phase === "moving footage")).toBe(false);
  diagnostics.dispose();
  diagnostics.playback({type:"first-frame", elapsedMs:900, turnId:"x", mode:"cinematic"});
  expect(diagnostics.rows()).toEqual([]);
});

it("marks speech ready only when its complete body has arrived", async () => {
  const diagnostics = createChatDiagnostics(() => {});
  let release!: () => void;
  const fetcher = diagnostics.wrapFetch(async input => String(input).includes("action=response") ? new Response("") : new Response(new ReadableStream({start(controller) {
    release = () => {controller.enqueue(new Uint8Array([1, 2])); controller.close();};
  }})));
  await fetcher("http://localhost/?action=response");
  const speech = await fetcher("http://localhost/?action=speech");
  expect(diagnostics.rows().map(row => row.phase)).toContain("speech response headers");
  expect(diagnostics.rows().map(row => row.phase)).not.toContain("speech bytes ready");
  release(); await speech.arrayBuffer();
  expect(diagnostics.rows().map(row => row.phase)).toContain("speech bytes ready");
});
