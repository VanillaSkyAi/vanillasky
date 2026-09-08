import { approvedStockMedia, normalizeIntent } from './approved-stock.mjs';
import { welcomeMedia } from './welcome-media.mjs';

// Topic covers are navigation, not footage proving the follow-up's mechanism.
// Keep this vocabulary separate from the stricter scene-intent catalog.
const covers = [
  { keyword: 'ocean waves', cover: 'wave', aliases: ['wave', 'waves', 'ocean wave', 'breaking waves', 'ocean surf', 'sea waves', 'shallow water'], description: 'Ocean waves, surf, wave energy and why waves break.' },
  { keyword: 'earth moon', cover: 'moon', aliases: ['moon', 'full moon', 'moon surface', 'lunar surface', 'moon orbit'], description: 'Earth’s Moon, lunar rotation and orbit; not other planets or moons.' },
  { keyword: 'atomic particles', cover: 'atom', aliases: ['atom', 'atoms', 'atomic nucleus', 'electrons', 'electron cloud'], description: 'Atoms and their particles; an abstract illustration, not a scientific diagram.' },
  { keyword: 'dinosaur fossils', cover: 'dinosaur', aliases: ['dinosaur', 'dinosaurs', 'dinosaur skeleton', 'dinosaur extinction', 'fossil skeleton'], description: 'Dinosaurs, fossils and extinction; museum skeleton footage, not a living animal or an impact.' },
];

export function suggestionMedia(query) {
  const key = normalizeIntent(query);
  const cover = covers.find(entry => entry.keyword === key || entry.aliases.includes(key));
  return cover ? welcomeMedia(cover.cover) : approvedStockMedia(key, 'landscape');
}

export function suggestionMediaInstructions() {
  return [
    'For suggestion card thumbnails, use the following reviewed topic covers when relevant. These are illustrative navigation covers, not evidence of the answer’s mechanism.',
    ...covers.map(({ keyword, description }) => `- keyword: "${keyword}" — ${description}`),
    'Copy the matching keyword exactly. Multiple follow-ups about one topic may share its cover. Never force an unrelated topic into this list; otherwise use the requested concrete subject keyword.',
  ].join('\n');
}
