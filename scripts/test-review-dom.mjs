// Exercise the production metadata parser with a real HTML DOM and mock HTTP.
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

import {pathToFileURL} from 'node:url';
const stage=mkdtempSync(join(tmpdir(),'openmarks-dom-'));
try {
  const script=join(stage,'check.mjs');
  await build({stdin:{contents:`
    import {fetchPageMetadata,enrichDraft} from './src/metadata.ts';
    import {setRequestUrlHandler} from './tests/obsidian-mock.mjs';
    import Plugin from './src/main.ts';
    export default (async()=>{
      const calls=[];
      setRequestUrlHandler(async ({url})=>{
        calls.push(url);
        if(url.endsWith('.png')) return {status:200,headers:{'CoNtEnT-TyPe':'image/png'},arrayBuffer:Uint8Array.from([137,80,78,71,13,10,26,10]).buffer};
        return {status:200,headers:{'Content-Type':'text/html'},text:\`<title>News</title><meta content="Germany's public broadcaster &amp; news" name="description"><link rel="icon" href="/logo.png">\`};
      });
      const url='https://fda.gov/news';
      const meta=await fetchPageMetadata(url);
      if(meta.description!=="Germany's public broadcaster & news" || meta.favicon!=='https://fda.gov/logo.png') throw Error('metadata mismatch');
      const draft=await enrichDraft({url});
      if(draft.favicon) throw Error('remote URL leaked into draft');
      const item={url,id:'legacy/name',favicon:'_openmarks/favicons/site-old.png'};
      const plugin=new Plugin(); let writes=0;
      plugin.app={vault:{getAbstractFileByPath:()=>({}),adapter:{writeBinary:async path=>{
        if(!/^_openmarks\\/favicons\\/site-[a-f0-9]{64}\\.png$/.test(path))throw Error('unsafe filename');
        writes++;
      }}}};
      plugin.store={get:()=>item,update:async()=>item};
      plugin.refresh=async()=>{};
      plugin.faviconRecord=()=>({source:meta.favicon,iconPath:item.favicon});
      plugin.updateFaviconRecord=async()=>{};
      await plugin.refreshFavicon(item);
      if(writes!==1 || calls.at(-1)!==meta.favicon)throw Error('cached icon was not refreshed');

    })();
  `,resolveDir:process.cwd()},bundle:true,format:'esm',outfile:script,alias:{obsidian:resolve('tests/obsidian-mock.mjs')}});
  const {parseHTML}=await import(process.env.OPENMARKS_DOM || 'linkedom');
  globalThis.document=parseHTML('<html><body></body></html>').document;
  globalThis.window=globalThis;
  await (await import(pathToFileURL(script))).default;
  console.log('PASS HTML DOM metadata, draft and cached manual refresh');
} finally {rmSync(stage,{recursive:true,force:true});}
