import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATE_SCHEMAS as schemas } from '../src/visual-system/scene-templates/schemas';
describe('cinematic schemas',()=>{
 it('accepts pending intent or resolved media without permitting gradient mode',()=>{
  for(const id of ['cinemaMedia','mobileMessage'] as const){
   if(id==='cinemaMedia')expect(schemas[id]['x-vanillasky'].requiredAnyOf).toEqual([['mediaKeyword','mediaUrl']]);
   expect(schemas[id].properties.mediaType.enum).toEqual(['photo','video']);
   expect(schemas[id].properties.mediaKeyword.format).toBe('stock-media-keyword');
   expect(schemas[id].properties.mediaPoster.format).toBe('uri');
  }
 });
 it('keeps optional generation direction separate from the bounded stock query',()=>{
  for(const id of ['cinemaMedia','mobileMessage'] as const){
   expect(schemas[id].properties).toHaveProperty('shotDirection', {
    type: 'string', maxLength: 220,
    description: 'Optional action, framing and continuity for generation. Preserve the subject; do not request rendered text.',
   });
   expect(schemas[id].required).not.toContain('shotDirection');
   expect(schemas[id].properties.mediaKeyword.maxLength).toBe(80);
   expect(schemas[id].properties.mediaKeyword.format).toBe('stock-media-keyword');
  }
 });
 it('never inserts factual defaults into an absent quotation or statistic',()=>{
  expect(schemas.quote.properties.quote).not.toHaveProperty('default');
  expect(schemas.quote.properties.attribution).not.toHaveProperty('default');
  expect(schemas.keyFigure.properties.value).not.toHaveProperty('default');
  expect(schemas.quote.properties.quote.format).toBe('grounded-quote');
  expect(schemas.keyFigure.properties.value.format).toBe('grounded-stat');
 });
 it('requires whole messages but excludes sender and time inputs',()=>{
  expect(schemas.mobileMessage.required).toEqual(['message']);
  expect(schemas.mobileMessage.properties).not.toHaveProperty('sender');
  expect(schemas.mobileMessage.properties).not.toHaveProperty('time');
 });
});
