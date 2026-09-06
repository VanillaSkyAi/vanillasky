import { describe, expect, it } from 'vitest';
import { createTemplateSystemPrompt } from '../src/visual-system/catalog/prompt';
import { createVideoChatResponseInstructions } from '../src/server/video-chat-prompts';
import type { SceneTemplateMetadata } from '../src/visual-system/catalog/catalog-types';

const definitions: SceneTemplateMetadata[] = [{
 id:'comparison', usesGlobalTextEffect:false,usesGlobalTransition:false,usesGlobalBackgroundEffect:false,
 jobs:['proof'],useWhen:'Two grounded alternatives clarify a contrast.',avoidWhen:'Never invent an improvement.',
 schema:{type:'object',properties:{leftText:{type:'string',description:'First alternative, two to six words.',examples:['Always available.'],maxLength:60},rightText:{type:'string',description:'Second alternative, two to six words.',maxLength:60}},required:['leftText','rightText'],additionalProperties:false},
}, {
 id:'cinemaMedia',usesGlobalTextEffect:false,usesGlobalTransition:false,usesGlobalBackgroundEffect:false,
 jobs:['atmosphere','payoff'],schema:{type:'object',properties:{mediaKeyword:{type:'string',format:'stock-media-keyword'},mediaUrl:{type:'string',format:'uri'},mediaPoster:{type:'string',format:'uri'},mediaType:{type:'string',enum:['photo','video']},mediaSource:{type:'string',enum:['generate','stock']}},additionalProperties:false}
}];

describe('cinematic model-facing contract',()=>{
 it('retains disqualifiers and field purpose instead of dropping the director instructions',()=>{
  const prompt=createTemplateSystemPrompt({kit:{listTemplateMetadata:()=>definitions},mediaResolverAvailable:true,mediaOnFirstScene:true,narrate:true});
  expect(prompt).toContain('Never invent an improvement.');
  expect(prompt).toContain('First alternative, two to six words.');
  expect(prompt).toContain('Always available.');
  expect(prompt).toContain('mediaKeyword');
  expect(prompt).not.toContain('mediaType=gradient');
  expect(prompt).not.toContain('confetti');
  expect(prompt).not.toContain('emojiBurst');
 });
 it('plans narration and early footage without forcing five scenes or an all-media slideshow',()=>{
  const prompt=createVideoChatResponseInstructions(true,false,2);
  expect(prompt).toContain('visible change');
  expect(prompt).toContain('narration');
  expect(prompt).not.toContain('mediaSource');
  expect(prompt).not.toMatch(/exactly (?:five|5|four) (?:additional )?scenes|Use the media template for every/);
  expect(prompt).not.toContain('milestone');
  expect(prompt).not.toContain('broader real-world subject');
 });
});
