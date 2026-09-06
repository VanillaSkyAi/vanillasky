import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {addRegistryTemplates} from '../src/cli/registry';
import {getTemplate,listTemplates} from '../src/visual-system/scene-templates/registry';
import {ExternalVideoBackdropProvider} from '../src/visual-system/scene-templates/external-video-backdrop';
import {TEST_VIDEO_STYLE} from './semantic-brand-fixture';
const sample:Record<string,Record<string,unknown>>={cinemaMedia:{mediaKeyword:'Rocky coast',mediaUrl:'https://cdn.test/coast.mp4',mediaType:'video'},chapterTitle:{title:'The world beneath our feet'},focusCards:{items:['Listen closely','Notice the pattern','Make room for change']},editorialTimeline:{events:[{label:'Observe'},{label:'Understand'},{label:'Act'}]},mobileMessage:{mediaUrl:'https://cdn.test/coast.mp4',mediaType:'video',message:'Can we talk tomorrow?',app:'Messages'},comparison:{leftText:'More distractions',rightText:'Room to think'},quote:{quote:'Look closely. There is always more to see.',attribution:'A supplied speaker'},keyFigure:{value:'42%',label:'A supported measurement'}};
function render(id:string,progress=.7,width=1080,height=1920,variables=sample[id]){
 const template=getTemplate(id)!;
 return renderToStaticMarkup(createElement(template.component,{variables,style:TEST_VIDEO_STYLE,progress,beatIntensity:0,width,height,safeZone:{top:100,left:60,right:60,bottom:Math.round(height*.18)},sceneDuration:template.preferredDuration,isPlaying:false}));
}
describe('eight cinematic templates',()=>{
 it('replaces retired IDs rather than aliasing their old schemas',()=>{
  expect(listTemplates().map(t=>t.id)).toEqual(Object.keys(sample));
  for(const id of ['media','steps','cardList','notification','bigNumber','barChart','ctaLogo','testimonial'])expect(getTemplate(id)).toBeUndefined();
 });
 it('renders both orientations at all meaningful seek positions deterministically',()=>{
  for(const template of listTemplates())for(const [w,h] of [[1080,1920],[1920,1080]])for(const p of [0,.15,.5,.75,1]){
   const html=render(template.id,p,w,h);
   expect(html).not.toMatch(/NaN|Infinity/);expect(html).toContain('style=');expect(render(template.id,p,w,h)).toBe(html);
   if(!['cinemaMedia','mobileMessage'].includes(template.id)){expect(html).toContain('background:#000');expect(html).not.toMatch(/<video|<img/);}
  }
 });
 it('owns a single chapter fade and holds explanatory graphics steadily',()=>{
  expect(getTemplate('chapterTitle')!.usesGlobalTransition).toBe(false);
  expect(render('chapterTitle',0)).toContain('opacity:0');expect(render('chapterTitle',1)).toContain('opacity:0');expect(render('chapterTitle',.5)).toContain('opacity:1');
  for(const id of ['focusCards','editorialTimeline','comparison','quote','keyFigure'])expect(render(id,.8)).toBe(render(id,1));
 });
 it('shows exact evidence without a count-up, repeated label, or extra identity',()=>{
  const value=render('keyFigure',.12);expect(value).toContain('42%');expect(value.match(/A supported measurement/g)).toHaveLength(1);
  const quote=render('quote');expect(quote).toContain('Look closely. There is always more to see.');expect(quote).toContain('A supplied speaker');
  const notification=render('mobileMessage');expect(notification).toContain('Can we talk tomorrow?');expect(notification).not.toMatch(/data-phone-frame|>now<|>Sender</);
  expect(render('comparison')).not.toMatch(/>Before<|>After</);
 });
 it('keeps allowed long copy intact and respects explicit caption insets',()=>{
  const cases:Record<string,Record<string,unknown>>={chapterTitle:{title:'A surprisingly long chapter about the hidden life of our oceans'},focusCards:{items:Array(4).fill('A longer but still permitted explanation of this point')},editorialTimeline:{events:Array.from({length:5},()=>({label:'A longer action in this ordered sequence'}))},quote:{quote:'The detail we notice changes the way we understand the whole story, and careful observation gives us another way to see what is possible.',attribution:'An attributed speaker with a longer role description'},comparison:{leftText:'The old approach leaves many important questions unanswered',rightText:'The new approach provides more room to understand the details'},keyFigure:{value:'123,456,789.01',label:'One supported quantity with its full context'}};
  for(const [id,variables] of Object.entries(cases))for(const [w,h] of [[1080,1920],[1920,1080]]){
   const html=render(id,.7,w,h,variables);expect(html).not.toMatch(/NaN|Infinity/);
   for(const value of Object.values(variables).filter(v=>typeof v==='string'))expect(html).toContain(value);
  }
 });
 it('uses the existing persistent media plane instead of mounting duplicate videos',()=>{
  for(const id of ['cinemaMedia','mobileMessage']){
   const template=getTemplate(id)!;
   const html=renderToStaticMarkup(createElement(ExternalVideoBackdropProvider,{mode:'ready',children:createElement(template.component,{variables:sample[id],style:TEST_VIDEO_STYLE,progress:.5,beatIntensity:0,width:1080,height:1920,safeZone:{top:0,left:0,right:0,bottom:300},isPlaying:true})}));
   expect(html).not.toContain('<video');
  }
 });
 it('installs every source-owned template with complete shared dependencies',()=>{
  const cwd=mkdtempSync(join(tmpdir(),'vanillasky-cinema-'));
  try{
   const ids=Object.keys(sample);expect(addRegistryTemplates({cwd,names:ids}).added.sort()).toEqual([...ids].sort());
   for(const id of ids){const path=join(cwd,`vanillasky/templates/${id}.tsx`);expect(existsSync(path)).toBe(true);expect(readFileSync(path,'utf8')).toContain('defineTemplate');}
   expect(readFileSync(join(cwd,'vanillasky/templates/mobileMessage.tsx'),'utf8')).toContain('__vanillaskyExternalVideoBackdrop');
  }finally{rmSync(cwd,{recursive:true,force:true});}
 });
});
