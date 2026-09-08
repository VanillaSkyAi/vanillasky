import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFalPreview } from '../../functions/_video-chat/fal.mjs';
const urls={cancel_url:'https://queue.fal.run/private/cancel',status_url:'https://queue.fal.run/private/status',response_url:'https://queue.fal.run/private/result'};
function setup(t) {
 let clock=0;const advance=ms=>{clock+=ms;};t.mock.method(performance,'now',()=>clock);
 const env={VIDEO_CHAT_FAL_PREVIEW:'enabled',FAL_KEY:'private-secret',VIDEO_CHAT_QUOTAS:{prepare:()=>({bind:()=>({run:async()=>{advance(11);return {meta:{changes:1}};}})})}};
 return {advance,options:{env,actor:'a'.repeat(64),previewId:'a'.repeat(36)}};
}
test('fal timing separates HTTP phases and provider-reported durations without private data',async t=>{
 const {advance,options}=setup(t);const events=[];let polls=0;
 const nativeTimeout=setTimeout;t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>ms===1500?(advance(ms),queueMicrotask(fn),0):nativeTimeout(fn,ms,...args));
 const result=await generateFalPreview('private prompt',{...options,onTiming:event=>events.push(event),fetcher:async url=>{
  if(url.endsWith('/text-to-video')){advance(20);return Response.json(urls);}
  if(url===urls.status_url){advance(30);return Response.json(++polls===1?{status:'IN_PROGRESS'}:{status:'COMPLETED',metrics:{inference_time:2.5,private:'secret'}});}
  advance(40);return Response.json({video:{url:'https://fal.media/private.mp4'},timings:{inference:1.2,secret:500}});
 }});
 assert.ok(result.media);assert.deepEqual(events,[{outcome:'ready',totalMs:1631,quotaMs:11,submitMs:20,statusHttpMs:60,resultHttpMs:40,pollSleepMs:1500,cancelMs:0,pollCount:2,firstInProgressMs:61,firstCompletedMs:1591,runnerProcessingMs:2500,gpuInferenceMs:1200}]);
 assert.doesNotMatch(JSON.stringify(events),/private|secret|https|prompt/);
});
test('failed fal timing includes cancellation and ignores invalid provider duration fields',async t=>{
 const {advance,options}=setup(t);const events=[];
 const result=await generateFalPreview('private prompt',{...options,onTiming:e=>events.push(e),fetcher:async url=>{
  if(url.endsWith('/text-to-video')){advance(20);return Response.json(urls);}
  if(url===urls.status_url){advance(30);throw Error('private-secret');}
  advance(50);throw Error('cancel-private');
 }});
 assert.equal(result.media,null);assert.equal(events.length,1);assert.equal(events[0].statusHttpMs,30);assert.equal(events[0].cancelMs,50);assert.equal(events[0].totalMs,111);assert.equal(events[0].outcome,'unavailable');
 assert.doesNotMatch(JSON.stringify(events),/private|secret/);
 assert.deepEqual(await generateFalPreview('',{...options,onTiming:()=>{throw Error('logger');}}),{media:null,reason:'unavailable'});
});
test('fal timing omits invalid numeric metrics and bounds valid provider durations',async t=>{
 const {options}=setup(t);
 for(const value of [null,undefined,'private',-1,Infinity,1e20]) {
  const events=[];
  await generateFalPreview('test',{...options,onTiming:e=>events.push(e),fetcher:async url=>Response.json(url.endsWith('/text-to-video')?urls:url===urls.status_url?{status:'COMPLETED',metrics:{inference_time:value}}:{video:{url:'https://fal.media/video.mp4'},timings:{inference:value}})});
  if(value===1e20) {assert.equal(events[0].runnerProcessingMs,150000);assert.equal(events[0].gpuInferenceMs,150000);}
  else {assert.equal('runnerProcessingMs' in events[0],false);assert.equal('gpuInferenceMs' in events[0],false);}
 }
});
test('throwing and rejecting timing callbacks preserve successful result and provider call count',async t=>{
 const {options}=setup(t);
 for(const onTiming of [()=>{throw Error('logger');},()=>Promise.reject(Error('logger'))]) {
  const calls=[];
  const result=await generateFalPreview('test',{...options,onTiming,fetcher:async url=>{
   calls.push(url);assert.ok(url.startsWith('https://queue.fal.run/'),'never download the returned MP4');
   return Response.json(url.endsWith('/text-to-video')?urls:url===urls.status_url?{status:'COMPLETED'}:{video:{url:'https://fal.media/video.mp4'}});
  }});
  assert.equal(result.media.url,'https://fal.media/video.mp4');assert.equal(calls.length,3);
 }
});
