import { describe, expect, it } from 'vitest';
import { BUILTIN_PLAYER_KIT } from '../src/visual-system/catalog/builtin-player';
import { supportsExternalVideoBackdrop } from '../src/visual-system/catalog/video-backdrop-capability';
import { BUILTIN_TEMPLATE_MANIFEST } from '../src/visual-system/catalog/builtin-manifest';

describe('cinematic template contract', () => {
  it('marks only media lazy wrappers before importing any scene',()=>{
    expect(BUILTIN_PLAYER_KIT.templates.filter(supportsExternalVideoBackdrop).map(t=>t.id)).toEqual(['cinemaMedia','mobileMessage']);
  });
  it('ships exactly the approved eight, without retired promotional scenes', () => {
    expect(BUILTIN_TEMPLATE_MANIFEST.map(entry => entry.id)).toEqual(['cinemaMedia','chapterTitle','focusCards','editorialTimeline','mobileMessage','comparison','quote','keyFigure']);
  });
  it('reserves media contracts for full-bleed and Reach out', () => {
    expect(BUILTIN_TEMPLATE_MANIFEST.filter(entry => entry.schema.properties.mediaKeyword).map(entry => entry.id)).toEqual(['cinemaMedia','mobileMessage']);
  });
  it('contains no headings or numbering in focus cards and no timeline dates', () => {
    const schemas = Object.fromEntries(BUILTIN_TEMPLATE_MANIFEST.map(entry=>[entry.id,entry.schema]));
    expect(Object.keys(schemas.focusCards.properties)).toEqual(['items']);
    expect(Object.keys(schemas.editorialTimeline.properties.events.items!.properties!)).toEqual(['label']);
    expect(Object.keys(schemas.keyFigure.properties)).toEqual(['value','label']);
  });
});
