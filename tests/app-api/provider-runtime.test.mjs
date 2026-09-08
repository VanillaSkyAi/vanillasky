import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('provider fetch options are valid in the actual Cloudflare runtime',async()=>{
 const provider=readFileSync(new URL('../../functions/_video-chat/provider.mjs',import.meta.url),'utf8').replaceAll('export ','');
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-04-09',script:provider+`
 export default {async fetch(){
  let calls=0;
  const context={systemPrompt:'Test',userPrompt:'Test',maxOutputTokens:1,signal:new AbortController().signal};
  const result=await providerText(context,{ANTHROPIC_API_KEY:'test-only'},async(url,options)=>{
   const native=new Request(url,options);
   if(native.redirect!=='manual') throw Error('Redirects must not be followed');
   calls++;
   return Response.json({content:[{type:'text',text:'Ready'}]});
  });
  return Response.json({result,calls});
 }}` }));
 try{assert.deepEqual(await(await mf.dispatchFetch('https://test.invalid')).json(),{result:'Ready',calls:1});}
 finally{await mf.dispose();}
});

test('speech request and bounded audio work in the actual Cloudflare runtime', async () => {
  const speech = readFileSync(new URL('../../functions/_video-chat/speech.mjs', import.meta.url), 'utf8').replaceAll('export ', '');
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-04-09', script: speech + `
    export default { async fetch() {
      let calls = 0;
      const result = await generateSpeech({text:'Hello',signal:new AbortController().signal}, {XAI_API_KEY:'test-only'}, async (url, options) => {
        const native = new Request(url, options);
        if (native.redirect !== 'manual') throw Error('Redirects must not be followed');
        if (native.headers.get('Authorization') !== 'Bearer test-only') throw Error('Missing server credential');
        const body = await native.json();
        if (body.voice_id !== 'eve' || body.language !== 'auto' || body.output_format.codec !== 'mp3') throw Error('Wrong fixed voice');
        calls++;
        return new Response(new Uint8Array([73,68,51]), {headers:{'Content-Type':'audio/mpeg'}});
      });
      return Response.json({audio:Array.from(result.audio),mediaType:result.mediaType,calls});
    }}`,
  }));
  try {
    assert.deepEqual(await (await mf.dispatchFetch('https://test.invalid')).json(), {
      audio: [73, 68, 51], mediaType: 'audio/mpeg', calls: 1,
    });
  } finally { await mf.dispose(); }
});
