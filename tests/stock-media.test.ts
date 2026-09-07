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
 it('declines unrelated subjects and unusable orientation instead of guessing',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({videos:[video(3,'robot-garden',1280,720),video(4,'cat',720,1280)]})));
  expect(await findStockFootage('robot garden','portrait',new AbortController().signal)).toBeNull();
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
 it('rejects explicitly unrelated metadata even when its URL is numeric',async()=>{
  vi.stubEnv('PEXELS_API_KEY','fixture-key');vi.stubGlobal('fetch',async()=>Response.json({videos:[
   {...video(54,''),url:'https://www.pexels.com/video/54/',title:'A resting cat',tags:['kitten']}
  ]}));
  expect(await findStockFootage('mountain skiing','landscape',new AbortController().signal)).toBeNull();
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
 expect(await findStockFootage('beach','landscape',signal,{subject:'cat'})).toBeNull();
 expect(await findStockFootage('beach','landscape',signal,{subject:'dog',exclude:['running']})).toBeNull();
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

it('keeps curly-apostrophe essential subjects restrictive',async()=>{
 vi.stubEnv('PEXELS_API_KEY','curly-fixture');vi.stubGlobal('fetch',async()=>Response.json({videos:[video(90,'dog-toys-beach')]}));
 expect(await findStockFootage('toys beach','landscape',new AbortController().signal,{subject:'children’s toys'})).toBeNull();
});
