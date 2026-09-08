import test from 'node:test';
import assert from 'node:assert/strict';
import { welcomeMedia } from '../../functions/_video-chat/welcome-media.mjs';
import { approvedStockMedia } from '../../functions/_video-chat/approved-stock.mjs';

test('fixed welcome topics resolve reviewed covers without broadening scene matches', () => {
  for (const [query, id] of [['moon', '7615707'], ['wave', '18680290'], ['dinosaur', '19014505']]) {
    assert.match(welcomeMedia(query).url, new RegExp(id));
    assert.equal(approvedStockMedia(query), null);
  }
  for (const query of ['moon orbit', 'dinosaur extinction', 'constructor', '', null]) {
    assert.equal(welcomeMedia(query), null);
  }
});

test('atom welcome uses only the reviewed illustrative still, never scene footage', () => {
  const media = welcomeMedia('atom');
  assert.equal(media.type, 'image');
  assert.match(media.url, /29352532.*w=800/);
  assert.equal(approvedStockMedia('atom'), null);
});
