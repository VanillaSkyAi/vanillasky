/**
 * A visually reviewed contract, not a search synonym list.
 * @typedef {Object} ApprovedStock
 * @property {string} id Pexels asset id.
 * @property {'image'|'video'} type
 * @property {string[]} queries Exact normalized intents this asset honestly illustrates.
 * @property {('landscape'|'portrait'|'square')[]} orientations Reviewed crops.
 * @property {'landscape'|'portrait'} [sourceOrientation] Native orientation for crop-approved renditions.
 * @property {string[]} [centerCrops] Non-native orientations explicitly reviewed with centered object-fit cover.
 * @property {string} description What is actually visible, including important exclusions.
 * @property {string} reviewedAt ISO review date.
 * @property {string} reviewVersion Changes whenever pixels/crops/approved intents change.
 * @property {{url:string,type:"image"|"video",posterUrl?:string}} [media] Fixed reviewed rendition.
 */

// Reviewed literal imagery and explicitly listed centered crops only. Never infer a location, species,
// historical event or scientific mechanism from these atmospheric shots.
// Review evidence: tests/fixtures/cinematic-media/REVIEW.md.
/** @type {readonly ApprovedStock[]} */
export const approvedStock = Object.freeze([
  { id: '3184465', type: 'image', media: { type: 'image', url: 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=1280' }, queries: ['handshake across desk', 'people shaking hands'], orientations: ['landscape'], description: 'Two people shaking hands across a desk, with a laptop and coffee cups. Does not establish their identities, a signed contract, business success or a specific company.', reviewedAt: '2026-09-06', reviewVersion: 'image-1' },
  { id: '18680290', media: { type: 'video', url: 'https://videos.pexels.com/video-files/18680290/18680290-hd_1920_1080_25fps.mp4', posterUrl: 'https://images.pexels.com/videos/18680290/big-wave-blue-break-breaking-18680290.jpeg?auto=compress&cs=tinysrgb&w=1200' }, type: 'video', queries: ['breaking ocean wave', 'ocean wave breaking', 'ocean surf foam'], orientations: ['landscape', 'portrait', 'square'], centerCrops: ['portrait', 'square'], description: 'Blue ocean wave breaking into white foam. No demonstrated pollution, tsunami, geographic location or underwater mechanism.', reviewedAt: '2026-09-06', reviewVersion: 'crops-3' },
  { id: '7615707', media: { type: 'video', url: 'https://videos.pexels.com/video-files/7615707/7615707-hd_1920_1080_30fps.mp4', posterUrl: 'https://images.pexels.com/videos/7615707/aircraft-alien-astronaut-astronautics-7615707.jpeg?auto=compress&cs=tinysrgb&w=1200' }, type: 'video', queries: ['full moon night sky', 'orange full moon'], orientations: ['landscape'], description: 'Orange full Moon against black sky, subtle apparent motion. No spacecraft, surface landing, orbital diagram or eclipse claim.', reviewedAt: '2026-09-06', reviewVersion: 'frames-1' },
  { id: '6877264', type: 'video', media: { type: 'video', url: 'https://videos.pexels.com/video-files/6877264/6877264-hd_720_1280_30fps.mp4', posterUrl: 'https://images.pexels.com/videos/6877264/pexels-photo-6877264.jpeg?auto=compress&cs=tinysrgb&w=720' }, queries: ['full moon night sky', 'moon against black sky'], orientations: ['portrait'], description: 'Complete gray Moon disc against black sky with slight drift. Native portrait framing; not an orbital diagram, demonstration of rotation, eclipse or landing.', reviewedAt: '2026-09-06', reviewVersion: 'frames-1' },
  { id: '11335959', media: { type: 'video', url: 'https://videos.pexels.com/video-files/11335959/11335959-hd_1920_1080_30fps.mp4', posterUrl: 'https://images.pexels.com/videos/11335959/pexels-photo-11335959.jpeg?auto=compress&cs=tinysrgb&w=1200' }, type: 'video', queries: ['cloud timelapse', 'white clouds blue sky'], orientations: ['landscape', 'portrait', 'square'], centerCrops: ['portrait', 'square'], description: 'White clouds moving across a blue sky. No storm, pollution, climate trend or named place.', reviewedAt: '2026-09-06', reviewVersion: 'crops-3' },
  { id: '19014505', media: { type: 'video', url: 'https://videos.pexels.com/video-files/19014505/19014505-hd_1920_1080_24fps.mp4', posterUrl: 'https://images.pexels.com/videos/19014505/animal-bone-bones-built-structure-19014505.jpeg?auto=compress&cs=tinysrgb&w=1200' }, type: 'video', queries: ['museum skeleton display', 'museum fossil skeleton'], orientations: ['landscape', 'portrait', 'square'], centerCrops: ['portrait', 'square'], description: 'Camera tilts upward along a large mounted skeleton in a museum. Not a living animal, extinction event, named species or verified museum identity.', reviewedAt: '2026-09-06', reviewVersion: 'crops-3' },
  {"id": "7192325", "type": "video", "media": {"type": "video", "url": "https://videos.pexels.com/video-files/7192325/7192325-hd_1920_1080_25fps.mp4"}, "queries": ["writing in a notebook", "hand writing notes"], "orientations": ["landscape", "portrait", "square"], "centerCrops": ["portrait", "square"], "description": "Close view of a hand writing in an open notebook at a desk. The writing is not legible; not proof of any particular plan, productivity outcome or person.", "reviewedAt": "2026-09-06", "reviewVersion": "crops-1"},
  {"id": "11265968", "type": "video", "media": {"type": "video", "url": "https://videos.pexels.com/video-files/11265968/11265968-hd_1920_1080_25fps.mp4"}, "queries": ["sunlight through forest trees", "sunlit forest"], "orientations": ["landscape", "portrait", "square"], "centerCrops": ["portrait", "square"], "description": "Sunlight and lens flare move through leafy forest trees. An atmospheric setting, not evidence of a named forest, species or environmental trend.", "reviewedAt": "2026-09-06", "reviewVersion": "crops-1"},
  {"id": "7691987", "sourceOrientation": "portrait", "type": "video", "media": {"type": "video", "url": "https://videos.pexels.com/video-files/7691987/7691987-hd_1080_2048_30fps.mp4"}, "queries": ["cat playing outdoors", "cat reaching for toy"], "orientations": ["portrait", "square"], "centerCrops": ["square"], "description": "A white and brown cat looks and reaches toward a dangling toy outdoors. Not a specific named pet, breed, emotion or trained behavior.", "reviewedAt": "2026-09-06", "reviewVersion": "crops-1"},
  {"id": "8988497", "type": "video", "media": {"type": "video", "url": "https://videos.pexels.com/video-files/8988497/8988497-hd_1920_1080_30fps.mp4"}, "queries": ["watering a potted plant", "watering houseplant"], "orientations": ["landscape", "square"], "centerCrops": ["square"], "description": "Hands tilt a metal watering can over a potted leafy plant by a window. Does not demonstrate checking soil, drainage or an appropriate watering amount.", "reviewedAt": "2026-09-06", "reviewVersion": "crops-1"},
  {"id": "8988497", "type": "video", "media": {"type": "video", "url": "https://videos.pexels.com/video-files/8988497/8988497-hd_1920_1080_30fps.mp4"}, "queries": ["potted plant by window"], "orientations": ["portrait"], "centerCrops": ["portrait"], "description": "Portrait crop shows a leafy potted plant by a window. The watering action is cropped out; use only for the plant and its setting, never a watering demonstration.", "reviewedAt": "2026-09-06", "reviewVersion": "crops-1"},
]);

export function normalizeIntent(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

export function matchingStock(query, orientation, index = approvedStock, preferredType = 'any') {
  const normalized = normalizeIntent(query);
  if (!normalized || normalized.length > 100) return [];
  return index.filter(asset => /^\d+$/.test(asset.id) &&
    ['image', 'video'].includes(asset.type) && asset.reviewedAt && asset.reviewVersion &&
    asset.description && Array.isArray(asset.queries) && Array.isArray(asset.orientations) &&
    asset.orientations.includes(orientation) &&
    (preferredType === 'any' || preferredType === asset.type) &&
    asset.queries.some(intent => normalizeIntent(intent) === normalized));
}


// Reviewed immutable fixture identity can be reused without a search/provider call.
// Scene footage requires exact intent and crop approval.
export function approvedStockMedia(query, orientation = 'landscape', index = approvedStock, preferredType = 'any') {
  const candidate = matchingStock(query, orientation, index, preferredType).find(asset => asset.media);
  return candidate ? { ...candidate.media } : null;
}
