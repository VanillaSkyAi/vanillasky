import {describe,it,expect,vi} from 'vitest';
import {createVideoChatHandler} from '../src/server/create-video-chat-handler';
import {decodeVideoSse} from '../src/protocol/sse';

async function run(source:'stock'|'generate', success=true, fallback=true) {
 const media={url:'https://media.example.test/shot.mp4',type:'video' as const};
 const generateVideo=vi.fn(async()=>success?media:null);
 const searchMedia=vi.fn(async()=>success?media:null);
 const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,requireCloser:false,
  generateText:()=>'',generateVideo,searchMedia,
  streamText:async function*(){
   yield JSON.stringify({type:'scene.add',scene:{id:'shot',templateId:'cinemaMedia',variables:{mediaKeyword:'ocean waves',mediaType:'video',mediaSource:source,...(fallback?{fallbackText:'The ocean keeps moving'}:{})},timing:{fixedDuration:5},narration:'Waves carry energy across the surface of the water.'}})+'\n';
   yield '{"type":"plan.complete"}\n';
  }
 });
 const response=await handler(new Request('https://example.test/api/video?action=response',{method:'POST',body:JSON.stringify({prompt:'Explain waves',mode:'cinematic'})}));
 const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
 const scenes=events.flatMap(event=>event.type==='scene.add'?[event.data.scene]:[]);
 return{generateVideo,searchMedia,scenes,events};
}
describe('cinematic media routing',()=>{
 it('respects stock intent without spending on generation',async()=>{
  const result=await run('stock');expect(result.generateVideo).not.toHaveBeenCalled();expect(result.searchMedia).toHaveBeenCalledOnce();
  expect(result.scenes[0]?.templateId).toBe('cinemaMedia');expect(result.scenes[0]?.variables.mediaSource).toBeUndefined();
 });
 it('dispatches generated intent through the configured provider',async()=>{
  const result=await run('generate');expect(result.generateVideo).toHaveBeenCalledOnce();expect(result.searchMedia).not.toHaveBeenCalled();
 });
 it('preserves narration and grounded meaning when footage fails',async()=>{
  const result=await run('generate',false);expect(result.scenes[0]?.templateId).toBe('chapterTitle');
  expect(result.scenes[0]?.variables).toEqual({title:'The ocean keeps moving'});expect(result.scenes[0]?.narration).toContain('Waves carry energy');
 });
 it('does not invent a title or emit an empty media scene when fallback is missing',async()=>{
  const result=await run('stock',false,false);expect(result.scenes).toHaveLength(0);expect(result.events.some(event=>event.type==='response.error')).toBe(true);
 });
});
