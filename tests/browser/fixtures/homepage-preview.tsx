import React from 'react';
import {createRoot} from 'react-dom/client';
import {VideoChat} from '../../../src/react';
import {WELCOME_CARDS} from '../../../src/video-chat/welcome-cards';
import {checksumVideo} from '../../../src/protocol/checksum';
import type {Video} from '../../../src/protocol/types';
import {TEST_VIDEO_STYLE} from '../../semantic-brand-fixture';
import '../../../styles/video-chat.css';

// Local UI preview: selecting a card never calls a generation provider.
const fetcher: typeof fetch = async (input, init) => {
  const action=new URL(String(input),location.origin).searchParams.get('action');
  if(action==='capabilities') return Response.json({templates:true,generatedVideo:false,generatedSpeech:false,stockMedia:true,transcription:false,modes:['pexels']});
  if(action==='welcome') return Response.json({hero:{type:'video',url:'https://videos.pexels.com/video-files/11335959/11335959-hd_1920_1080_30fps.mp4',posterUrl:'https://images.pexels.com/videos/11335959/pexels-photo-11335959.jpeg?auto=compress&fit=crop&w=1920'},cards:WELCOME_CARDS});
  if(action==='suggestions') return Response.json({suggestions:[]});
  if(action!=='response') throw new Error('Unexpected local preview request');
  const prompt=JSON.parse(String(init?.body)).prompt as string;
  document.body.dataset.selectedPrompt=prompt;
  const snapshot:Video={schemaVersion:'0.2',orientation:'landscape',style:TEST_VIDEO_STYLE,scenes:[{id:'preview',templateId:'chapterTitle',variables:{title:'Local preview'},narration:'This is a local preview.',timing:{fixedDuration:1}}]};
  const records=[['response.start',{requestId:'preview',format:{orientation:'landscape'},style:TEST_VIDEO_STYLE}],['scene.add',{scene:snapshot.scenes[0],position:0}],['response.complete',{finishReason:'stop',snapshot,checksum:checksumVideo(snapshot)}]];
  return new Response(records.map(([type,data],sequence)=>`data: ${JSON.stringify({protocolVersion:'0.6',runId:'preview',eventId:`preview:${sequence}`,sequence,type,data})}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
};
createRoot(document.getElementById('root')!).render(<VideoChat options={{fetcher,mode:'pexels',voice:{prepare:async()=>({seconds:1}),speak:async()=>{},pause(){},resume(){},setMuted(){}}}} />);
