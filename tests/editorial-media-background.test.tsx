import {createElement, type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {ComparisonSceneTemplate} from '../src/visual-system/scene-templates/comparison';
import {KeyFigureSceneTemplate} from '../src/visual-system/scene-templates/key-figure';
import {QuoteSceneTemplate} from '../src/visual-system/scene-templates/quote';
import {TimelineSceneTemplate} from '../src/visual-system/scene-templates/editorial-timeline';
import {ExternalVideoBackdropProvider} from '../src/visual-system/scene-templates/external-video-backdrop';
import type {SceneTemplateProps} from '../src/visual-system/scene-templates/types';
import {TEST_VIDEO_STYLE} from './semantic-brand-fixture';

const cases: Array<[string, ComponentType<SceneTemplateProps>, Record<string, unknown>]> = [
 ['comparison', ComparisonSceneTemplate, {leftText:'Before',rightText:'After'}],
 ['key figure', KeyFigureSceneTemplate, {value:'42%',label:'A measured change'}],
 ['quote', QuoteSceneTemplate, {quote:'Observe carefully.',attribution:'A researcher'}],
 ['timeline', TimelineSceneTemplate, {events:[{label:'Observe'},{label:'Understand'}]}],
];
const mediaUrl = 'https://media.example.test/coast.jpg';
function scene(component:ComponentType<SceneTemplateProps>, variables:Record<string,unknown>) {
 return createElement(component,{variables,style:TEST_VIDEO_STYLE,progress:.7,width:1920,height:1080,beatIntensity:0,safeZone:{top:60,left:60,right:60,bottom:220},isPlaying:false});
}

describe.each(cases)('%s optional background',(_name,component,variables)=>{
 it('paints relevant media behind text with contrast treatment and a text shadow',()=>{
  const html=renderToStaticMarkup(scene(component,{...variables,mediaUrl,mediaType:'photo'}));
  expect(html).toContain(mediaUrl);
  expect(html).toContain('text-shadow:');
  expect(html).toContain('data-media-overlay="center-scrim"');
 });
 it('retains plain black without media or text shadows',()=>{
  const html=renderToStaticMarkup(scene(component,variables));
  expect(html).toContain('#000');
  expect(html).not.toMatch(/text-shadow:|data-media-overlay=|background-image:/);
 });
 it('uses the persistent video plane without duplicate videos or an opaque foreground',()=>{
  const html=renderToStaticMarkup(createElement(ExternalVideoBackdropProvider,{mode:'ready',children:scene(component,{...variables,mediaUrl:'https://media.example.test/coast.mp4',mediaType:'video'})}));
  expect(html).not.toContain('<video');
  expect(html).toContain('background:var(--vanillasky-template-surface, #000)');
  expect(html).toContain('data-media-overlay="center-scrim"');
 });
});
