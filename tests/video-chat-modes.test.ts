import { describe, it, expect, vi } from 'vitest';
import { createVideoChatHandler } from '../src/server';
import { decodeVideoSse } from '../src/protocol/sse';
import { chatShot, streamChatShots } from './helpers/chat-shot-fixture';

describe('explicit footage modes', () => {
  it.each([false, true])('advertises stock mode only when its resolver is configured (%s)', async configured => {
    const handler = createVideoChatHandler({ authorize: 'none', generateText: async () => '', streamText: () => streamChatShots(),
      ...(configured ? { searchMedia: async () => null } : {}) });
    const response = await handler(new Request('https://app.example/?action=capabilities'));
    expect(await response.json()).toMatchObject({ stockMedia: configured, modes: configured ? ['cinematic', 'pexels'] : ['cinematic'] });
  });
  it.each(['cinematic', 'pexels'])('recovers %s to an authored chapter without crossing providers', async mode => {
    let generated=0, stock=0;
    const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generateText:async()=>'',
      streamText:()=>streamChatShots([Object.assign(chatShot('golf grip','Hold the club lightly with both hands.'),{title:'A relaxed grip'})]),
      generateVideo:async()=>{generated++;return null;},searchMedia:async()=>{stock++;return null;}});
    const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'How to play golf?',mode})}));
    expect(response.status).toBe(200);
    const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
    expect(generated).toBe(mode==='cinematic'?1:0);expect(stock).toBe(mode==='pexels'?1:0);
    expect(events.find(e=>e.type==='scene.add')).toMatchObject({data:{scene:{templateId:'chapterTitle',variables:{title:'A relaxed grip'},narration:'Hold the club lightly with both hands.'}}});
  });
  it('aborts footage when the client cancels after early narration preparation',async()=>{
    let mediaSignal: AbortSignal | undefined;
    const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generateText:async()=>'',streamText:()=>streamChatShots(),generateVideo:async(_query,context)=>{mediaSignal=context.signal;return new Promise(()=>{});}});
    const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'A garden'})}));
    const reader=response.body!.getReader();
    while(true){const chunk=await reader.read();if(new TextDecoder().decode(chunk.value).includes('"type":"data.video-chat-preparation"'))break;}
    await reader.cancel();
    expect(mediaSignal?.aborted).toBe(true);
  });
  it('does not start paid footage after a delayed authored shot misses its deadline',async()=>{
    vi.useFakeTimers();
    let release!:()=>void;
    const held=new Promise<void>(resolve=>{release=resolve;});
    const generateVideo=vi.fn(async()=>({url:'https://media.example/ready.mp4',type:'video' as const}));
    const opening=chatShot('ocean waves','A wave rises across the water.');
    const ending={...chatShot('breaking wave','The wave breaks into white foam.'),title:'Breaking into foam'};
    const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generateText:async()=>'',generateVideo,
      streamText:async function*(){
        yield JSON.stringify({type:'answer',opening:'Watch a wave move toward the shore.',subject:'ocean wave',development:'A wave rises and breaks.',ending})+'\n';
        yield JSON.stringify(opening)+'\n';
        await held;
      }});
    try {
      const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'Explain waves'})}));
      const events: unknown[]=[];
      const reading=(async()=>{for await(const event of decodeVideoSse(response.body!))events.push(event);})();
      await vi.advanceTimersByTimeAsync(25_000);
      expect(generateVideo).toHaveBeenCalledTimes(1);
      release();
      await vi.advanceTimersByTimeAsync(10);
      await reading;
      expect(generateVideo).toHaveBeenCalledTimes(1);
      expect(events).toContainEqual(expect.objectContaining({type:'scene.add',data:expect.objectContaining({scene:expect.objectContaining({templateId:'chapterTitle',variables:{title:'Breaking into foam'},narration:ending.narration})})}));
    } finally {release();vi.useRealTimers();}
  });
  it('uses the configured clip duration in planning and finite scene timing',async()=>{
    let instructions='';
    const shot={...chatShot('ocean wave'),durationSec:12};
    const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generatedClipDurationSec:10,generateText:async()=>'',streamText:context=>{instructions=context.systemPrompt+' '+context.userPrompt;return streamChatShots([shot]);}});
    const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'A wave'})}));
    const events=[];for await(const event of decodeVideoSse(response.body!))events.push(event);
    expect(instructions).toContain('at most 10 seconds');
    expect(events.find(e=>e.type==='scene.add')).toMatchObject({data:{scene:{timing:{fixedDuration:10}}}});
  });
  it('publishes speech preparation before blocked footage resolves',async()=>{
    let release!:()=>void;const wait=new Promise<void>(r=>release=r);
    const handler=createVideoChatHandler({authorize:'none',heartbeatMs:false,generateText:async()=>'',streamText:()=>streamChatShots(),generateVideo:async()=>{await wait;return null;}});
    const response=await handler(new Request('https://app.example/?action=response',{method:'POST',body:JSON.stringify({prompt:'A garden'})}));
    const iterator=decodeVideoSse(response.body!)[Symbol.asyncIterator]();
    try {
      const start=await iterator.next();expect(JSON.stringify(start.value)).toContain('data.video-chat-preparation');
      let preparation;for(let i=0;i<5;i++){const next=await iterator.next();if(next.value?.type==='data.video-chat-preparation'){preparation=next.value;break;}}
      expect(preparation).toMatchObject({data:{sceneId:expect.any(String),narration:expect.any(String)}});
    } finally {release();await iterator.return?.(undefined);}
  });
});
