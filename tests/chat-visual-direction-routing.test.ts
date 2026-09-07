import { describe, expect, it, vi } from 'vitest';
import { createVideoChatHandler } from '../src/server/create-video-chat-handler';
import { decodeVideoSse } from '../src/protocol/sse';
import { chatAnswer, chatShot } from './helpers/chat-shot-fixture';
import { compileVisualDirection } from '../src/server/chat-visual-direction';

async function run({ intent = 'explanation', visualStyle, callerLook, mode = 'cinematic', longDirection = false }: {intent?: unknown; visualStyle?: unknown; callerLook?: string; mode?: 'cinematic' | 'pexels'; longDirection?: boolean} = {}) {
  const brief = { ...chatAnswer(chatShot('fox jumping', 'The fox clears the stream.'), 'A fox finds a crossing.', 'fox'), intent, visualStyle, visualDirection: longDirection ? 'v'.repeat(600) : 'One red fox in a snowy forest; blue and gold palette.' };
  const streamText = vi.fn(async function* (_context: unknown) {
    yield JSON.stringify(brief) + '\n';
    yield JSON.stringify({ ...chatShot('fox walking', 'The fox walks toward the stream.'), ...(longDirection ? {action: 'a'.repeat(600)} : {}) }) + '\n';
  });
  const generateVideo = vi.fn(async (_query: string, _context: unknown) => ({ url: 'https://media.example.test/clip.mp4', type: 'video' as const }));
  const searchMedia = vi.fn(generateVideo.getMockImplementation()!);
  const handler = createVideoChatHandler({ authorize: 'none', heartbeatMs: false, generateText: () => '', streamText, generateVideo, searchMedia });
  const response = await handler(new Request('https://app.example/api/video?action=response', { method: 'POST', body: JSON.stringify({ prompt: 'Explain how the fox crosses the stream.', mode, ...(callerLook ? {style: {generatedLook: callerLook}} : {}) }) }));
  const events = []; for await (const event of decodeVideoSse(response.body!)) events.push(event);
  return { streamText, generateVideo, searchMedia, events, brief };
}

describe('brief-driven visual style delivery', () => {
  it.each(['explanation', 'practical', 'story', 'comedy', 'imagination'])('uses one %s brief and consistent body/ending look with one model stream', async intent => {
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
    expect(scenes.map(scene => scene.narration)).toEqual(['The fox walks toward the stream.', 'The fox clears the stream.']);
    expect(scenes.every(scene => scene.templateId === 'cinemaMedia')).toBe(true);
    expect(scenes.every(scene => !('generatedLook' in scene.variables) && !('visualStyle' in scene.variables))).toBe(true);
  });
  it('respects a planned style override and explicit caller look precedence', async () => {
    const planned = await run({ intent: 'practical', visualStyle: 'illustrated' });
    expect(planned.generateVideo.mock.calls[0]?.[1]).toMatchObject({ generatedLook: compileVisualDirection({ visualStyle: 'illustrated' }).generatedLook });
    const explicit = await run({ callerLook: 'Tactile clay stop-motion', visualStyle: 'realistic' });
    expect(explicit.generateVideo.mock.calls[0]?.[1]).toMatchObject({ generatedLook: 'Tactile clay stop-motion' });
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
      yield JSON.stringify({ ...chatAnswer(chatShot(subject, 'This is the complete ending.')), intent: explanation ? 'explanation' : 'practical' }) + '\n';
      if (++entered === 2) release();
      await bothBriefs;
      yield JSON.stringify(chatShot(subject, 'This action develops the answer.')) + '\n';
    });
    const handler = createVideoChatHandler({authorize: 'none', heartbeatMs: false, generateText: () => '', streamText, generateVideo});
    await Promise.all(['Request A', 'Request B'].map(async prompt => {
      const response = await handler(new Request('https://app.example/api/video?action=response', {method: 'POST', body: JSON.stringify({prompt})}));
      for await (const event of decodeVideoSse(response.body!)) void event;
    }));
    expect(streamText).toHaveBeenCalledTimes(2);
    expect(generateVideo).toHaveBeenCalledTimes(4);
    for (const [query, context] of generateVideo.mock.calls) {
      expect(context.generatedLook).toBe(compileVisualDirection({intent: query === 'ocean waves' ? 'explanation' : 'practical'}).generatedLook);
    }
  });
  it('keeps stock queries literal and does not ask stock to apply an automatic rendering style', async () => {
    const result = await run({ mode: 'pexels', intent: 'imagination', visualStyle: 'illustrated' });
    expect(result.generateVideo).not.toHaveBeenCalled();
    expect(result.searchMedia).toHaveBeenCalledTimes(2);
    expect(result.searchMedia.mock.calls.map(call => call[0])).toEqual(['fox walking', 'fox jumping']);
    expect(result.searchMedia.mock.calls[0]?.[1]).toMatchObject({ generatedLook: undefined });
  });
});
