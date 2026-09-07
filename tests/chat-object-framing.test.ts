import { expect, it } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
const ending = {title:"A shared garden",narration:"The robot shared its garden with everyone.",subject:"robot garden",action:"The garden gate opens.",durationSec:5};
const brief = {type:"answer",opening:"One robot has a small surprise.",subject:"robot garden",development:"Plant and share.",visualDirection:"Warm miniature world.",ending};
const shot = {type:"shot",title:"Plant a seed",narration:'The robot labels it "a {tiny} garden" and plants a seed.',subject:"robot planting seed",action:"Hands plant a seed.",durationSec:5};
async function run(source: string, chunkSize = source.length) {
  const errors: string[] = [];
  const handler = createVideoChatHandler({authorize:"none",heartbeatMs:false,generateText:async()=>"",onError:error=>errors.push(error.message),
    streamText:async function* () {for(let offset=0;offset<source.length;offset+=chunkSize)yield source.slice(offset,offset+chunkSize);},
  });
  const response = await handler(new Request("https://app.example/?action=response",{method:"POST",body:JSON.stringify({prompt:"Tell a robot garden story"})}));
  const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
  return {events,errors,scenes:events.flatMap(event=>event.type==="scene.add"?[event.data.scene]:[])};
}
it.each([1,17,10000])("accepts complete pretty-printed objects with nested values and escaped strings across %i-character chunks", async size => {
  const source = '```json\n'+JSON.stringify(brief,null,2)+'\n'+JSON.stringify(shot,null,2)+'\n```';
  const result = await run(source,size);
  expect(result.errors).toEqual([]);
  expect(result.events.some(event=>event.type==="data.video-chat-opening")).toBe(true);
  expect(result.scenes.map(scene=>scene.narration)).toEqual([shot.narration,ending.narration]);
  expect(result.events.at(-1)?.type).toBe("response.complete");
});
it("frames adjacent objects without needing a trailing newline", async () => {
  expect((await run(JSON.stringify(brief)+JSON.stringify(shot),7)).scenes.map(scene=>scene.narration)).toEqual([shot.narration,ending.narration]);
});
it.each([JSON.stringify({answer:brief,shots:[shot]},null,2), 'Here is a story.', JSON.stringify([brief,shot],null,2), '{"type":"answer",broken}', JSON.stringify(brief).slice(0,-4)])("rejects malformed, incomplete or unsupported top-level data instead of inventing an answer", async source => {
  const result = await run(source,13);
  expect(result.scenes).toHaveLength(0);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.events.at(-1)?.type).toBe("response.error");
});
it("retains strict semantic validation for a complete object", async () => {
  const result = await run(JSON.stringify({type:"shot",...ending},null,2),3);
  expect(result.scenes).toHaveLength(0);
  expect(result.errors).toContain("Chat shot arrived before its answer brief");
});
it("retains the 32KB unfinished-object bound", async () => {
  const result = await run('{"type":"answer","opening":"'+"x".repeat(33000),1000);
  expect(result.scenes).toHaveLength(0);
  expect(result.errors.some(error=>error.includes("bounded stream limit"))).toBe(true);
});

it("rejects a malformed NDJSON record but retains later valid records and the authored ending", async () => {
  const result = await run(JSON.stringify(brief)+'\n{"type":"shot",broken}\n'+JSON.stringify(shot)+'\n',11);
  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.scenes.map(scene=>scene.narration)).toEqual([shot.narration,ending.narration]);
  expect(result.events.at(-1)).toMatchObject({type:"response.complete",data:{finishReason:"other"}});
});

it("emits a pretty-printed first shot before the provider finishes, without a trailing newline", async () => {
  let release!: () => void;
  let providerFinished = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const handler = createVideoChatHandler({
    authorize: "none", heartbeatMs: false, generateText: () => "",
    generateVideo: () => ({ type: "video", url: "https://media.example/first.mp4" }),
    streamText: async function* () {
      yield JSON.stringify(brief, null, 2);
      yield JSON.stringify(shot, null, 2);
      await waiting;
      providerFinished = true;
    },
  });
  const response = await handler(new Request("https://app.example/?action=response", {
    method: "POST", body: JSON.stringify({ prompt: "Tell a robot garden story" }),
  }));
  const events = decodeVideoSse(response.body!)[Symbol.asyncIterator]();
  try {
    let first;
    for (;;) {
      const next = await events.next();
      if (next.done) break;
      if (next.value.type === "scene.add") { first = next.value; break; }
    }
    expect(first).toMatchObject({ type: "scene.add", data: { scene: { narration: shot.narration } } });
    expect(providerFinished).toBe(false);
  } finally {
    release();
    while (!(await events.next()).done) { /* consume the authored ending */ }
  }
  expect(providerFinished).toBe(true);
});
