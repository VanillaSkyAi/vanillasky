import { expect, it } from "vitest";
import { createVideoChatHandler } from "../src/server/create-video-chat-handler";
import { decodeVideoSse } from "../src/protocol/sse";

const privateFixture = "fictional-content-must-not-appear-in-diagnostics";
const absentFields = { opening: false, subject: false, development: false, visualDirection: false, ending: false };
async function rejected(first: unknown) {
  const errors: Error[] = [];
  let mediaCalls = 0;
  const handler = createVideoChatHandler({ authorize: "none", heartbeatMs: false,
    generateText: () => "", generateVideo: () => { mediaCalls++; return null; },
    onError: error => { errors.push(error); },
    streamText: async function* () {
      yield `${JSON.stringify(first)}\n`;
      for (let index = 0; index < 4; index++) yield `${JSON.stringify({type:"shot", narration:privateFixture, subject:"atom"})}\n`;
    },
  });
  const response = await handler(new Request("https://app.example/api?action=response", {
    method: "POST", body: JSON.stringify({prompt:"Explain an atom",mode:"cinematic"}),
  }));
  const events = [];
  for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { errors, events, mediaCalls };
}

it.each([
  { name:"array", input:[privateFixture], shape:"array", discriminator:"missing", fields:absentFields },
  { name:"wrapper", input:{[privateFixture]:{}}, shape:"object", discriminator:"missing", fields:absentFields },
  { name:"missing discriminator", input:{opening:privateFixture,ending:{}}, shape:"object", discriminator:"missing", fields:{...absentFields,opening:true,ending:true} },
  { name:"unsupported discriminator", input:{type:privateFixture,subject:privateFixture}, shape:"object", discriminator:"other-string", fields:{...absentFields,subject:true} },
  { name:"non-string discriminator", input:{type:{[privateFixture]:privateFixture}}, shape:"object", discriminator:"non-string", fields:absentFields },
  { name:"null", input:null, shape:"null", discriminator:"missing", fields:absentFields },
  { name:"number", input:42, shape:"number", discriminator:"missing", fields:absentFields },
  { name:"boolean", input:false, shape:"boolean", discriminator:"missing", fields:absentFields },
  { name:"string", input:privateFixture, shape:"string", discriminator:"missing", fields:absentFields },
])("classifies $name without accepting it or exposing content", async ({input,shape,discriminator,fields}) => {
  const {errors,events,mediaCalls} = await rejected(input);
  const shapeErrors = errors.filter(error => error.message === "Chat plan requires an answer brief followed by shots");
  expect(shapeErrors).toHaveLength(1);
  expect(shapeErrors[0].cause).toEqual({code:"chat_plan_shape",shape,discriminator,fields});
  expect(errors.filter(error => error.message === "Chat shot arrived before its answer brief")).toHaveLength(4);
  expect(events.filter(event => event.type === "scene.add")).toHaveLength(0);
  expect(mediaCalls).toBe(0);
  expect(events.at(-1)?.type).toBe("response.error");
  expect(JSON.stringify({errors:errors.map(error => ({message:error.message,cause:error.cause})),events})).not.toContain(privateFixture);
});
