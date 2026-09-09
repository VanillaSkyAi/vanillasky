import { expect, it } from 'vitest';
import { initialState, reducer, type VideoChatTurn } from '../src/video-chat/session-state';
import type { Video } from '../src/protocol/types';

it('preserves a caption through first player preparation but resets it for replay and history navigation', () => {
  const video: Video = { schemaVersion: '0.2', style: {}, scenes: [] };
  const turn: VideoChatTurn = { id: 'one', prompt: 'A topic', mode: 'cinematic', completed: false, orientation: 'landscape', fixedOrientation: true, suggestions: [] };
  const initial = initialState(true);
  let state = reducer(initial, { type: 'start', turn });
  expect(state.captionKey).not.toBe(initial.captionKey);
  const openingKey = state.captionKey;
  state = reducer(state, { type: 'opening-start', id: turn.id, line: 'The same complete opening.' });
  state = reducer(state, { type: 'opening-end', id: turn.id });
  state = reducer(state, { type: 'player', id: turn.id, stream: { async *[Symbol.asyncIterator]() {} } });
  expect(state.captionKey).toBe(openingKey);
  state = reducer(state, { type: 'complete', id: turn.id, video, suggestions: [] });
  state = reducer(state, { type: 'replay' });
  expect(state.captionKey).not.toBe(openingKey);
  expect(state.muted).toBe(true);
  const replayKey = state.captionKey;
  state = reducer(state, { type: 'select', id: turn.id });
  expect(state.captionKey).not.toBe(replayKey);
  const selectedKey = state.captionKey;
  state = reducer(state, { type: 'restore', turns: state.turns });
  expect(state.captionKey).not.toBe(selectedKey);
});
