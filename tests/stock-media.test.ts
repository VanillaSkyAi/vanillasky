import {describe,it,expect,vi,afterEach} from 'vitest';
import {findStockFootage} from '../starters/video-chat/stock';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const video=(id:number,slug:string,width=1280,height=720)=>({id,url:`https://www.pexels.com/video/${slug}-${id}/`,image:'https://images.pexels.com/poster.jpg',video_files:[{link:`https://videos.pexels.com/${id}.mp4`,width,height,file_type:'video/mp4'}]});
describe('Pexels starter search',()=>{
 it('searches beyond a curated index and caches only relevant usable footage',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');
  const fetcher=vi.fn(async(_input: unknown)=>new Response(JSON.stringify({videos:[video(1,'a-cat'),video(2,'golf-grip')]})));vi.stubGlobal('fetch',fetcher);
  const signal=new AbortController().signal;
  expect(await findStockFootage('golf grip','landscape',signal)).toMatchObject({url:'https://videos.pexels.com/2.mp4',type:'video'});
  expect(await findStockFootage('golf grip','landscape',signal)).toMatchObject({url:'https://videos.pexels.com/2.mp4'});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('per_page=12');
 });
 it('keeps the relevant subject when only a different orientation is available',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({videos:[video(3,'robot-garden',1280,720),video(4,'cat',720,1280)]})));
  expect(await findStockFootage('robot garden','portrait',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/3.mp4'});
 });
 it('honors cancellation and missing credentials',async()=>{
  await expect(findStockFootage('ocean wave','landscape',AbortSignal.abort())).rejects.toThrow();
  vi.stubEnv('PEXELS_API_KEY','');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await findStockFootage('ocean wave','landscape',new AbortController().signal)).toBeNull();expect(fetcher).not.toHaveBeenCalled();
 });
 it('accepts the documented numeric video URL without requiring editorial metadata',async()=>{
  // Pexels Video Resource: numeric URL, empty tags, no title.
  const resource={...video(2499611,'',720,1280),url:'https://www.pexels.com/video/2499611/',tags:[]};
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>Response.json({videos:[resource,video(50,'',720,1280)]}));
  expect(await findStockFootage('forest sunlight','portrait',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/2499611.mp4'});
 });
 it('ranks positive metadata above unknown search relevance without a majority threshold',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>Response.json({videos:[
   {...video(51,''),url:'https://www.pexels.com/video/51/'},video(52,'ocean'),video(53,'cat')
  ]}));
  expect(await findStockFootage('breaking ocean wave foam','landscape',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/52.mp4'});
 });
 it('keeps weaker descriptive metadata as a provider-ranked illustration',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>Response.json({videos:[
   {...video(54,''),url:'https://www.pexels.com/video/54/',title:'A resting cat',tags:['kitten']}
  ]}));
  expect(await findStockFootage('mountain skiing','landscape',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/54.mp4'});
 });

 it('keeps URL and rendition validation when relevance is unknown',async()=>{
  const numeric={...video(61,''),url:'https://www.pexels.com/video/61/'};
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>Response.json({videos:[
   {...numeric,url:'https://pexels.com.example/video/61/'},
   {...numeric,video_files:[{link:'https://example.com/clip.mp4',width:1280,height:720,file_type:'video/mp4'}]},
   {...numeric,video_files:[{link:'https://videos.pexels.com/tiny.mp4',width:320,height:180,file_type:'video/mp4'}]},
   {...video(62,'',720,1280),url:'https://www.pexels.com/video/62/'},
   {...video(63,''),url:'https://www.pexels.com/video/63/'}
  ]}));
  expect(await findStockFootage('city lights','landscape',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/63.mp4'});
 });

});

it('keeps essential subjects, exclusions and hint cache policies distinct',async()=>{
 vi.stubEnv('PEXELS_API_KEY','hint-fixture');
 const fetcher=vi.fn(async()=>Response.json({videos:[video(80,'man-beach'),video(81,'dog-running-beach')]}));vi.stubGlobal('fetch',fetcher);
 const signal=new AbortController().signal;
 expect(await findStockFootage('beach','landscape',signal,{subject:'dog'})).toMatchObject({url:'https://videos.pexels.com/81.mp4'});
 expect(await findStockFootage('beach','landscape',signal,{subject:'dog'})).toMatchObject({url:'https://videos.pexels.com/81.mp4'});
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(await findStockFootage('beach','landscape',signal,{subject:'cat'})).toMatchObject({url:'https://videos.pexels.com/80.mp4'});
 expect(await findStockFootage('beach','landscape',signal,{subject:'dog',exclude:['running']})).toMatchObject({url:'https://videos.pexels.com/80.mp4'});
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it('ranks subject and activity metadata before unknown without claiming depiction proof',async()=>{
 vi.stubEnv('PEXELS_API_KEY','hint-fixture');vi.stubGlobal('fetch',async()=>Response.json({videos:[
  {...video(82,''),url:'https://www.pexels.com/video/82/'},video(83,'golfer-miniature-golf-putting'),video(84,'golfer-full-swing-golf-club')
 ]}));
 expect(await findStockFootage('golf swing','landscape',new AbortController().signal,{subject:'golfer',activity:'full swing',equipment:'golf club',exclude:['miniature golf','putting']})).toMatchObject({url:'https://videos.pexels.com/84.mp4'});
 vi.stubGlobal('fetch',async()=>Response.json({videos:[{...video(85,''),url:'https://www.pexels.com/video/85/'}]}));
 expect(await findStockFootage('dog ocean','landscape',new AbortController().signal,{subject:'dog'})).toMatchObject({url:'https://videos.pexels.com/85.mp4'});
});

it('ranks curly-apostrophe essential subjects ahead of provider-only alternatives',async()=>{
 vi.stubEnv('PEXELS_API_KEY','curly-fixture');vi.stubGlobal('fetch',async()=>Response.json({videos:[video(90,'dog-toys-beach'),video(91,'children-s-toys')]}));
 expect(await findStockFootage('toys beach','landscape',new AbortController().signal,{subject:'children’s toys'})).toMatchObject({url:'https://videos.pexels.com/91.mp4'});
});

it('uses query setting to break equal subject matches', async () => {
 vi.stubEnv('PEXELS_API_KEY', 'context-fixture');
 vi.stubGlobal('fetch', async () => Response.json({ videos: [
  video(101, 'dog-city-street'), video(102, 'dog-sandy-beach'),
 ] }));
 expect(await findStockFootage('dog sandy beach', 'landscape', new AbortController().signal, { subject: 'dog' }))
  .toMatchObject({ url: 'https://videos.pexels.com/102.mp4' });
});

it('keeps stronger activity matches ahead of otherwise better query context', async () => {
 vi.stubEnv('PEXELS_API_KEY', 'priority-fixture');
 vi.stubGlobal('fetch', async () => Response.json({ videos: [
  video(103, 'dog-sandy-beach-ocean'), video(104, 'dog-running-city'),
 ] }));
 expect(await findStockFootage('dog sandy beach ocean', 'landscape', new AbortController().signal,
  { subject: 'dog', activity: 'running' })).toMatchObject({ url: 'https://videos.pexels.com/104.mp4' });
});

it('preserves provider order when subject and query scores are equal', async () => {
 vi.stubEnv('PEXELS_API_KEY', 'order-fixture');
 vi.stubGlobal('fetch', async () => Response.json({ videos: [
  video(105, 'dog-running-beach'), video(106, 'beach-dog-running'),
 ] }));
 expect(await findStockFootage('running dog beach', 'landscape', new AbortController().signal,
  { subject: 'dog', activity: 'running' })).toMatchObject({ url: 'https://videos.pexels.com/105.mp4' });
});

it('matches simple plural subjects without confusing unrelated nouns or bypassing exclusions',async()=>{
 vi.stubEnv('PEXELS_API_KEY','plural-fixture');
 for(const [subject,slug,accepted] of [['dog','dogs-beach',true],['dogs','dog-beach',true],['ocean wave','ocean-waves',true],['grass','gras',false],['gas','ga',false],['new','news',false],['dog','man-beach',false]] as const) {
  vi.stubGlobal('fetch',async()=>Response.json({videos:[video(920,slug),video(922,subject)]}));
  const result=await findStockFootage(`${subject} pluralfixture ${slug}`,'landscape',new AbortController().signal,{subject});
  expect(result?.url,`${subject} against ${slug}`).toBe(`https://videos.pexels.com/${accepted ? 920 : 922}.mp4`);
 }
 vi.stubGlobal('fetch',async()=>Response.json({videos:[video(921,'dog-running')]}));
 expect(await findStockFootage('dog exclusionfixture','landscape',new AbortController().signal,{subject:'dog',exclude:['dogs running']})).toBeNull();
});

it('uses a relevant landscape clip for portrait when no portrait rendition exists, in one bounded search', async () => {
 vi.stubEnv('PEXELS_API_KEY', 'orientation-fixture');
 const fetcher = vi.fn(async (_input: unknown) => Response.json({videos:[video(930,'turtle-walking',1280,720),video(931,'cat-sitting',720,1280)]}));
 vi.stubGlobal('fetch',fetcher);
 expect(await findStockFootage('turtle walking','portrait',new AbortController().signal,{subject:'turtle'})).toMatchObject({url:'https://videos.pexels.com/930.mp4'});
 expect(fetcher).toHaveBeenCalledTimes(1);
 const url = new URL(String(fetcher.mock.calls[0]?.[0]));
 expect(url.searchParams.has('orientation')).toBe(false);
 expect(url.searchParams.get('per_page')).toBe('12');
});


it('prefers orientation only among equally relevant subjects and ranks matching renditions first', async () => {
 vi.stubEnv('PEXELS_API_KEY','orientation-ties');
 vi.stubGlobal('fetch',async()=>Response.json({videos:[video(932,'rabbit-running',1280,720),video(933,'rabbit-running',720,1280)]}));
 expect(await findStockFootage('rabbit running','portrait',new AbortController().signal,{subject:'rabbit'})).toMatchObject({url:'https://videos.pexels.com/933.mp4'});
 vi.stubGlobal('fetch',async()=>Response.json({videos:[video(934,'horse-field',720,1280),video(935,'horse-running-field',1280,720)]}));
 expect(await findStockFootage('horse running field','portrait',new AbortController().signal,{subject:'horse',activity:'running'})).toMatchObject({url:'https://videos.pexels.com/935.mp4'});
 const resource=video(936,'fox-running');
 resource.video_files.push({link:'https://videos.pexels.com/936-portrait.mp4',width:720,height:1440,file_type:'video/mp4'});
 vi.stubGlobal('fetch',async()=>Response.json({videos:[resource]}));
 expect(await findStockFootage('fox running','portrait',new AbortController().signal)).toMatchObject({url:'https://videos.pexels.com/936-portrait.mp4'});
});

it('allows provider-ranked illustrative footage when metadata does not match the essential subject',async()=>{
 vi.stubEnv('PEXELS_API_KEY','generous-fixture');
 const fetcher=vi.fn(async()=>Response.json({videos:[video(940,'sunlit-room')]}));vi.stubGlobal('fetch',fetcher);
 expect(await findStockFootage('robot painting mural','landscape',new AbortController().signal,{subject:'robot'})).toMatchObject({url:'https://videos.pexels.com/940.mp4'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('tries one broader subject search only after no usable footage, retaining the same cancellation signal',async()=>{
 vi.stubEnv('PEXELS_API_KEY','broader-fixture');
 const signal=new AbortController().signal;
 const fetcher=vi.fn(async(input:unknown,init?:RequestInit)=>{
  expect(init?.signal).toBe(signal);
  const url=new URL(String(input)); expect(url.searchParams.get('per_page')).toBe('12');
  return Response.json({videos:url.searchParams.get('query')==='turtle'?[video(941,'turtle')]:[]});
 });vi.stubGlobal('fetch',fetcher);
 expect(await findStockFootage('turtle reading beside lamp','portrait',signal,{subject:'turtle'})).toMatchObject({url:'https://videos.pexels.com/941.mp4'});
 expect(fetcher.mock.calls.map(call=>new URL(String(call[0])).searchParams.get('query'))).toEqual(['turtle reading beside lamp','turtle']);
});

it('deduplicates broadening and never retries a cancelled or failed search',async()=>{
 vi.stubEnv('PEXELS_API_KEY','bounded-broadening');
 let fetcher=vi.fn(async()=>Response.json({videos:[]}));vi.stubGlobal('fetch',fetcher);
 expect(await findStockFootage('otter','landscape',new AbortController().signal,{subject:'otter'})).toBeNull();
 expect(fetcher).toHaveBeenCalledTimes(1);
 const controller=new AbortController();
 fetcher=vi.fn(async()=>{controller.abort();return Response.json({videos:[]});});vi.stubGlobal('fetch',fetcher);
 await expect(findStockFootage('badger in snow','landscape',controller.signal,{subject:'badger'})).rejects.toThrow();
 expect(fetcher).toHaveBeenCalledTimes(1);
 const failed=vi.fn(async()=>new Response('',{status:429}));vi.stubGlobal('fetch',failed);
 expect(await findStockFootage('deer in rain','landscape',new AbortController().signal,{subject:'deer'})).toBeNull();
 expect(failed).toHaveBeenCalledTimes(1);
});
it('keeps explicit contradictions and unsafe files excluded in both bounded searches',async()=>{
 vi.stubEnv('PEXELS_API_KEY','broadening-safety');
 const fetcher=vi.fn(async()=>Response.json({videos:[video(950,'dog-running'),{...video(951,'dog-resting'),video_files:[{link:'https://untrusted.example/clip.mp4',width:1280,height:720,file_type:'video/mp4'}]}]}));vi.stubGlobal('fetch',fetcher);
 expect(await findStockFootage('dog enjoying afternoon','landscape',new AbortController().signal,{subject:'dog',exclude:['running']})).toBeNull();
 expect(fetcher).toHaveBeenCalledTimes(2);
});
