// Run from the project root. Existing release archives are left intact.
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

import * as mock from '../tests/obsidian-mock.mjs';

const root = process.cwd();
const stage = fs.mkdtempSync(join(tmpdir(), 'openmarks-validation-'));
const project = join(stage, 'source');
const vault = join(stage, 'vault');
const result = [];
let failed = false;
async function check(name, action) {
  try { await action(); result.push([name, 'PASS']); }
  catch (err) { failed = true; result.push([name, 'FAIL', err.message]); throw err; }
}
function run(cmd, args, cwd = project, env = process.env) {
  execFileSync(cmd, args, { cwd, env, stdio: 'inherit' });
}
try {
  fs.cpSync(root, project, { recursive: true, filter: p => !['release','RELEASE-VALIDATION.json','.git','.test-build','node_modules'].includes(basename(p)) });
  fs.symlinkSync(join(root,'node_modules'), join(project,'node_modules'));
  await check('TypeScript and production bundle', () => run('npm',['run','build']));
  await check('Suite on '+process.version, () => run('npm',['test']));
  await check('HTML DOM and manual favicon refresh', () => run(process.execPath,['scripts/test-review-dom.mjs']));
  for (const major of [20,22,24]) {
    if (Number(process.versions.node.split('.')[0]) === major) continue;
    const binary = process.env['NODE'+major];
    if (!binary) { result.push(['Node '+major+' suite','NOT TESTED']); continue; }
    await check('Node '+major+' suite', () => {
      assert.equal(Number(execFileSync(binary,['-p','process.versions.node.split(".")[0]'],{encoding:'utf8'})),major);
      run(binary,['--test',...fs.readdirSync(join(project,'tests')).filter(n=>n.endsWith('.test.mjs')).map(n=>'tests/'+n)]);
    });
  }
  await check('Package, version and archive checks', () => run(process.execPath,['scripts/package-release.mjs']));
  const version = JSON.parse(fs.readFileSync(join(project,'manifest.json'))).version;
  const archive = join(project,'release','openmarks-macos-installer-'+version+'.zip');
  fs.mkdirSync(join(vault,'.obsidian'), {recursive:true});
  await check('Install from macOS installer archive', () => {
    run('unzip',['-q',archive,'-d',stage]);
    run('/bin/zsh',[join(stage,'OpenMarks macOS Installer/install-openmarks.command'),vault]);
    for (const file of ['manifest.json','main.js','styles.css'])
      assert.deepEqual(fs.readFileSync(join(project,file)),fs.readFileSync(join(vault,'.obsidian/plugins/openmarks',file)));
  });
  await check('Compiled plugin lifecycle with disk-backed Obsidian API fixture', async () => {
    const dir=join(vault,'.obsidian/plugins/openmarks');
    const data=join(dir,'data.json');
    let ready;
    let requests=0;
    const modals=[];
    class Plugin {
      loadData(){return fs.existsSync(data)?JSON.parse(fs.readFileSync(data)):null;}
      saveData(value){fs.writeFileSync(data,JSON.stringify(value));}
      registerView(){} addSettingTab(){} addCommand(){} addRibbonIcon(){} registerEvent(){}
    }
    const sdk={...mock,Plugin,PluginSettingTab:class {},Platform:{},Modal:class{open(){modals.push(this);}},requestUrl(){requests++;throw Error('unexpected network request');}};
    const bundle={exports:{}};
    Function('module','exports','require',fs.readFileSync(join(dir,'main.js'),'utf8'))(bundle,bundle.exports,name=>{
      assert.equal(name,'obsidian'); return sdk;
    });
    const notes='_openmarks/bookmarks';
    const file=p=>new mock.TFile(p);
    const read=f=>fs.readFileSync(join(vault,f.path),'utf8');
    const put=(f,body)=>fs.writeFileSync(join(vault,f.path),body);
    const api={on(){},getAbstractFileByPath:p=>fs.existsSync(join(vault,p))?file(p):null,
      getMarkdownFiles:()=>fs.existsSync(join(vault,notes))?fs.readdirSync(join(vault,notes)).map(n=>file(notes+'/'+n)):[],
      cachedRead:read,createFolder:p=>fs.mkdirSync(join(vault,p)),create(p,body){fs.writeFileSync(join(vault,p),body,{flag:'wx'});return file(p);},
      process(f,fn){const body=fn(read(f));put(f,body);return body;}};
    const app={vault:api,workspace:{onLayoutReady(fn){ready=fn;},getLeavesOfType:()=>[]},
      fileManager:{trashFile:f=>fs.unlinkSync(join(vault,f.path)),processFrontMatter(f,fn){
        const [header,body]=read(f).slice(4).split('\n---\n');const props=JSON.parse(header);
        fn(props);put(f,'---\n'+JSON.stringify(props)+'\n---\n'+body);
      }}};
    async function start(){const plugin=new bundle.exports.default();plugin.app=app;await plugin.onload();await ready();return plugin;}
    let plugin=await start();
    assert.equal(plugin.faviconRefreshDays,30);assert.equal(modals.length,1);
    const mark=await plugin.store.create({url:'https://example.org',title:'First'});
    await plugin.store.update(mark.id,{title:'Changed'});plugin.onunload();
    fs.writeFileSync(data,JSON.stringify({automaticFavicons:true}));
    plugin=await start();assert.equal(plugin.automaticFavicons,false);
    assert.equal(plugin.store.get(mark.id).title,'Changed');
    await assert.rejects(plugin.store.update(mark.id,{title:'stale'},undefined,mark));
    await plugin.store.delete(mark.id);plugin.onunload();
    plugin=await start();assert.equal(plugin.store.all().length,0);plugin.onunload();
    assert.equal(requests,0);
  });
} catch (err) { console.error(err.message); failed=true; }
result.push(['Native Obsidian application','NOT TESTED']);
console.table(result);
fs.writeFileSync(resolve(root,'RELEASE-VALIDATION.json'),JSON.stringify({stage,result},null,2)+'\n');
process.exitCode=failed?1:result.some(row=>row[1]==='NOT TESTED')?2:0;
