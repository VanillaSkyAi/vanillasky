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
});
