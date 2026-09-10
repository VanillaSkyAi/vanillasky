import { describe, expect, it, vi } from 'vitest';
import { createVideoChatHandler } from '../src/server/create-video-chat-handler';
import { decodeVideoSse } from '../src/protocol/sse';
import { chatAnswer, chatShot } from './helpers/chat-shot-fixture';
import { compileVisualDirection } from '../src/server/chat-visual-direction';

async function run({ intent = 'explanation', visualStyle, callerLook, mode = 'cinematic', longDirection = false, shotStyles = [undefined], endingStyle, action, visualDirection, prompt = 'Explain how the fox crosses the stream.' }: {intent?: unknown; visualStyle?: unknown; callerLook?: string; mode?: 'cinematic' | 'pexels'; longDirection?: boolean; shotStyles?: unknown[]; endingStyle?: unknown; action?: string; visualDirection?: string; prompt?: string} = {}) {
  const brief = { ...chatAnswer(chatShot('fox jumping', 'The fox clears the stream.'), 'A fox finds a crossing.', 'fox'), intent, visualStyle, visualDirection: longDirection ? 'v'.repeat(600) : visualDirection ?? 'One red fox in a snowy forest; blue and gold palette.' };
  const { ending, ...outline } = brief;
  const streamText = vi.fn(async function* (_context: unknown) {
    yield JSON.stringify(outline) + '\n';
    for (const [index, style] of shotStyles.entries()) {
      yield JSON.stringify({ ...chatShot('fox walking', `The fox takes step ${index + 1}.`), visualStyle: style, ...(longDirection ? {action: 'a'.repeat(600)} : action ? {action} : {}) }) + '\n';
      if (index === 0) yield JSON.stringify({ ...ending, type: 'ending', visualStyle: endingStyle }) + '\n';
    }
    if (!shotStyles.length) yield JSON.stringify({ ...ending, type: 'ending', visualStyle: endingStyle }) + '\n';
  });
  const generateVideo = vi.fn(async (_query: string, _context: unknown) => ({ url: 'https://media.example.test/clip.mp4', type: 'video' as const }));
  const searchMedia = vi.fn(generateVideo.getMockImplementation()!);
  const handler = createVideoChatHandler({ authorize: 'none', heartbeatMs: false, generateText: () => '', streamText, generateVideo, searchMedia });
  const response = await handler(new Request('https://app.example/api/video?action=response', { method: 'POST', body: JSON.stringify({ prompt, mode, ...(callerLook ? {style: {generatedLook: callerLook}} : {}) }) }));
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { streamText, generateVideo, searchMedia, events, brief };
}

describe('shared visual treatment delivery', () => {
  it.each(['explanation', 'practical', 'story', 'comedy', 'imagination'])('defaults each %s shot and ending to photographic with one model stream', async intent => {
    const result = await run({ intent });
    expect(result.streamText).toHaveBeenCalledOnce();
    expect(result.generateVideo).toHaveBeenCalledTimes(2);
    const expected = compileVisualDirection({ intent }).generatedLook;
    for (const [query, context] of result.generateVideo.mock.calls as unknown as Array<[string, { generatedLook: string; scene: { variables: { shotDirection: string } } }]>) {
      expect(query).toMatch(/^fox (walking|jumping)$/);
      expect(context.generatedLook).toBe(expected);
      expect(context.generatedLook.length).toBeLessThanOrEqual(500);
      expect(context.scene.variables.shotDirection).toContain(result.brief.visualDirection);
    }
    const scenes = result.events.flatMap(event => event.type === 'scene.add' ? [event.data.scene] : []);
    expect(scenes.map(scene => scene.narration)).toEqual(['The fox takes step 1.', 'The fox clears the stream.']);
    expect(scenes.every(scene => scene.templateId === 'cinemaMedia')).toBe(true);
    expect(scenes.every(scene => !('generatedLook' in scene.variables) && !('visualStyle' in scene.variables))).toBe(true);
  });
  it('ignores unrequested style tags on the brief, shots and ending', async () => {
    const result = await run({ visualStyle: 'illustrated', shotStyles: ['realistic', 'illustrated', 'unknown'], endingStyle: 'illustrated' });
    expect(result.generateVideo.mock.calls.map(call => (call[1] as {generatedLook: string}).generatedLook)).toEqual(
      Array(4).fill(compileVisualDirection({}).generatedLook));
    expect(result.streamText).toHaveBeenCalledOnce();
  });
  it.each([
    ['Show how the fox moves its legs.', 'A transparent cutaway reveals the leg bones moving within the fox, with natural materials and clear depth.'],
    ['Use watercolor for the first clip only.', 'User-requested watercolor for this clip: a red fox walks toward the stream with soft washes and visible brushwork.'],
  ])('carries clip-specific content without changing the default or the ending: %s', async (prompt, action) => {
    const result = await run({prompt, action});
    expect(result.generateVideo.mock.calls[0]?.[1]).toMatchObject({
      generatedLook: compileVisualDirection({}).generatedLook,
      scene: {variables: {shotDirection: expect.stringContaining(action)}},
    });
    expect(result.generateVideo.mock.calls[1]?.[1]).toMatchObject({generatedLook: compileVisualDirection({}).generatedLook});
    expect((result.generateVideo.mock.calls[1]?.[1] as {scene: {variables: {shotDirection: string}}}).scene.variables.shotDirection).not.toContain(action);
  });
  it('carries an explicitly requested shared aesthetic to body and ending', async () => {
    const requested = 'User-requested watercolor: soft washes, visible brushwork and a red fox.';
    const prompt = 'Use watercolor to explain how the fox crosses the stream.';
    const result = await run({prompt, visualDirection: requested});
    expect(result.streamText.mock.calls[0]?.[0]).toMatchObject({userPrompt: expect.stringContaining(prompt)});
    for (const call of result.generateVideo.mock.calls) expect(call[1]).toMatchObject({
      generatedLook: compileVisualDirection({}).generatedLook,
      scene: {variables: {shotDirection: expect.stringContaining(requested)}},
    });
  });
  it('uses the shared default in an ending-only answer', async () => {
    const result = await run({ shotStyles: [], endingStyle: 'illustrated' });
    expect(result.generateVideo).toHaveBeenCalledOnce();
    expect(result.generateVideo.mock.calls[0]?.[1]).toMatchObject({generatedLook: compileVisualDirection({}).generatedLook});
  });
  it('gives explicit caller look precedence over all shot styles', async () => {
    const explicit = await run({ callerLook: 'Tactile clay stop-motion', shotStyles: ['realistic', 'illustrated'], endingStyle: 'illustrated' });
    expect(explicit.generateVideo).toHaveBeenCalledTimes(3);
    for (const call of explicit.generateVideo.mock.calls) expect(call[1]).toMatchObject({ generatedLook: 'Tactile clay stop-motion' });
    expect(explicit.streamText.mock.calls[0]?.[0]).toMatchObject({ userPrompt: expect.stringContaining('CALLER VISUAL DIRECTION') });
  });
  it('keeps maximum authored direction and action within the provider direction bound', async () => {
    const result = await run({ longDirection: true });
    const context = result.generateVideo.mock.calls[0]![1] as { generatedLook: string; scene: {variables: {shotDirection: string}} };
    expect(context.generatedLook.length).toBeLessThanOrEqual(500);
    expect(context.scene.variables.shotDirection).toContain('v'.repeat(600));
    expect(context.scene.variables.shotDirection).toContain('a'.repeat(600));
    expect(context.scene.variables.shotDirection.length).toBeLessThanOrEqual(1600);
  });
  it('isolates visual styles across interleaved requests to the same handler', async () => {
    let entered = 0;
    let release = () => {};
    const bothBriefs = new Promise<void>(resolve => { release = resolve; });
    const generateVideo = vi.fn(async (_query: string, _context: {generatedLook?: string}) => ({url: 'https://media.example.test/clip.mp4', type: 'video' as const}));
    const streamText = vi.fn(async function* (context: {userPrompt: string}) {
      const explanation = context.userPrompt.includes('Request A');
      const subject = explanation ? 'ocean waves' : 'city running';
      const ending = chatShot(subject, 'This is the complete ending.');
      yield JSON.stringify({ ...chatAnswer(ending), intent: explanation ? 'explanation' : 'practical' }) + '\n';
      if (++entered === 2) release();
      await bothBriefs;
      yield JSON.stringify(chatShot(subject, 'This action develops the answer.')) + '\n';
    });
    const handler = createVideoChatHandler({authorize: 'none', heartbeatMs: false, generateText: () => '', streamText, generateVideo});
    await Promise.all(['Request A', 'Request B'].map(async prompt => {
      const response = await handler(new Request('https://app.example/api/video?action=response', {method: 'POST', body: JSON.stringify({prompt, ...(prompt === 'Request A' ? {style: {generatedLook: 'Watercolor with soft washes.'}} : {})})}));
      for await (const event of decodeVideoSse(response.body!)) void event;
    }));
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(generateVideo).toHaveBeenCalledTimes(4);
    for (const [query, context] of generateVideo.mock.calls) {
      expect(context.generatedLook).toBe(query === 'ocean waves' ? 'Watercolor with soft washes.' : compileVisualDirection({}).generatedLook);
    }
  });
  it('keeps stock queries literal and does not ask stock to apply an automatic rendering style', async () => {
    const result = await run({ mode: 'pexels', intent: 'imagination', shotStyles: ['illustrated'], endingStyle: 'illustrated' });
    expect(result.generateVideo).not.toHaveBeenCalled();
    expect(result.searchMedia).toHaveBeenCalledTimes(2);
    expect(result.searchMedia.mock.calls.map(call => call[0])).toEqual(['fox walking', 'fox jumping']);
    expect(result.searchMedia.mock.calls[0]?.[1]).toMatchObject({ generatedLook: undefined });
  });
});
