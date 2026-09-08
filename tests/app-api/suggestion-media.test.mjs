import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggestionMedia, suggestionMediaInstructions } from '../../functions/_video-chat/suggestion-media.mjs';
import { approvedStockMedia } from '../../functions/_video-chat/approved-stock.mjs';

test('follow-up topic covers resolve without admitting those keywords as scene evidence', () => {
  for (const [keyword, id] of [['ocean waves','18680290'], ['shallow water','18680290'], ['earth moon','7615707'], ['atomic particles','29352532'], ['dinosaur fossils','19014505']]) {
    assert.match(suggestionMedia(keyword).url, new RegExp(id));
    assert.equal(approvedStockMedia(keyword), null);
  }
  assert.equal(suggestionMedia('atomic particles').type, 'image');
  for (const keyword of ['tsunami japan', 'radio waves', 'moon of jupiter', 'earthquake', 'unknown', 'sound waves']) assert.equal(suggestionMedia(keyword), null);
  assert.match(suggestionMediaInstructions(), /ocean waves/);
});
