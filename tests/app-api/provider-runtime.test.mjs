import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
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

async function speechRuntime() {
  const bundled = await build({
    stdin: { contents: `
    import { generateSpeech } from './functions/_video-chat/speech.mjs';
    export default { async fetch(request) {
      let calls = 0;
      const result = await generateSpeech({text:'Hi, café!',signal:new AbortController().signal}, {XAI_API_KEY:'test-only'}, async (url, options) => {
        const native = new Request(url, options);
        if (native.redirect !== 'manual') throw Error('Redirects must not be followed');
        if (native.headers.get('Authorization') !== 'Bearer test-only') throw Error('Missing server credential');
        const body = await native.json();
        if (body.voice_id !== 'eve' || body.language !== 'auto' || body.output_format.codec !== 'mp3') throw Error('Wrong fixed voice');
        if (body.with_timestamps !== true) throw Error('Missing timestamp request');
        calls++;
        if (new URL(request.url).pathname === '/timed') {
          const graph_chars = Array.from(body.text);
          return Response.json({
            audio: 'SUQz', content_type: 'audio/mpeg', duration: graph_chars.length / 10,
            audio_timestamps: {
              graph_chars, graph_times: graph_chars.map((_, index) => [index / 10, (index + 1) / 10]),
            },
            providerMetadata: 'must remain private',
          });
        }
        return new Response(new Uint8Array([73,68,51]), {headers:{'Content-Type':'audio/mpeg'}});
      });
      return Response.json({...result,audio:Array.from(result.audio),calls});
    }}`,
    resolveDir: fileURLToPath(new URL('../..', import.meta.url)), sourcefile: 'speech-runtime-entry.mjs' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-04-09', script: bundled.outputFiles[0].text,
  }));
}

for (const format of ['raw', 'timed']) {
  test(`speech request and ${format === 'timed' ? 'JSON word timestamps' : 'raw audio'} work in the actual Cloudflare runtime`, async () => {
    const mf = await speechRuntime();
    try {
      const expected = { audio: [73, 68, 51], mediaType: 'audio/mpeg', calls: 1 };
      if (format === 'timed') expected.wordTimings = [
        { text: 'Hi,', start: 0, end: 0.3 },
        { text: 'café!', start: 0.4, end: 0.9 },
      ];
      assert.deepEqual(await (await mf.dispatchFetch(`https://test.invalid/${format}`)).json(), expected);
    } finally { await mf.dispose(); }
  });
}
