import { chatShot, streamChatShots } from "./helpers/chat-shot-fixture";
import {describe,it,expect,vi} from 'vitest';
import {createVideoChatHandler} from '../src/server/create-video-chat-handler';
import {decodeVideoSse} from '../src/protocol/sse';

async function run(source:'stock'|'generate', success: boolean | 'reject' | 'abort'=true) {
 const media={url:'https://media.example.test/shot.mp4',type:'video' as const};
 const resolve=async()=>{ if(success==='reject')throw new Error('private failure');if(success==='abort')throw new DOMException('provider timed out','AbortError');return success?media:null; };
 const generateVideo=vi.fn(resolve);
 const searchMedia=vi.fn(resolve);
 const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,requireCloser:false,
  generateText:()=>'',generateVideo,searchMedia,maxGeneratedVideos:source==='stock'?0:5,
  streamText:()=>streamChatShots([chatShot('ocean waves','Waves carry energy across the surface of the water.')])

 });
 const response=await handler(new Request('https://example.test/api/video?action=response',{method:'POST',body:JSON.stringify({prompt:'Explain waves',mode:'cinematic'})}));
 const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
 const scenes=events.flatMap(event=>event.type==='scene.add'?[event.data.scene]:[]);
 return{generateVideo,searchMedia,scenes,events};
}
describe('cinematic media routing',()=>{
 it('routes directly to stock when the host allows no generation',async()=>{
  const result=await run('stock');expect(result.generateVideo).not.toHaveBeenCalled();expect(result.searchMedia).toHaveBeenCalledOnce();
  expect(result.scenes[0]?.templateId).toBe('cinemaMedia');expect(result.scenes[0]?.variables.fallbackText).toBeUndefined();expect(result.scenes[0]?.variables.mediaSource).toBeUndefined();
 });
 it('dispatches generated intent through the configured provider',async()=>{
  const result=await run('generate');expect(result.generateVideo).toHaveBeenCalledOnce();expect(result.searchMedia).not.toHaveBeenCalled();
 });
 it('preserves narration and grounded meaning when footage fails',async()=>{
  const result=await run('generate',false);expect(result.scenes[0]?.templateId).toBe('cinemaMedia');
  expect(result.scenes[0]?.variables).toEqual({mediaType:'video',mediaUrl:''});expect(result.scenes[0]?.narration).toContain('Waves carry energy');
 });
 it('keeps narration without inventing a title when media is missing',async()=>{
  const result=await run('stock',false);expect(result.scenes).toHaveLength(1);expect(result.events.at(-1)?.type).toBe('response.complete');
 });
 it.each(['reject','abort'] as const)('recovers a provider %s without losing grounded content',async failure=>{
  const result=await run('generate',failure);
  expect(result.scenes[0]?.templateId).toBe('cinemaMedia');
  expect(result.scenes[0]?.variables).toEqual({mediaType:'video',mediaUrl:''});
  expect(JSON.stringify(result.events)).not.toContain('private failure');
 });

});
