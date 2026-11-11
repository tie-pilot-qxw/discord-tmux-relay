import {spawn} from 'node:child_process';
import {open,stat,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {listTerminals,tmux,processIdentity,validateTarget} from './terminal.mjs';

export async function serverIdentity(){
 let pid;try{pid=Number((await tmux(['display-message','-p','#{pid}'])).trim());}catch{throw Error('No tmux panes found. Create a pane and start a model, then use Connect terminal.');}
 return {...await processIdentity(pid),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};
}
export function sameServer(a,b){return !!a&&!!b&&a.pid===b.pid&&a.start===b.start&&(!a.boot||!b.boot||a.boot===b.boot);}
export async function discover(b){
 const server=await serverIdentity();
 if(b.server&&!sameServer(b.server,server))throw Error('The tmux server was recreated. Pane IDs may have changed; use Connect terminal again.');
 const pane=b.pane||b.target.pane;
 const target=(await listTerminals()).find(p=>p.pane===pane);
 if(!target)throw Error('No supported foreground Claude/Codex process in this pane. The relay reconnects when one starts; messages are not queued.');
 await validateTarget(target);
 const session=await new Promise((resolve,reject)=>{
  const child=spawn('python3',[fileURLToPath(new URL('./current-session.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});let out='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Session identification timed out. Please retry later.'));},5000);
  child.stdout.on('data',x=>out+=x);child.stderr.resume();child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);try{const o=JSON.parse(out);if(o.error)reject(Error(o.error));else if(code!==0)reject(Error('Unable to identify the current session.'));else resolve(o);}catch{reject(Error('Unable to identify the current session.'));}});
  child.stdin.end(JSON.stringify(target));
 });
 await validateTarget(target);
 return {target,...session,key:session.id?target.agent+':'+session.id:`pending:${target.pid}:${target.start}`};
}

export function timestamp(o){const t=Date.parse(o?.timestamp);return Number.isFinite(t)?t:null;}
// Seek backwards to the first appended record in the handover interval, so a
// fast first reply isn't dropped and old resumed history isn't imported.
export async function offsetSince(path,since){
 if(!path)return {offset:0,ino:null};
 const meta=await stat(path).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!meta)return {offset:0,ino:null};
 const f=await open(path,'r');let position=meta.size,carry=Buffer.alloc(0),scanned=0;
 try{
  while(position>0){
   const size=Math.min(256*1024,position);position-=size;const buf=Buffer.alloc(size);await f.read(buf,0,size,position);
   const data=Buffer.concat([buf,carry]);let end=data.length;
   for(let i=data.length-1;i>=0;i--){if(data[i]!==10)continue;
    const line=data.subarray(i+1,end);end=i;
    if(!line.length)continue;
    let o;try{o=JSON.parse(line.toString('utf8'));}catch{continue;}
    const time=timestamp(o);if(time!==null&&time<since)return {offset:position+i+1,ino:meta.ino};
   }
   carry=data.subarray(0,end);scanned+=size;
   if(scanned>32*1024*1024)throw Error('The handover transcript exceeds the scan limit. Forwarding is paused for inspection.');
  }
  return {offset:0,ino:meta.ino};
 }finally{await f.close();}
}

export async function adopt(s,current,now=Date.now()){
 const previous=s.active;
 const changed=!previous||previous.key!==current.key||previous.target.pid!==current.target.pid||previous.target.start!==current.target.start;
 if(!previous||previous.key!==current.key||s.log!==current.log){
  const completingPending=previous?.pending&&previous.target.pid===current.target.pid&&previous.target.start===current.target.start;
  const since=completingPending?s.since:s.lastChecked||now;
  const cursor=await offsetSince(current.log,since);
  s.offset=cursor.offset;s.ino=cursor.ino;s.since=since;s.log=current.log;
  // Dedup IDs are namespaced by native session; do not carry one conversation's
  // IDs or pending inputs into another account/session.
  s.seen=[];if(!completingPending)s.inputs=[];
 }
 s.active=current;s.lastChecked=now;
 return changed;
}
