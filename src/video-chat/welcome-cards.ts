import type {VideoChatSuggestion} from './types.js';

/** Curated invitation data, shared by the host and local preview. */
export const WELCOME_CARDS: readonly (VideoChatSuggestion & {category: string})[] = [
  {prompt:'Why do cats stare at us?',category:'curiosity',media:{"url": "https://videos.pexels.com/video-files/6131490/6131490-sd_640_360_25fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/6131490/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'Tell me a joke about office life',category:'entertainment',media:{"url": "https://videos.pexels.com/video-files/7438239/7438239-sd_640_338_25fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/7438239/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'Where would you take me in Japan?',category:'explore',media:{"url": "https://videos.pexels.com/video-files/35972506/15252635_360_640_30fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/35972506/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'How do I make better coffee?',category:'practical',media:{"url": "https://videos.pexels.com/video-files/5564283/5564283-sd_640_360_24fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/5564283/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'What would Earth look like without humans?',category:'explore',media:{"url": "https://videos.pexels.com/video-files/28732001/12464538_640_360_30fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/28732001/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'Tell me a short story with a twist',category:'entertainment',media:{"url": "https://videos.pexels.com/video-files/5683159/5683159-sd_640_360_30fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/5683159/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'Why does music give us goosebumps?',category:'curiosity',media:{"url": "https://videos.pexels.com/video-files/6870450/6870450-sd_640_360_30fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/6870450/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
  {prompt:'How can I make my room feel bigger?',category:'practical',media:{"url": "https://videos.pexels.com/video-files/37479012/15875787_360_640_30fps.mp4", "type": "video", "posterUrl": "https://images.pexels.com/videos/37479012/pictures/preview-0.jpg?auto=compress&fit=crop&w=640"}},
];

/** Balance only the curated eight; custom host lists keep their supplied order. */
export function orderWelcomeCards(cards: readonly VideoChatSuggestion[], seed: number): VideoChatSuggestion[] {
  if (cards.length !== WELCOME_CARDS.length || new Set(cards.map(card => card.prompt)).size !== cards.length
    || cards.some(card => !WELCOME_CARDS.some(entry => entry.prompt === card.prompt))) return [...cards];
  let state = seed >>> 0;
  const random = () => {state = (Math.imul(state,1664525)+1013904223) >>> 0; return state / 4294967296;};
  const shuffle = <T,>(values: readonly T[]): T[] => {
    const copy=[...values];
    for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j]!,copy[i]!];}
    return copy;
  };
  const groups=new Map<string,VideoChatSuggestion[]>();
  for(const card of shuffle(cards)){
    const category=WELCOME_CARDS.find(entry=>entry.prompt===card.prompt)!.category;
    const group=groups.get(category)??[];group.push(card);groups.set(category,group);
  }
  const categories=shuffle([...groups.values()]);
  return [...categories.map(group=>group[0]!),...shuffle(categories.flatMap(group=>group.slice(1)))];
}

let pageSeed: number | undefined;

/** A new document gets a fresh order; returning Home keeps this page's order. */
export function welcomeVisitSeed(): number {
  return pageSeed ??= Math.floor(Math.random() * 4294967296);
}
