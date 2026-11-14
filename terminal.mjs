import {createInputDiagnostics} from './input-diagnostics.mjs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {findInputArea,claudeInputContext} from './input-area.mjs';
import {prepareInputReplacement,isInputPlaceholder} from './replace-input.mjs';
const exec=promisify(execFile);
export async function tmux(args){return (await exec('tmux',args,{maxBuffer:4*1024*1024,timeout:5000})).stdout;}
export function redact(s){return String(s).replace(/\bsk-[\w-]{12,}/g,'[key redacted]').replace(/\bmfa\.[\w-]{20,}/g,'[credential redacted]').replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,}\b/g,'[credential redacted]').replace(/((?:token|api[_-]?key|password|secret)\s*[=:]\s*)["']?[^\s"']{12,}/ig,'$1[redacted]');}
export async function processIdentity(pid){
 const raw=await readFile(`/proc/${pid}/stat`,'utf8'),parts=raw.slice(raw.lastIndexOf(')')+2).split(' ');
 return {pid:Number(pid),ppid:Number(parts[1]),group:Number(parts[2]),foreground:Number(parts[5]),start:parts[19]};
}
export async function listPanes(){
 const lines=(await tmux(['list-panes','-a','-F','#{pane_id}\t#{pane_pid}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_current_path}'])).trim().split('\n');
 const panes=[];
 for(const line of lines){const [pane,pid,location,cwd]=line.split('\t');const root=await processIdentity(Number(pid)).catch(()=>null);if(root)panes.push({pane,root:root.pid,rootStart:root.start,location,cwd});}
 return panes;
}
export async function listTerminals(){
 const lines=(await tmux(['list-panes','-a','-F','#{pane_id}\t#{pane_pid}\t#{session_name}:#{window_index}.#{pane_index}\t#{pane_title}'])).trim().split('\n');
 const procs=(await exec('ps',['-u',String(process.getuid()),'-o','pid=,ppid=,comm='],{maxBuffer:4*1024*1024})).stdout.trim().split('\n').map(line=>{const [pid,ppid,...name]=line.trim().split(/\s+/);return {pid:Number(pid),ppid:Number(ppid),name:name.join(' ')};});
 const panes=[];
 for(const line of lines){
  const [pane,root,location,...title]=line.split('\t');let front=[Number(root)],found;
  for(let depth=0;depth<6&&front.length&&!found;depth++){
   const candidates=procs.filter(p=>front.includes(p.pid));
   for(const p of candidates.filter(p=>['claude','codex'].includes(p.name))){const i=await processIdentity(p.pid).catch(()=>null);if(i&&i.group===i.foreground){found=p;break;}}
   front=procs.filter(p=>front.includes(p.ppid)).map(p=>p.pid);
  }
  if(!found)continue;
  const identity=await processIdentity(found.pid).catch(()=>null);if(!identity)continue;
  const cwd=await readlink(`/proc/${found.pid}/cwd`).catch(()=>'');
  // Do not inspect or forward command-line credentials. Only PID identity is used.
  panes.push({pane,root:Number(root),location,title:redact(title.join(' ')),agent:found.name,pid:found.pid,start:identity.start,cwd});
 }
 return panes;
}
export async function validateTarget(target){
 const identity=await processIdentity(target.pid).catch(()=>null);
 if(!identity||identity.start!==target.start)throw Error('The original process exited. Check or reconnect the terminal.');
 const root=Number((await tmux(['display-message','-p','-t',target.pane,'#{pane_pid}'])).trim());
 if(root!==target.root)throw Error('The tmux pane changed. Select it again.');
 let p=identity,belongs=false;
 for(let n=0;n<8;n++){if(p.pid===root){belongs=true;break;}p=await processIdentity(p.ppid).catch(()=>null);if(!p)break;}
 if(!belongs)throw Error('The model no longer belongs to this pane. Input is blocked.');
 if(identity.group!==identity.foreground)throw Error('The selected model is not in the foreground. Check the terminal before sending input.');
 return identity;
}
export async function screen(target){await validateTarget(target);return redact(await tmux(['capture-pane','-p','-t',target.pane]));}
export function inputBlockReason(text,agent,{allowDraft=false}={}){
 if(agent==='claude'){
  const context=claudeInputContext(text);
  if(context==='agent-picker')return 'Claude is focused on the agent picker. Return to the main conversation input. Reconnecting the pane will not close this picker.';
  if(context==='subagent')return 'Claude is viewing a subagent. Return to main before sending. Message @… is a placeholder, not an uncleared draft.';
 }
 if(/esc (?:to )?close|escape (?:to )?close|enter copy|enter to (?:confirm|select)|Do you want to proceed|Allow .*(?:once|always)/i.test(text))return 'The terminal has an open dialog or selection prompt. Handle it in the terminal first.';
 const prompt=findInputArea(text,agent);if(!prompt)return 'No supported model input prompt found. Check the terminal; input was not sent.';
 const draft=prompt.draft;
 if(draft&&!allowDraft&&!isInputPlaceholder(draft))return 'The terminal contains a draft that has not been cleared.';
 return null;
}
export async function pasteLiteral(pane,text){
 if(/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('Input contains terminal control characters and was not sent.');
 const name='discord-'+randomUUID();
 await new Promise((resolve,reject)=>{const p=spawn('tmux',['load-buffer','-b',name,'-'],{stdio:['pipe','ignore','pipe']});let err='';p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(err)));p.stdin.end(text);});
 try{await tmux(['paste-buffer','-p','-d','-b',name,'-t',pane]);await new Promise(resolve=>setTimeout(resolve,180));await tmux(['send-keys','-t',pane,'Enter']);}
 finally{await tmux(['delete-buffer','-b',name]).catch(()=>{});}
}
export async function sendText(target,text,guard=async()=>{},diagnosticsDir){
 if(/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('Input contains terminal control characters and was not sent.');
 const diagnostics=createInputDiagnostics({dir:diagnosticsDir,target,redact,details:async()=>({cursorAndMode:(await tmux(['display-message','-p','-t',target.pane,'cursor=#{cursor_x},#{cursor_y} size=#{pane_width}x#{pane_height} in_mode=#{pane_in_mode} mode=#{pane_mode}'])).trim()})});
 try{
 await prepareInputReplacement({observe:diagnostics?.observe,agent:target.agent,readScreen:()=>screen(target),checkScreen:(view,options)=>inputBlockReason(view,target.agent,options),validate:()=>validateTarget(target),guard,sendKeys:keys=>tmux(['send-keys','-t',target.pane,...keys]),pause:()=>new Promise(resolve=>setTimeout(resolve,150))});
 await validateTarget(target);await guard();
 const check=await screen(target),reason=inputBlockReason(check,target.agent);
 if(reason){await diagnostics?.observe({view:check,phase:'final-check',reason}).catch(()=>{});throw Error(reason);}
 await pasteLiteral(target.pane,text);
 }catch(error){
  if(diagnostics)try{const id=await diagnostics.failed(error);console.warn('input-failure-diagnostic',JSON.stringify({id,agent:target.agent,pane:target.pane}));}catch{console.warn('input-diagnostic-write-failed');}
  throw error;
 }
}
export async function closeViewer(target){
 const view=await screen(target);
 if(!/esc (?:to )?close|escape (?:to )?close|enter copy/i.test(view))throw Error('No supported viewer detected. Escape was not sent, to avoid interrupting a running task.');
 await tmux(['send-keys','-t',target.pane,'Escape']);
}
