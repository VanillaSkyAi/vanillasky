import { expect, it } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";
async function run(hint: unknown, mode = "pexels") {
  const stock: unknown[] = [], ai: unknown[] = [], queries: string[] = [];
  const capture = (calls: unknown[]) => (_query: string, context: {scene?: {variables: Record<string, unknown>}}) => {
    queries.push(_query);
    calls.push(context.scene?.variables.stockSelection);
    return {type:"video" as const,url:"https://media.example/clip.mp4"};
  };
  const handler = createVideoChatHandler({authorize:"none",heartbeatMs:false,generateText:async()=>"",searchMedia:capture(stock),generateVideo:capture(ai),
    streamText:async function* () {
      yield JSON.stringify({type:"answer",opening:"One dog meets a very large ocean.",subject:"dog at beach",development:"",ending:{title:"Enough ocean",narration:"The dog decided the ocean was terrible.",subject:"dog beach waves",action:"A dog retreats from the water.",durationSec:5,stockSelection:hint}})+"\n";
    },
  });
  const response = await handler(new Request("https://app.example/?action=response",{method:"POST",body:JSON.stringify({prompt:"Tell a tiny dog comedy",mode})}));
  const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
  return {stock,ai,events,queries};
}
it("forwards bounded explicit Pexels identity separately from its search query and strips private hints", async () => {
  const hint = {subject:"dog",activity:"playing in water",equipment:"surf board",exclude:["person alone"],junk:"private model payload"};
  const result = await run(hint);
  expect(result.stock).toEqual([{subject:"dog",activity:"playing in water",equipment:"surf board",exclude:["person alone"]}]);
  expect(result.ai).toEqual([]);
  expect(result.queries).toEqual(["dog beach waves"]);
  expect(result.events.filter(event=>event.type==="scene.add")).toHaveLength(1);
  expect(JSON.stringify(result.events)).not.toMatch(/stockSelection|private model payload|person alone/);
});
it.each([undefined, {}, {subject:""}, {subject:"https://private.example"}, {subject:"one two three four five"}, {subject:"x".repeat(49)}])("does not invent an anchor from the query when hint %j is invalid", async hint => {
  expect((await run(hint)).stock).toEqual([undefined]);
});
it("drops invalid optional hint fields without passing through model junk", async () => {
  const result = await run({subject:"dog",activity:{secret:"private"},equipment:"x".repeat(49),exclude:["one","two","three","four"],junk:true});
  expect(result.stock).toEqual([{subject:"dog"}]);
});
it("does not send stock hints to the AI provider or call stock in AI mode", async () => {
  const result = await run({subject:"dog",exclude:["person"]},"cinematic");
  expect(result.stock).toEqual([]);
  expect(result.ai).toEqual([undefined]);
  expect(JSON.stringify(result.events)).not.toContain("stockSelection");
});
