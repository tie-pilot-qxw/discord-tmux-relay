import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createInputDiagnostics} from './input-diagnostics.mjs';
import {prepareInputReplacement} from './replace-input.mjs';
import {redact,inputBlockReason} from './terminal.mjs';
const root=await mkdtemp(join(tmpdir(),'relay-diagnostics-')),dir=join(root,'private');
try{
 assert.equal(createInputDiagnostics({target:{},dir:undefined}),null);
 const target={agent:'claude',pane:'%1',pid:123};
 const d=createInputDiagnostics({dir,target,redact,details:async()=>({cursorAndMode:'cursor=2,10 size=80x24 in_mode=1 mode=copy-mode'})});
 const draft='Try \u200Bplaceholder';
 const view='PRIVATE conversation must not appear\n────────────\n❯ '+draft+'\n────────────\nPRIVATE background task';
 let keys=[];
 const original=await prepareInputReplacement({agent:'claude',readScreen:async()=>view,checkScreen:(s,o)=>inputBlockReason(s,'claude',o),validate:async()=>{},guard:async()=>{},sendKeys:async k=>keys.push(...k),pause:async()=>{},observe:d.observe}).then(()=>null,e=>e);
 assert.ok(original);assert.equal(keys.length,12);assert.ok(!keys.includes('Enter'));
 await assert.rejects(stat(dir),e=>e.code==='ENOENT','snapshots stay in memory until failure is reported');
 const id=await d.failed(original),path=join(dir,'input-failures.jsonl');
 const raw=await readFile(path,'utf8'),entry=JSON.parse(raw);
 assert.equal(entry.id,id);assert.equal(entry.snapshots.length,8);
 assert.equal(entry.snapshots[0].phase,'before-clear');assert.equal(entry.snapshots.at(-1).phase,'after-clear');
 assert.equal(entry.snapshots[0].input.draft,draft);assert.ok(entry.snapshots[0].input.codePoints.includes('U+200B'));
 assert.match(entry.snapshots[0].terminal.cursorAndMode,/copy-mode/);assert.ok(!raw.includes('PRIVATE'));
 if(process.platform!=='win32'){assert.equal((await stat(path)).mode&0o777,0o600);assert.equal((await stat(dir)).mode&0o777,0o700);}
 const secret='sk-'+'a'.repeat(32);
 for(let i=0;i<20;i++)await d.observe({view:'────────────\n❯ '+secret+'\n────────────',phase:'sample',pass:i});
 await writeFile(path,'x'.repeat(1024*1024));await d.failed(Error(secret));
 const next=await readFile(path,'utf8');assert.ok(!next.includes(secret));assert.equal(JSON.parse(next).snapshots.length,12);
 assert.equal(JSON.parse(next).snapshots[0].input.draft,draft);
 assert.deepEqual((await readdir(dir)).sort(),['input-failures.jsonl','input-failures.jsonl.1']);
 // A broken diagnostic observer must not change draft-clearing behavior.
 await prepareInputReplacement({agent:'claude',readScreen:async()=>'────────────\n❯ \n────────────',checkScreen:()=>null,validate:async()=>{},guard:async()=>{},sendKeys:async()=>assert.fail('empty composer must not get keys'),pause:async()=>{},observe:async()=>{throw Error('diagnostics unavailable');}});
 console.log('PASS: exact composer and Unicode capture, cursor/mode metadata, bounded snapshots, failure-only persistence, redaction, rotation and diagnostic failures isolated.');
}finally{await rm(root,{recursive:true});}
