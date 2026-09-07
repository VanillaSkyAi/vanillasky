import React from 'react';
import { createRoot } from 'react-dom/client';
import { Welcome } from '../../../src/video-chat/welcome';
import '../../../styles/video-chat.css';
import clip from './media-transition/waterfall.mp4?url';
import posterUrl from './media-transition/waterfall.jpg?url';
const count = new URLSearchParams(location.search).has('four') ? 4 : 8;
createRoot(document.getElementById('root')!).render(<div className="vanillasky-video-chat"><div className="stage-area"><div className="stage"><Welcome data={{hero:null,cards:Array.from({length:count}, (_, index) => ({prompt:`Show me something interesting ${index + 1}`,media:{type:'video' as const,url:clip,posterUrl}}))}} onAsk={() => {}} /></div></div></div>);
