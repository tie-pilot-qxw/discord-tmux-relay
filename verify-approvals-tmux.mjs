import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ApprovalRelay} from './approvals.mjs';
const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'relay-approval-test-')),socket='relay-approval-'+process.pid;
const tmux=async args=>(await exec('tmux',['-L',socket,...args])).stdout;
const fixture=join(root,'fixture.py');
await writeFile(fixture,`import os,sys,tty,termios
fd=sys.stdin.fileno();old=termios.tcgetattr(fd);tty.setraw(fd);selected=0
def render():
 text='Bash command\\r\\necho isolated-approval-test\\r\\n\\r\\nDo you want to proceed?\\r\\n'
 text+=('❯' if selected==0 else ' ')+' 1. Yes\\r\\n'
 text+=('❯' if selected==1 else ' ')+' 2. No\\r\\n\\r\\nEsc to cancel · Tab to amend\\r\\n'
 os.write(1,('\\x1b[2J\\x1b[H'+text).encode())
try:
 if sys.argv[2]=='reply':
  os.write(1,'Which colour?\\r\\n❯ 1. Blue\\r\\n  2. Type something.\\r\\nEnter to select · ↑/↓ to navigate · Esc to cancel'.encode())
  assert os.read(fd,1)==b'\\x1b'
  os.write(1,'\\x1b[2J\\x1b[HChat ready'.encode())
  data=b''
  while True:
   ch=os.read(fd,1)
   if ch==b'\\r':break
   data+=ch
  with open(sys.argv[1],'wb') as f:f.write(data)
  sys.exit(0)
 render()
 while True:
  ch=os.read(fd,1)
  if ch==b'\\x1b':
   seq=ch+os.read(fd,2)
   if seq==b'\\x1b[B':selected=min(1,selected+1)
   if seq==b'\\x1b[A':selected=max(0,selected-1)
   render()
  elif ch in [b'\\r',b'\\n']:
   with open(sys.argv[1],'w') as f:f.write('yes' if selected==0 else 'no')
   break
finally:termios.tcsetattr(fd,termios.TCSADRAIN,old)
`);
try{
 for(const choice of ['yes','no','reply']){
  const output=join(root,choice+'.txt');
  await tmux(['new-session','-d','-s','probe','-x','100','-y','30','python3',fixture,output,choice]);
  const cfg={owner:'owner',guild:'guild',bindings:[{channel:'channel',revision:'revision'}]};
  const relay=new ApprovalRelay({cfg,discover:async()=>({key:'test',target:{pane:'probe:0.0',pid:1,start:'test',agent:'claude'}}),read:async()=>tmux(['capture-pane','-p','-t','probe:0.0']),keys:async(t,k)=>tmux(['send-keys','-t',t.pane,...k]),send:async()=>({id:'card'})});
  for(let i=0;i<40&&!relay.pending.has('channel');i++){await new Promise(r=>setTimeout(r,50));await relay.poll(cfg.bindings[0]);}
  assert.ok(relay.pending.has('channel'));
  const answer='I cannot choose.';
  relay.replyText=async(target,text,guard)=>{
   await guard();
   for(let i=0;i<30;i++){
    if((await relay.read(target)).includes('Chat ready'))break;
    await new Promise(r=>setTimeout(r,40));
   }
   assert.match(await relay.read(target),/Chat ready/);
   await tmux(['send-keys','-t',target.pane,'-l',text]);
   await tmux(['send-keys','-t',target.pane,'Enter']);
  };
  await relay.choose({channel:'channel',owner:'owner',guild:'guild',messageId:'card',token:relay.pending.get('channel').token,choice,answer});
  let result;for(let i=0;i<40;i++){result=await readFile(output,'utf8').catch(()=>null);if(result)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(result,choice==='reply'?answer:choice);await tmux(['kill-server']).catch(()=>{});
 }
 console.log('PASS: real isolated tmux/PTY receives Yes, No and a custom chat reply through the approval adapter; no model or real command was started.');
}finally{await tmux(['kill-server']).catch(()=>{});await rm(root,{recursive:true,force:true});}
