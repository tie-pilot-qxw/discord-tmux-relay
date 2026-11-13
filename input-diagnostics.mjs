import {mkdir,chmod,stat,rename,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {findInputArea} from './input-area.mjs';

let writing=Promise.resolve();
export function createInputDiagnostics({dir,target,redact=s=>s,details=async()=>({})}){
 if(!dir)return null;
 const id=randomUUID(),startedAt=new Date().toISOString(),snapshots=[];
 const clean=s=>redact(String(s??'')).slice(0,4096);
 return {
  async observe({view,phase,pass,reason}){
   const input=findInputArea(view,target.agent),lines=view.split('\n');
   const draft=clean(input?.draft),extra=await details().catch(()=>({unavailable:true}));
   const sample={at:new Date().toISOString(),phase,pass,reason:reason?clean(reason):null,
    input:input?{row:input.index,lineCount:input.lineCount,framed:input.framed,draftChars:input.draft.length,draft,
     codePoints:[...draft].slice(0,128).map(c=>'U+'+c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')),
     lines:lines.slice(Math.max(0,input.index-1),input.index+Math.min(input.lineCount,12)+1).map(clean)}:null,
    terminal:extra};
   snapshots.push(sample);
   if(snapshots.length>12)snapshots.splice(1,1); // Keep first and most recent observations.
  },
  async failed(error){
   const entry={id,startedAt,failedAt:new Date().toISOString(),agent:target.agent,pane:target.pane,pid:target.pid,
    error:clean(error.message),snapshots};
   const line=JSON.stringify(entry)+'\n';
   const task=writing.catch(()=>{}).then(async()=>{
    await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);
    const path=join(dir,'input-failures.jsonl');
    const size=await stat(path).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return 0;throw e;});
    if(size+Buffer.byteLength(line)>1024*1024)await rename(path,path+'.1');
    await appendFile(path,line,{mode:0o600});await chmod(path,0o600);
   });
   writing=task;await task;return id;
  }
 };
}
