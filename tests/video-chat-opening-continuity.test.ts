import {describe,expect,it} from 'vitest';
import {createVideoChatHandler} from '../src/server';
import {decodeVideoSse} from '../src/protocol/sse';
const hook='The Moon always shows the same face.';
const shot={text:'The Moon turns',narration:hook,mediaKeyword:'moon surface'};
const body=(narration:string)=>({type:'scene.add',scene:{id:'body',templateId:'cinemaMedia',variables:{mediaKeyword:'moon orbit',mediaSource:'stock',fallbackText:'Synchronized motion'},narration,timing:{fixedDuration:5}}});
async function run(firstShot:typeof shot|undefined,narration:string,opening?:string){
 const generated:string[]=[],textCalls:string[]=[];
 const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,
  generateText:async()=>{textCalls.push('text');return 'unused';},
  generateVideo:async(query)=>{generated.push(query);return null;},
  streamText:()=> (async function*(){
   yield JSON.stringify({type:'video-chat.opening',spokenHook:hook,mediaKeyword:'moon',...(firstShot?{firstShot}:{})})+'\n';
   yield JSON.stringify(body(narration))+'\n';
   yield JSON.stringify({type:'scene.add',placement:'closer',scene:{id:'ending',templateId:'chapterTitle',variables:{title:'A synchronized world'},narration:'Together, these motions keep one lunar hemisphere facing our planet.',timing:{fixedDuration:5}}})+'\n';
   yield '{"type":"plan.complete"}\n';
  })(),
 });
 const response=await handler(new Request('https://app.example/api/video-chat?action=response',{method:'POST',body:JSON.stringify({prompt:'Explain the Moon',...(opening?{opening}:{})})}));
 const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
 return {scenes:events.flatMap(event=>event.type==='scene.add'?[event.data.scene]:[]),generated,textCalls};
}
describe('streamed opening continuation',()=>{
 it('does not generate an entire first shot that only repeats the hook',async()=>{
  const result=await run(shot,`${hook} Its rotation matches its orbit.`);
  expect(result.generated).toEqual([]);
  expect(result.scenes.map(scene=>scene.narration)).toEqual(['Its rotation matches its orbit.','Together, these motions keep one lunar hemisphere facing our planet.']);
  expect(result.textCalls).toEqual([]);
 });
 it('keeps new first-shot narration and removes its duplicate body beat',async()=>{
  const result=await run({...shot,text:hook,narration:`${hook} Its rotation matches its orbit.`},'Its rotation matches its orbit.');
  expect(result.generated).toEqual(['moon surface']);
  expect(result.scenes).toHaveLength(2);
  expect(result.scenes[0].narration).toBe('Its rotation matches its orbit.');
  expect(result.scenes[0].variables.title).toBe('Its rotation matches its orbit.');
 });
 it('honors an already-spoken hook without another narration request',async()=>{
  const result=await run(undefined,`${hook} Its rotation matches its orbit.`,hook);
  expect(result.scenes[0].narration).toBe('Its rotation matches its orbit.');
  expect(result.textCalls).toEqual([]);
 });
});
