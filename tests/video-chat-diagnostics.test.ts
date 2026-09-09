import { describe, it, expect } from 'vitest';
import { createVideoChatHandler } from '../src/server';
import { chatShot, streamChatShots } from './helpers/chat-shot-fixture';

async function run(failure?: 'provider' | 'timeout' | 'allowance', observer?: (event: unknown)=>unknown) {
  const events: Record<string, unknown>[]=[];
  const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generateText:async()=>'',
    onDiagnostic:event=>{events.push(event);return observer?.(event);},
    maxGeneratedVideos:failure==='allowance'?0:5,
    streamText:()=>streamChatShots([chatShot('private subject','Private authored sentence remains narration.')]),
    generateVideo:async()=>{
      if(failure==='provider')throw new Error('private-provider-body');
      if(failure==='timeout')throw new DOMException('private-timeout-body','TimeoutError');
      return {url:'https://media.example/private.mp4',type:'video'};
    }});
  const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'private-user-prompt'})}));
  const text=await response.text();
  return {events,text};
}
describe('safe host chat diagnostics',()=>{
  it('reports successful phases without retaining answer or provider data',async()=>{
    const {events,text}=await run();
    expect(events.map(e=>e.phase)).toEqual(['request-accepted','opening-authored','media-start','narration-fit','shot-authored','media-end']);
    expect(events.at(-1)).toMatchObject({reason:'ready',durationMs:expect.any(Number)});
    expect(events.every(e=>typeof e.requestId==='string' && e.mode==='cinematic' && typeof e.elapsedMs==='number' && e.elapsedMs>=0)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/private|https:|"narration":|subject|prompt/);
    expect(text).not.toContain('media-start');
  });
  it.each([['provider','provider-error'],['timeout','timeout'],['allowance','allowance']] as const)('distinguishes %s recovery',async(failure,reason)=>{
    const {events,text}=await run(failure);
    const phase=failure==='allowance'?'media-skipped':'media-end';
    expect(events.filter(event=>event.phase===phase)).toEqual([expect.objectContaining({phase,reason})]);
    expect(text).toContain('chapterTitle');
    expect(JSON.stringify(events)).not.toContain('private');
  });
  it('isolates synchronous and asynchronous observer failures',async()=>{
    for(const observer of [()=>{throw new Error('observer');},()=>Promise.reject(new Error('observer'))]) {
      const {text}=await run(undefined,observer);expect(text).toContain('response.complete');
    }
  });
});
