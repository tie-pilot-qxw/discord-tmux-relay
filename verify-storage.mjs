import assert from 'node:assert/strict';
import {readFile,writeFile,rename,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const source=await readFile(new URL('./bridge.mjs',import.meta.url),'utf8');
const buildSaver=new Function('state','stateFile','writeFile','rename',source.slice(source.indexOf('let saving='),source.indexOf('const token='))+';return save;');
const dir=await mkdtemp(join(tmpdir(),'relay-storage-')),path=join(dir,'state.json');
try{
 const state={offset:1};await writeFile(path,JSON.stringify(state));
 let failWrite=true,failRename=false,attempts=0,active=0,maxActive=0;
 const save=buildSaver(state,path,async(...args)=>{
  attempts++;active++;maxActive=Math.max(active,maxActive);
  try{await new Promise(r=>setTimeout(r,5));if(failWrite)throw Object.assign(Error('disk full'),{code:'ENOSPC'});await writeFile(...args);}finally{active--;}
 },async(...args)=>{if(failRename)throw Object.assign(Error('rename failed'),{code:'EIO'});await rename(...args);});
 state.offset=2;await assert.rejects(save(),e=>e.code==='ENOSPC'&&e.relayStorage);
 assert.equal(JSON.parse(await readFile(path)).offset,1,'failed temporary write must preserve last checkpoint');
 await assert.rejects(save(),/disk full/);assert.equal(attempts,2,'must actually retry each write');
 failWrite=false;state.offset=3;await save();assert.equal(JSON.parse(await readFile(path)).offset,3);
 failRename=true;state.offset=4;await assert.rejects(save(),e=>e.code==='EIO'&&e.relayStorage);
 assert.equal(JSON.parse(await readFile(path)).offset,3);
 failRename=false;state.offset=5;const a=save();state.offset=6;const b=save();await Promise.all([a,b]);
 assert.equal(maxActive,1);assert.equal(JSON.parse(await readFile(path)).offset,6,'later queued snapshot wins');

 const storageHelpers=source.slice(source.indexOf('const storageError='),source.indexOf('async function initBinding'));
 const notice=new Function('connectionMessage','redact',storageHelpers+';return pauseMessage;')(content=>({content,components:['connect']}),s=>s);
 for(const e of [Object.assign(Error('full'),{code:'ENOSPC'}),Object.assign(Error('permission'),{relayStorage:true})])assert.equal(notice(e).components,undefined);
 assert.deepEqual(notice(Error('model absent')).components,['connect']);

 // Exercise the real tick: storage failures gate delivery and are retried even
 // when there are no new transcript records. Recovery is announced only after
 // the final checkpoint succeeds.
 const tickCode=source.slice(source.indexOf('let polling=false'),source.indexOf('client.once('));
 let unavailable=true,polls=0,writes=0;const notices=[],restored=[];
 const tick=new Function('cfg','serial','refresh','save','poll','client','post','redact','pauseMessage','console',tickCode+';return tick;')(
  {bindings:[{channel:'test'}]},(_k,fn)=>fn(),async()=>{},async()=>{writes++;if(unavailable)throw Object.assign(Error('full'),{code:'ENOSPC'});},
  async()=>{polls++;},{channels:{fetch:async()=>({send:async p=>notices.push(p)})}},async(_c,p)=>restored.push(p),s=>s,notice,{error:()=>{}});
 await tick();await tick();assert.equal(polls,0);assert.equal(writes,2);assert.equal(notices.length,1);assert.equal(restored.length,0);
 unavailable=false;await tick();assert.equal(polls,1);assert.equal(restored.length,1);
 await tick();assert.equal(restored.length,1);
 console.log('PASS: write/rename failure recovery, preserved checkpoints, serialized writes, idle retries, delivery gate and storage-specific notices.');
}finally{await rm(dir,{recursive:true});}
