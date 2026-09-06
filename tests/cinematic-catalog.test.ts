import { describe, expect, it } from 'vitest';
import { BUILTIN_PLAYER_KIT } from '../src/visual-system/catalog/builtin-player';
import { supportsExternalVideoBackdrop } from '../src/visual-system/catalog/video-backdrop-capability';
import { BUILTIN_TEMPLATE_MANIFEST } from '../src/visual-system/catalog/builtin-manifest';

describe('cinematic template contract', () => {
  it('marks only media lazy wrappers before importing any scene',()=>{
    expect(BUILTIN_PLAYER_KIT.templates.filter(supportsExternalVideoBackdrop).map(t=>t.id)).toEqual(['cinemaMedia','editorialTimeline','mobileMessage','comparison','quote','keyFigure']);
  });
  it('ships exactly the approved seven, without retired promotional scenes', () => {
    expect(BUILTIN_TEMPLATE_MANIFEST.map(entry => entry.id)).toEqual(['cinemaMedia','chapterTitle','editorialTimeline','mobileMessage','comparison','quote','keyFigure']);
  });
  it('allows optional relevant media on editorial overlays', () => {
    expect(BUILTIN_TEMPLATE_MANIFEST.filter(entry => entry.schema.properties.mediaKeyword).map(entry => entry.id)).toEqual(['cinemaMedia','editorialTimeline','mobileMessage','comparison','quote','keyFigure']);
  });
  it('removes focus cards and retains concise timeline and figure fields', () => {
    const schemas = Object.fromEntries(BUILTIN_TEMPLATE_MANIFEST.map(entry=>[entry.id,entry.schema]));
    expect(schemas.focusCards).toBeUndefined();
    expect(Object.keys(schemas.editorialTimeline.properties.events.items!.properties!)).toEqual(['label']);
    expect(schemas.keyFigure.required).toEqual(['value','label']);
  });
});
