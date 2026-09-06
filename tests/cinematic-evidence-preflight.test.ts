import { describe, expect, it, vi } from "vitest";
import { createTemplateSceneValidator } from "../src/visual-system/catalog/validate";
import { BUILTIN_SERVER_TEMPLATE_KIT as kit } from "../src/visual-system/catalog/builtin-server";
import { isTemplatePropertyFormatSupported } from "../src/visual-system/catalog/value-validation";
import { createVideoHandler } from "../src/server/create-video-handler";
import { decodeVideoSse } from "../src/protocol/sse";

const validate = createTemplateSceneValidator({kit});
const figure = (value: string, input: string) => validate({id:"figure",templateId:"keyFigure",variables:{value,label:"Supplied quantity"},timing:{}},{input:{input},previousScenes:[]});
describe("cinematic evidence and provider preflight",()=>{
 it("supports formatted string quantities in authored schemas",()=>expect(isTemplatePropertyFormatSupported("grounded-stat","string")).toBe(true));
 it.each([['42%', 'Support reached 42%.'],['42 million','The audience reached 42\u00a0million.'],['€42','The price is € 42.']])("accepts supplied quantity %s with typographic whitespace normalization",(value,input)=>expect(()=>figure(value,input)).not.toThrow());
 it.each([['42','There were 142 people.'],['42%','There were 42 people.'],['42 million','There were 42 billion.'],['42','The rate was 42%.'],['42','The audience was 42 million.'],['42','The rate was 42 percent.'],['42','The price was $42.'],['2','The rate was 1.2.'],['42%','No figure was supplied.']])("rejects unsupported or unit-changing quantity %s in %s",(value,input)=>expect(()=>figure(value,input)).toThrow(/supplied quantity/));
 it("preserves opaque supplied media until downstream authorization",async()=>{
  const resolveMedia=vi.fn(()=>null);
  const handler=createVideoHandler({authorize:"none",heartbeatMs:false,requireCloser:false,resolveMedia,streamText:async function*(){yield JSON.stringify({type:"scene.add",scene:{id:"supplied",templateId:"cinemaMedia",variables:{mediaUrl:"https://vanillasky.invalid/supplied/media-1",mediaType:"video"},timing:{}}})+'\n';yield '{"type":"plan.complete"}\n';}});
  const url="https://media.example.test/supplied.mp4";
  const response=await handler(new Request("https://app.example.test/video",{method:"POST",body:JSON.stringify({protocolVersion:"0.6",requestId:"opaque",input:{input:"Show the supplied ocean footage.",opening:false,suppliedMedia:[{id:"supplied",type:"video",url}]},capabilities:{templates:["cinemaMedia"]}})}));
  const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
  expect(resolveMedia).not.toHaveBeenCalled();
  expect(events.find(event=>event.type==='scene.add')?.data).toMatchObject({scene:{variables:{mediaUrl:url}}});
 });
 it.each([1,3])("does not bill structurally invalid or unnegotiated scenes at concurrency %s",async(mediaConcurrency)=>{
  const resolveMedia=vi.fn(()=>({url:"https://media.example.test/valid.mp4",type:"video" as const}));
  const candidates=[
   {id:"missing",templateId:"mobileMessage",variables:{mediaKeyword:"Ocean waves",mediaSource:"generate"}},
   {id:"malformed",templateId:"cinemaMedia",variables:{mediaKeyword:"Ocean waves",mediaSource:"generate",shotDirection:{bad:true}}},
   {id:"unnegotiated",templateId:"mobileMessage",variables:{message:"Hello",mediaKeyword:"Ocean waves",mediaSource:"generate"}},
   {id:"extra",templateId:"cinemaMedia",variables:{mediaKeyword:"Ocean waves",mediaSource:"generate",unexpected:true}},
  ];
  const handler=createVideoHandler({authorize:"none",heartbeatMs:false,requireCloser:false,mediaConcurrency,resolveMedia,streamText:async function*(){for(const scene of candidates)yield JSON.stringify({type:"scene.add",scene:{...scene,timing:{}}})+'\n';yield JSON.stringify({type:"scene.add",scene:{id:"valid",templateId:"chapterTitle",variables:{title:"Still here"},timing:{}}})+'\n';yield '{"type":"plan.complete"}\n';}});
  const response=await handler(new Request("https://app.example.test/video",{method:"POST",body:JSON.stringify({protocolVersion:"0.6",requestId:"preflight",input:{input:"Ocean waves",opening:false},capabilities:{templates:["cinemaMedia","chapterTitle"]}})}));
  const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
  expect(resolveMedia).not.toHaveBeenCalled();
  expect(events.some(event=>event.type==='scene.add'&&event.data.scene.id==='valid')).toBe(true);
  expect(events.some(event=>event.type==='response.warning')).toBe(true);
 });
});
