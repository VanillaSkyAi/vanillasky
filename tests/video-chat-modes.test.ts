import { describe, it, expect } from 'vitest';
import { createVideoChatHandler } from '../src/server';
import { decodeVideoSse } from '../src/protocol/sse';
import { chatShot, streamChatShots } from './helpers/chat-shot-fixture';

describe('explicit footage modes', () => {
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
