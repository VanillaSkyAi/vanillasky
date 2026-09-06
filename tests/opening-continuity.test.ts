import {describe,expect,it} from 'vitest';
import {continueAfterOpening} from '../src/server/opening-continuity';
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
});
