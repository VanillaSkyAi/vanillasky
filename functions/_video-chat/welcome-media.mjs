import { approvedStockMedia, normalizeIntent } from './approved-stock.mjs';

// Topic covers for the four fixed welcome prompts, not scene search synonyms.
// A Moon or museum skeleton illustrates the topic, not its scientific mechanism.
const welcomeIntents = Object.freeze({
  moon: 'full moon night sky',
  wave: 'breaking ocean wave',
  dinosaur: 'museum skeleton display',
  'cloud timelapse': 'cloud timelapse',
});

export function welcomeMedia(query) {
  const key = normalizeIntent(query);
  // Visually reviewed 2026-09-06: abstract blue particle cloud on black.
  // An illustrative topic cover only, never a literal atom diagram or evidence.
  // Only the still was reviewed; deliberately do not serve its source video.
  if (key === 'atom') return {
    type: 'image',
    url: 'https://images.pexels.com/videos/29352532/pexels-photo-29352532.jpeg?auto=compress&cs=tinysrgb&fit=crop&w=800',
  };
  const intent = Object.hasOwn(welcomeIntents, key) ? welcomeIntents[key] : null;
  return intent ? approvedStockMedia(intent, 'landscape') : null;
}
