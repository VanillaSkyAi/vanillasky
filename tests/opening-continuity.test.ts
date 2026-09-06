import {describe,expect,it} from 'vitest';
import {continueAfterOpening,createOpeningContinuation} from '../src/server/opening-continuity';
const hook='The Moon always shows the same face.';
describe('opening continuity',()=>{
 it('strips only a complete repeated sentence and preserves the continuation',()=>{
  expect(continueAfterOpening(`${hook} Its rotation matches its orbit.`,[hook])).toBe('Its rotation matches its orbit.');
  expect(continueAfterOpening('THE MOON always shows the same face!',[hook])).toBe('');
  expect(continueAfterOpening('The Moon always shows the same face because it rotates once per orbit.',[hook])).toContain('The Moon');
  expect(continueAfterOpening('The Moon does not always show the same face.',[hook])).toContain('does not');
  expect(continueAfterOpening('The moon looks unchanged from Earth.',[hook])).toBe('The moon looks unchanged from Earth.');
  expect(continueAfterOpening('See the Moon. It turns.', ['See the Moon.'])).toBe('See the Moon. It turns.');
 });
 it('removes hook and first-shot repetitions without touching later callbacks',()=>{
  const continuation=createOpeningContinuation(hook);
  continuation.remember('Its rotation matches its orbit around Earth.');
  const scene=(narration:string)=>JSON.stringify({type:'scene.add',scene:{templateId:'cinemaMedia',narration,variables:{},timing:{}}});
  expect(continuation.line(scene(hook))).toBeNull();
  expect(continuation.line(scene('Its rotation matches its orbit around Earth.'))).toBeNull();
  expect(JSON.parse(continuation.line(scene('Its rotation matches its orbit around Earth. That synchronization developed over time.'))!).scene.narration).toBe('That synchronization developed over time.');
  expect(continuation.line(scene(hook))).toBe(scene(hook));
 });
 it('preserves unique graphic evidence and the closer',()=>{
  const line=JSON.stringify({type:'scene.add',scene:{templateId:'keyFigure',variables:{value:'27.3',label:'Days per rotation'},narration:hook}});
  expect(createOpeningContinuation(hook).line(line)).toBe(line);
  const closer=JSON.stringify({type:'scene.add',placement:'closer',scene:{templateId:'cinemaMedia',narration:hook}});
  expect(createOpeningContinuation(hook).line(closer)).toBe(closer);
 });
 it('passes malformed lines through to existing protocol validation',()=>{
  for(const line of ['null','invalid','{"type":"plan.complete"}'])expect(createOpeningContinuation(hook).line(line)).toBe(line);
 });
});

describe('opening fallback copy continuity',()=>{
 it('uses a complete short new narration for an exactly repeated fallback',()=>{
  const continuation=createOpeningContinuation(hook);
  expect(continuation.copy(hook,'Its rotation matches its orbit.')).toBe('Its rotation matches its orbit.');
  const raw=JSON.stringify({type:'scene.add',scene:{templateId:'cinemaMedia',narration:`${hook} Its rotation takes 27.3 days.`,variables:{fallbackText:hook}}});
  const scene=JSON.parse(continuation.line(raw)!).scene;
  expect(scene.narration).toBe('Its rotation takes 27.3 days.');
  expect(scene.variables.fallbackText).toBe('Its rotation takes 27.3 days.');
 });
 it('updates an exact repeated chapter title even if narration already advances',()=>{
  const raw=JSON.stringify({type:'scene.add',scene:{templateId:'chapterTitle',narration:'Its rotation matches its orbit.',variables:{title:hook}}});
  expect(JSON.parse(createOpeningContinuation(hook).line(raw)!).scene.variables.title).toBe('Its rotation matches its orbit.');
 });
 it('never truncates a long fact or replaces independently authored copy',()=>{
  const continuation=createOpeningContinuation(hook);
  const long='Its rotation takes 27.3 days relative to distant stars, not the changing position of the Sun.';
  expect(continuation.copy(hook,long)).toBe(hook);
  expect(continuation.copy('The lunar rotation period','Its rotation takes 27.3 days.')).toBe('The lunar rotation period');
  expect(continuation.copy(hook,'Its rotation takes 27.3')).toBe(hook);
 });
});
