import test from 'node:test';
import assert from 'node:assert/strict';
import { searchStock } from '../../functions/_video-chat/stock.mjs';
import { approvedStockMedia } from '../../functions/_video-chat/approved-stock.mjs';
const env = { PEXELS_API_KEY: 'test-only' };
const file = (width, height, link = `https://videos.pexels.com/video-files/${width}.mp4`) => ({width,height,link,file_type:'video/mp4'});
const item = (subject='golfer hitting ball', files=[file(1280,720)]) => ({id:123,url:`https://www.pexels.com/video/${subject.replaceAll(' ','-')}-123/`,image:'https://images.pexels.com/videos/golfer-hitting-ball-123.jpg',user:{name:'Stock Creator',url:'https://www.pexels.com/@stock-creator/'},video_files:files});
const reply = (items=[item()]) => Response.json({videos:items});
test('searches new literal subjects with bounded video results, orientation and server-only key', async()=>{
 let target, settings;
 const media=await searchStock('golfer hitting ball',{env,orientation:'portrait',fetcher:async(url,options)=>{target=new URL(url);settings=options;return reply([item('golfer hitting ball',[file(1080,1920),file(720,1280),file(360,640)])]);}});
 assert.equal(target.origin+target.pathname,'https://api.pexels.com/v1/videos/search');
 assert.equal(target.searchParams.get('query'),'golfer hitting ball'); assert.equal(target.searchParams.get('per_page'),'12');assert.equal(target.searchParams.has('orientation'),false);
 assert.equal(settings.redirect,'manual');assert.equal(settings.headers.Authorization,env.PEXELS_API_KEY);
 assert.equal(media.url,'https://videos.pexels.com/video-files/720.mp4');assert.equal(media.type,'video');assert.equal(media.attribution.author,'Stock Creator');assert.match(media.attribution.url,/pexels.com/);assert.ok(!JSON.stringify(media).includes(env.PEXELS_API_KEY));
});
test('allows provider-ranked illustration while preferring relevant footage',async()=>{
 const media=await searchStock('golfer hitting ball',{env,fetcher:async()=>reply([item('cat playing outdoors'),item('golfer hitting ball',[file(720,1280)]),item()])}); assert.ok(media);
 assert.ok(await searchStock('golfer hitting ball',{env,fetcher:async()=>reply([item('cat playing outdoors')])}));
 assert.equal((await searchStock('golfer hitting ball',{env,orientation:'portrait',fetcher:async()=>reply()}))?.type,'video');
});
test('accepts numeric Pexels pages with empty editorial metadata in search rank', async () => {
 const numeric = { ...item(), id:2499611, url:'https://www.pexels.com/video/2499611/', tags:[] };
 const media = await searchStock('ocean waves breaking shore',{env,fetcher:async()=>reply([numeric])});
 assert.equal(media?.url,numeric.video_files[0].link);
});
test('ranks partial literal overlap above unknown metadata without requiring framing words', async () => {
 const unknown = {...item(),url:'https://www.pexels.com/video/2499611/',tags:[]};
 const match = item('waves rolling',[file(1280,720,'https://videos.pexels.com/video-files/waves.mp4')]);
 const media = await searchStock('close view ocean waves breaking shore',{env,fetcher:async()=>reply([unknown,item('cat sleeping'),match])});
 assert.equal(media?.url,match.video_files[0].link);
 assert.ok(await searchStock('close view ocean waves breaking shore',{env,fetcher:async()=>reply([item('cat sleeping')])}));
});
test('bounds query before provider access and respects cancellation',async()=>{
 const fetcher=()=>assert.fail('unexpected call');
 for(const query of ['',null,{},'x'.repeat(81),'one two three four five six seven eight nine'])assert.equal(await searchStock(query,{env,fetcher}),null);
 assert.equal(await searchStock('golf',{fetcher}),null);assert.equal(await searchStock('golf',{env,fetcher,signal:AbortSignal.abort()}),null);
});
test('rejects unsafe video URLs and oversized/malformed upstream bodies',async()=>{
 for(const link of ['http://videos.pexels.com/x','https://evil.test/x','https://user@videos.pexels.com/x','https://videos.pexels.com:8443/x'])assert.equal(await searchStock('golfer hitting ball',{env,fetcher:async()=>reply([item('golfer hitting ball',[file(1280,720,link)])])}),null);
 for(const fetcher of [async()=>new Response(' '.repeat(131073)),async()=>new Response('bad'),async()=>new Response('',{status:429}),async()=>{throw Error('network');}])assert.equal(await searchStock('golf',{env,fetcher}),null);
});
test('sanitized cache preserves clip duration and credits while separating orientation',async()=>{
 const saved=new Map();let calls=0;
 const cache={match:async r=>saved.get(r.url)?.clone(),put:async(r,v)=>{assert.ok(!r.url.includes('golfer'));assert.equal(v.headers.get('cache-control'),'public, max-age=86400');saved.set(r.url,v);}};
 const fetcher=async()=>{calls++;return reply([{...item(),duration:12.5}]);}; const options={env,cache,fetcher};
 const first=await searchStock('golfer hitting ball',options);assert.equal(first?.durationSec,12.5);assert.deepEqual(await searchStock('golfer hitting ball',options),first);assert.equal(calls,1);
 await searchStock('golfer hitting ball',{...options,orientation:'portrait'});assert.equal(calls,2);
});
test('invalid duration metadata does not discard usable upstream or cached footage',async()=>{
 for(const duration of [undefined,null,0,-4,'12.5',true]) {
  const upstream=await searchStock('golfer hitting ball',{env,fetcher:async()=>reply([{...item(),duration}])});
  assert.equal(upstream?.type,'video');assert.equal(Object.hasOwn(upstream,'durationSec'),false);
  const cached=await searchStock('golfer hitting ball',{env,cache:{match:async()=>Response.json({type:'video',url:file(1280,720).link,durationSec:duration})},fetcher:()=>assert.fail('valid cached footage must not fetch')});
  assert.equal(cached?.type,'video');assert.equal(Object.hasOwn(cached,'durationSec'),false);
 }
 const overflowingJson=JSON.stringify({type:'video',url:file(1280,720).link,durationSec:'overflow'}).replace('"overflow"','1e999');
 const overflow=await searchStock('golfer hitting ball',{env,cache:{match:async()=>new Response(overflowingJson)},fetcher:()=>assert.fail('valid cached footage must not fetch')});
 assert.equal(overflow?.type,'video');assert.equal(Object.hasOwn(overflow,'durationSec'),false);
});
test('cache failure does not discard footage and abort propagates upstream',async()=>{
 assert.ok(await searchStock('golfer hitting ball',{env,cache:{match:async()=>{throw Error();},put:async()=>{throw Error();}},fetcher:async()=>reply()}));
 const controller=new AbortController();assert.equal(await searchStock('golf',{env,signal:controller.signal,fetcher:async(_, {signal})=>{controller.abort();assert.ok(signal.aborted);throw Error();}}),null);
});
test('stalled stock provider is bounded to 2.5 seconds',async()=>{
 const started=Date.now();assert.equal(await searchStock('golf',{env,fetcher:(_, {signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error()),{once:true}))}),null);assert.ok(Date.now()-started<3000);
});
test('reviewed handshake photo is available only for literal image intents', () => {
  const image = approvedStockMedia('handshake across desk', 'landscape', undefined, 'image');
  assert.equal(image.type, 'image');
  assert.match(image.url, /photos\/3184465/);
  assert.equal(approvedStockMedia('handshake across desk', 'landscape', undefined, 'video'), null);
  assert.equal(approvedStockMedia('signed contract', 'landscape'), null);
  assert.equal(approvedStockMedia('successful funding round', 'landscape'), null);
});

test('new stock subjects are literal and crop-specific rather than topic filler', () => {
 for (const query of ['writing in a notebook','sunlight through forest trees']) {
   for (const orientation of ['landscape','portrait','square']) assert.ok(approvedStockMedia(query,orientation));
 }
 assert.ok(approvedStockMedia('cat playing outdoors','portrait'));
 assert.equal(approvedStockMedia('cat playing outdoors','landscape'),null);
 assert.ok(approvedStockMedia('watering a potted plant','landscape'));
 assert.equal(approvedStockMedia('watering a potted plant','portrait'),null);
 assert.ok(approvedStockMedia('potted plant by window','portrait'));
 for (const query of ['successful study plan','cat laughing','photosynthesis mechanism','plant drainage']) assert.equal(approvedStockMedia(query,'portrait'),null);
 assert.match(approvedStockMedia('full moon night sky','portrait')?.url ?? '', /6877264-hd_720_1280/);
 assert.equal(approvedStockMedia('moon against black sky','square'),null);
 assert.equal(approvedStockMedia('moon orbit','portrait'),null);
});

test('AI-first subjects preserve reviewed portrait relevance across eight intent cases', () => {
  const subjects = [
    ['breaking ocean wave', true], ['full moon night sky', true],
    ['electron cloud around nucleus', false], ['dinosaur extinction illustration', false],
    ['cloud searching for shadow', false], ['moon job interview', false],
    ['ocean ordering moonlight', false], ['potted plant by window', true],
  ];
  for (const [subject, available] of subjects) {
    assert.ok(subject.length <= 80);
    assert.equal(Boolean(approvedStockMedia(subject, 'portrait', undefined, 'video')), available, subject);
  }
  assert.equal(approvedStockMedia('watering a potted plant', 'portrait', undefined, 'video'), null, 'Reviewed portrait crop cannot demonstrate the cropped-out watering action');
  assert.equal(approvedStockMedia('underwater friction slowing an ocean wave', 'portrait', undefined, 'video'), null);
});

test('stock diagnostics classify failures without retaining provider data', async () => {
 const secret = 'private provider body key query';
 for (const [fetcher, expected] of [
  [async()=>new Response(secret,{status:429}),{reason:'rate_limited',httpStatus:429}],
  [async()=>new Response(secret,{status:503}),{reason:'provider_error',httpStatus:503}],
  [async()=>{throw Error(secret);},{reason:'provider_error'}],
  [async()=>new Response(' '.repeat(131073)),{reason:'response_too_large'}],
  [async()=>new Response('',{headers:{'content-length':'131073'}}),{reason:'response_too_large'}],
  [async()=>new Response(secret),{reason:'invalid_response'}],
  [async()=>Response.json({private:secret}),{reason:'invalid_response'}],
  [async()=>reply([]),{reason:'no_match',matchStage:'empty-results',resultCount:0,relevantCount:0}],
  [async()=>reply([{...item(),url:'https://unsafe.example/video/123/'}]),{reason:'no_match',matchStage:'relevance',resultCount:1,relevantCount:0}],
 ]) {
  const events=[];
  assert.equal(await searchStock('golf',{env,fetcher,onDiagnostic:event=>events.push(event)}),null);
  assert.deepEqual(events,[{...expected,stage:'pexels_search'}]);
  assert.ok(!JSON.stringify(events).includes(secret));
 }
});
test('stock diagnostics distinguish caller cancellation from timeout',async()=>{
 for (const cancel of [true,false]) {
  const events=[], controller=new AbortController();
  const fetcher=(_, {signal})=>new Promise((_,reject)=>{
   signal.addEventListener('abort',()=>reject(Error('private cause')),{once:true});
   if(cancel)controller.abort();
  });
  assert.equal(await searchStock('golf',{env,fetcher,signal:controller.signal,onDiagnostic:event=>events.push(event)}),null);
  assert.deepEqual(events,[{reason:cancel?'cancelled':'timeout',stage:'pexels_search'}]);
 }
});
test('stock diagnostics cannot change recovery and successful cache failures stay silent',async()=>{
 for(const onDiagnostic of [()=>{throw Error('observer');},async()=>{throw Error('observer');}]) {
  assert.equal(await searchStock('golf',{env,fetcher:async()=>reply([]),onDiagnostic}),null);
 }
 const events=[];
 assert.ok(await searchStock('golfer hitting ball',{env,cache:{match:async()=>{throw Error();},put:async()=>{throw Error();}},fetcher:async()=>reply(),onDiagnostic:event=>events.push(event)}));
 assert.deepEqual(events,[]);
});

test('rejected stock response bodies are cancelled without changing diagnostic reason', async () => {
 for (const [status, headers, expected] of [
  [200, {'content-length':'131073'}, {reason:'response_too_large'}],
  [429, {}, {reason:'rate_limited',httpStatus:429}],
  [503, {}, {reason:'provider_error',httpStatus:503}],
 ]) for(const rejectCancel of [false,true]) {
  let cancellations=0; const events=[];
  const body=new ReadableStream({cancel(){cancellations++;if(rejectCancel)throw Error('private cancellation detail');}});
  assert.equal(await searchStock('golf',{env,fetcher:async()=>new Response(body,{status,headers}),onDiagnostic:event=>events.push(event)}),null);
  assert.equal(cancellations,1);
  assert.deepEqual(events,[{...expected,stage:'pexels_search'}]);
 }
});

test('essential subject ranks above weaker provider-ranked illustration and unknown',async()=>{
 const selection={subject:'dog',activity:'running',equipment:undefined};
 assert.ok(await searchStock('dog beach',{env,selection,fetcher:async()=>reply([item('man walking beach')])}));
 const unknown={...item(),url:'https://www.pexels.com/video/123/',tags:[]};
 const dog=item('dog running beach',[file(1280,720,'https://videos.pexels.com/video-files/dog.mp4')]);
 assert.equal((await searchStock('dog beach',{env,selection,fetcher:async()=>reply([unknown,item('man walking beach'),dog])}))?.url,dog.video_files[0].link);
 assert.ok(await searchStock('dog beach',{env,selection,fetcher:async()=>reply([unknown])}),'unknown metadata retains uncertain provider-ranked fallback');
});
test('explicit distinctions reject conflicting activities without topic-specific rules',async()=>{
 const selection={subject:'golfer',activity:'full swing',equipment:'golf club',exclude:['miniature golf','putting']};
 assert.equal(await searchStock('golfer full swing',{env,selection,fetcher:async()=>reply([item('golfer miniature golf putting')])}),null);
 assert.ok(await searchStock('golfer full swing',{env,selection,fetcher:async()=>reply([item('golfer full swing golf club')])}));
 assert.ok(await searchStock('ocean waves',{env,selection:{subject:'ocean waves'},fetcher:async()=>reply([item('ocean waves breaking')])}));
});
test('selection-aware cache cannot reuse another required subject or exclusion policy',async()=>{
 const entries=new Map(), keys=[];let calls=0;
 const cache={match:async key=>{keys.push(key.url);return entries.get(key.url)?.clone();},put:async(key,value)=>entries.set(key.url,value.clone())};
 const fetcher=async()=>{calls++;return reply([item('dog beach')]);};
 assert.ok(await searchStock('beach',{env,selection:{subject:'dog'},cache,fetcher}));
 assert.ok(await searchStock('beach',{env,selection:{subject:'dog'},cache,fetcher}));
 assert.equal(calls,1);
 assert.ok(await searchStock('beach',{env,selection:{subject:'cat'},cache,fetcher}));
 assert.equal(await searchStock('beach',{env,selection:{subject:'dog',exclude:['dog beach']},cache,fetcher}),null);
 assert.equal(calls,4);assert.equal(new Set(keys).size,3);
 assert.ok(keys.every(key=>!key.includes('dog')&&!key.includes('cat')));
});

test('activity ranks essential-subject matches and malformed hints preserve compatibility',async()=>{
 const running=item('dog running beach',[file(1280,720,'https://videos.pexels.com/video-files/running.mp4')]);
 const resting=item('dog resting beach');
 assert.equal((await searchStock('dog beach',{env,selection:{subject:'dog',activity:'running'},fetcher:async()=>reply([resting,running])}))?.url,running.video_files[0].link);
 for(const selection of [null,{}, {subject:'x'.repeat(49)},{subject:'one two three four five'}]) {
  assert.ok(await searchStock('dog beach',{env,selection,fetcher:async()=>reply([item('man beach')])}));
 }
});

test('curly apostrophes in valid essential subjects do not drop selection constraints',async()=>{
 const exact=item('children-s-toys',[file(1280,720,'https://videos.pexels.com/video-files/toys.mp4')]);
 assert.equal((await searchStock('toys beach',{env,selection:{subject:'children’s toys'},fetcher:async()=>reply([item('dog toys beach'),exact])}))?.url,exact.video_files[0].link);
 assert.ok(await searchStock('toys beach',{env,selection:{subject:'children’s toys'},fetcher:async()=>reply([item('children-s-toys')])}));
});

test('query context breaks equal subject matches without promoting setting-only footage or stopwords', async () => {
 const street=item('dog on street',[file(1280,720,'https://videos.pexels.com/video-files/street.mp4')]);
 const beach=item('dog beach',[file(1280,720,'https://videos.pexels.com/video-files/beach.mp4')]);
 const setting=item('man beach',[file(1280,720,'https://videos.pexels.com/video-files/man.mp4')]);
 for(const query of ['dog beach','the dog at the beach']) {
  const result=await searchStock(query,{env,selection:{subject:'dog'},fetcher:async()=>reply([setting,street,beach])});
  assert.equal(result?.url,beach.video_files[0].link);
 }
 const running=item('dog running street',[file(1280,720,'https://videos.pexels.com/video-files/running.mp4')]);
 assert.equal((await searchStock('dog beach',{env,selection:{subject:'dog',activity:'running'},fetcher:async()=>reply([beach,running])}))?.url,running.video_files[0].link);
 const unknown={...item(),url:'https://www.pexels.com/video/123/'};
 assert.ok(await searchStock('dog beach',{env,selection:{subject:'dog'},fetcher:async()=>reply([unknown])}));
 assert.equal(await searchStock('the at on',{env,selection:{subject:'dog'},fetcher:()=>assert.fail('stopword-only query must not fetch')}),null);
});

test('regular singular/plural subject forms preserve essential actor and exclusion checks',async()=>{
 for(const [subject,label] of [['dog','dogs beach'],['dogs','dog beach'],['ocean wave','ocean waves'],['golf club','golf clubs']]) {
  assert.ok(await searchStock(subject,{env,selection:{subject},fetcher:async()=>reply([item(label)])}),`${subject}: ${label}`);
 }
 for(const [subject,label] of [['dog','man beach'],['grass','gras beach'],['gas','ga beach'],['new','news studio']]) {
  const exact=item(subject,[file(1280,720,'https://videos.pexels.com/video-files/exact.mp4')]);
  assert.equal((await searchStock(subject,{env,selection:{subject},fetcher:async()=>reply([item(label),exact])}))?.url,exact.video_files[0].link);
 }
 assert.equal(await searchStock('dog beach',{env,selection:{subject:'dog',exclude:['dogs running']},fetcher:async()=>reply([item('dog running beach')])}),null);
});
test('no-match diagnostics distinguish empty search, semantic filtering and unusable files without raw data',async()=>{
 for(const [videos,expected] of [
  [[],{matchStage:'empty-results',resultCount:0,relevantCount:0}],
  [[item('dog sleeping')],{matchStage:'relevance',resultCount:1,relevantCount:0}],
  [[item('dog beach',[file(160,240)])],{matchStage:'files',resultCount:1,relevantCount:1}],
 ]) {
  const events=[];
  assert.equal(await searchStock('dog beach',{env,selection:{subject:'dog',exclude:['sleeping']},fetcher:async()=>reply(videos),onDiagnostic:e=>events.push(e)}),null);
  assert.deepEqual(events,[{reason:'no_match',stage:'pexels_search',...expected}]);
  assert.doesNotMatch(JSON.stringify(events),/dog|man|https|test-only/);
 }
});
test('orientation selects an available bounded rendition from a later relevant result',async()=>{
 const good=item('dog beach',[file(3840,2160),file(720,1280),file(1280,720,'https://videos.pexels.com/video-files/correct.mp4')]);
 const result=await searchStock('dog beach',{env,selection:{subject:'dog'},fetcher:async()=>reply([item('dog beach',[file(720,1280)]),good])});
 assert.equal(result?.url,'https://videos.pexels.com/video-files/correct.mp4');
});

test('pending optional cache writes do not hold ready footage or report a provider timeout', async () => {
 let release; const pending=new Promise(resolve=>release=resolve); const events=[];
 const result=searchStock('golfer hitting ball',{env,cache:{match:async()=>undefined,put:()=>pending},fetcher:async()=>reply(),onDiagnostic:event=>events.push(event)});
 try {
  const media=await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve('blocked'),300))]);
  assert.notEqual(media,'blocked'); assert.equal(media?.type,'video'); assert.deepEqual(events,[]);
 } finally {release();await result;}
});

test('a pending optional cache read falls through to one guarded search', async () => {
 let release; const pending=new Promise(resolve=>release=resolve); let calls=0;
 const result=searchStock('golfer hitting ball',{env,cache:{match:()=>pending},fetcher:async()=>{calls++;return reply();}});
 try {
  const media=await Promise.race([result,new Promise(resolve=>setTimeout(()=>resolve('blocked'),400))]);
  assert.notEqual(media,'blocked'); assert.equal(media?.type,'video'); assert.equal(calls,1);
 } finally {release();await result;}
});

test('cancellation while cache lookup waits prevents provider access', async () => {
 const controller=new AbortController();let release;
 const result=searchStock('golfer hitting ball',{env,signal:controller.signal,cache:{match:()=>new Promise(resolve=>{release=resolve;controller.abort();})},fetcher:()=>assert.fail('cancelled search must not fetch')});
 assert.equal(await result,null);release();
});

test('malformed cached media falls through without weakening subject or file validation', async () => {
 for(const cached of [new Response('bad json'),Response.json({type:'video',url:'https://evil.example/clip.mp4'})]) {
  let calls=0;
  const media=await searchStock('dog beach',{env,selection:{subject:'dog'},cache:{match:async()=>cached},fetcher:async()=>{calls++;return reply([item('cat beach'),item('dogs beach')]);}});
  assert.equal(media?.type,'video');assert.equal(calls,1);assert.match(media.attribution.url,/dogs-beach/);
 }
});

test('caller cancellation still wins while a ready-media cache write waits', async () => {
 const controller=new AbortController();const events=[];
 const result=await searchStock('golfer hitting ball',{env,signal:controller.signal,cache:{put:async()=>{controller.abort();throw Error('optional storage');}},fetcher:async()=>reply(),onDiagnostic:event=>events.push(event)});
 assert.equal(result,null);assert.deepEqual(events,[{reason:'cancelled',stage:'pexels_search'}]);
});

test('orientation is a preference within one bounded search, not a reason to discard relevant footage', async()=>{
 let calls=0;
 const media=await searchStock('dog beach',{env,orientation:'portrait',selection:{subject:'dog'},fetcher:async url=>{
  calls++;assert.equal(new URL(url).searchParams.has('orientation'),false);assert.equal(new URL(url).searchParams.get('per_page'),'12');
  return reply([item('dog beach',[file(1280,720)])]);
 }});
 assert.equal(media?.type,'video');assert.equal(calls,1);
});
test('preferred shape never substitutes an unrelated actor or defeats exclusions',async()=>{
 const portrait=file(720,1280,'https://videos.pexels.com/video-files/portrait.mp4');
 const landscape=file(1280,720,'https://videos.pexels.com/video-files/landscape.mp4');
 const media=await searchStock('dog beach',{env,orientation:'portrait',selection:{subject:'dog',exclude:['sleeping']},fetcher:async()=>reply([item('man beach',[portrait]),item('dog sleeping beach',[portrait]),item('dog beach',[landscape])])});
 assert.equal(media?.url,landscape.link);
});

test('known subject relevance outranks an unknown result in the preferred shape',async()=>{
 const unknown={...item(''),url:'https://www.pexels.com/video/123/',video_files:[file(720,1280)]};
 const known=item('dog beach',[file(1280,720,'https://videos.pexels.com/video-files/known.mp4')]);
 const media=await searchStock('dog beach',{env,orientation:'portrait',selection:{subject:'dog'},fetcher:async()=>reply([unknown,known])});
 assert.equal(media?.url,known.video_files[0].link);
});

test('a specific query miss gets one broader subject search with the same safety filters', async()=>{
 const queries=[];
 const media=await searchStock('dog leaping through foamy ocean waves',{env,selection:{subject:'dog',exclude:['sleeping']},fetcher:async url=>{
  const query=new URL(url).searchParams.get('query');queries.push(query);
  return reply(query==='dog'?[item('man beach'),item('dog sleeping'),item('dog running')]:[]);
 }});
 assert.equal(media?.type,'video');assert.match(media.attribution.url,/dog-running/);
 assert.deepEqual(queries,['dog leaping through foamy ocean waves','dog']);
});

test('provider-ranked illustrative footage is usable when no exact subject metadata exists',async()=>{
 const media=await searchStock('ancient animal extinction',{env,selection:{subject:'dinosaur'},fetcher:async()=>reply([item('museum skeleton display')])});
 assert.equal(media?.type,'video');assert.match(media.attribution.url,/museum-skeleton/);
});

test('broader search is deduplicated and never retries errors, cancellation or usable weaker footage',async()=>{
 for(const scenario of ['same-query','error','cancelled','weaker']) {
  let calls=0;const controller=new AbortController();
  const result=await searchStock(scenario==='same-query'?'dog':'dog beach',{env,selection:{subject:'dog'},signal:controller.signal,fetcher:async()=>{
   calls++;
   if(scenario==='cancelled'){controller.abort();throw Error('cancelled');}
   if(scenario==='error')return new Response('',{status:429});
   return reply(scenario==='weaker'?[item('museum display')]:[]);
  }});
  assert.equal(calls,1);assert.equal(Boolean(result),scenario==='weaker');
 }
});
test('broader search shares the original deadline and caches the recovered result under the full query',async()=>{
 const entries=new Map();const cache={match:async key=>entries.get(key.url)?.clone(),put:async(key,value)=>entries.set(key.url,value.clone())};
 const signals=[];let calls=0;
 const options={env,selection:{subject:'dog'},cache,fetcher:async(_,context)=>{calls++;signals.push(context.signal);return reply(calls===1?[]:[{...item('dog running'),duration:30}]);}};
 assert.equal((await searchStock('dog by ocean waves',options))?.durationSec,30);assert.equal(calls,2);assert.equal(signals[0],signals[1]);
 assert.equal((await searchStock('dog by ocean waves',options))?.durationSec,30);assert.equal(calls,2);
});
