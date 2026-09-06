import {describe,it,expect,vi,afterEach} from 'vitest';
import {findStockFootage,type ApprovedStock} from '../starters/video-chat/stock';
const index:ApprovedStock[]=[{queries:['breaking ocean wave'],orientations:['landscape'],description:'A wave breaking into foam, no named location',reviewedAt:'2026-09-06',media:{url:'https://media.example.test/wave.mp4',type:'video',posterUrl:'https://media.example.test/wave.jpg'}}];
afterEach(()=>vi.unstubAllGlobals());
describe('reviewed starter stock',()=>{
 it('returns a reviewed literal subject without a network round trip',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect(await findStockFootage('Breaking  ocean wave','landscape',new AbortController().signal,undefined,index)).toEqual(index[0].media);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('does not substitute atmosphere for an exact action or identity',async()=>{
  expect(await findStockFootage('tsunami destroying village','landscape',new AbortController().signal,'breaking ocean wave',index)).toBeNull();
 });
 it('declines an unreviewed crop',async()=>{
  expect(await findStockFootage('breaking ocean wave','portrait',new AbortController().signal,undefined,index)).toBeNull();
 });
 it('accepts an independently reviewed photo',async()=>{
  const photo={...index[0],media:{url:'https://media.example.test/wave.jpg',type:'image' as const}};
  expect(await findStockFootage('breaking ocean wave','landscape',new AbortController().signal,undefined,[photo])).toEqual(photo.media);
 });
 it('rejects invalid URLs and unreviewed entries',async()=>{
  for(const entry of [{...index[0],reviewedAt:''},{...index[0],media:{url:'javascript:alert(1)',type:'image' as const}}]){
   expect(await findStockFootage('breaking ocean wave','landscape',new AbortController().signal,undefined,[entry])).toBeNull();
  }
 });
 it('honors cancellation before selecting an asset',async()=>{
  await expect(findStockFootage('breaking ocean wave','landscape',AbortSignal.abort(),undefined,index)).rejects.toThrow();
 });
});
