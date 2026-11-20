import assert from 'node:assert/strict';
import {ApprovalRelay,parseApproval} from './approvals.mjs';
const dialog=(selected=0,command='echo approval-test')=>`Bash command\n${command}\n\nDo you want to proceed?\n${selected===0?'❯':' '} 1. Yes\n${selected===1?'❯':' '} 2. No\n\nEsc to cancel · Tab to amend · ctrl+x ctrl+k twice to stop background agents\n`;
for(const agent of ['claude','codex']){
 const a=parseApproval(dialog(),agent),b=parseApproval(dialog(1),agent);
 assert.ok(a);assert.equal(a.fingerprint,b.fingerprint);assert.notEqual(a.selected,b.selected);
 assert.equal(parseApproval(dialog().replace('1. Yes','1. Yes, always allow'),agent),null);
 assert.equal(parseApproval(dialog()+'\n─────────────────\n❯ \n─────────────────',agent),null);
 assert.equal(parseApproval('Explain Do you want to proceed?\n1. Yes\n2. No',agent),null);
 assert.equal(parseApproval(dialog().replace('❯',' '),agent),null);
 assert.equal(parseApproval(dialog().replace('2. No','4. No'),agent),null);
}
const codex='Would you like to run the following command?\n\n› 1. Yes, proceed (y)\n  2. Yes, and do not ask again (p)\n  3. No, and tell Codex what to do differently (esc)\n\nPress enter to confirm or esc to cancel';
assert.equal(parseApproval(codex,'codex').no,2);
function fixture(){
 let text=dialog(),time=0,pid=11,key='claude:session',messages=[],keys=[];
 const cfg={owner:'owner',guild:'guild',bindings:[{channel:'channel',revision:'r'}]};
 const relay=new ApprovalRelay({cfg,now:()=>time,discover:async()=>({key,target:{pid,start:'1',root:1,pane:'%0',agent:'claude'}}),read:async()=>text,
 keys:async(_target,batch)=>{keys.push(...batch);if(batch[0]==='Down')text=dialog(1);if(batch[0]==='Up')text=dialog(0);if(batch[0]==='Enter')text='normal composer';},
 send:async(_channel,payload)=>{messages.push(payload);return {id:'message'+messages.length};}});
 const args=()=>({channel:'channel',guild:'guild',owner:'owner',messageId:'message'+messages.length,token:relay.pending.get('channel')?.token,choice:'yes'});
 return {relay,cfg,messages,keys,args,setText:t=>text=t,setPid:p=>pid=p,setSession:k=>key=k,setTime:t=>time=t};
}
for(const choice of ['yes','no']){
 const f=fixture();await f.relay.poll(f.cfg.bindings[0]);await f.relay.poll(f.cfg.bindings[0]);assert.equal(f.messages.length,1);
 const args={...f.args(),choice};await f.relay.choose(args);
 assert.deepEqual(f.keys,choice==='yes'?['Enter']:['Down','Enter']);
 await assert.rejects(()=>f.relay.choose(args));
 assert.equal(f.keys.filter(k=>k==='Enter').length,1);
}
for(const mutate of [f=>f.setPid(12),f=>f.setSession('claude:new'),f=>f.setText(dialog(0,'different command')),f=>f.setText('normal composer'),f=>f.cfg.bindings[0].revision='new',f=>f.setTime(600001)]){
 const f=fixture();await f.relay.poll(f.cfg.bindings[0]);const args=f.args();mutate(f);await assert.rejects(()=>f.relay.choose(args));assert.equal(f.keys.length,0);
}
for(const override of [{owner:'intruder'},{guild:'other'},{channel:'other'},{messageId:'other'},{choice:'always'},{token:'bad'}]){
 const f=fixture();await f.relay.poll(f.cfg.bindings[0]);await assert.rejects(()=>f.relay.choose({...f.args(),...override}));assert.equal(f.keys.length,0);
}
{
 const f=fixture();await f.relay.poll(f.cfg.bindings[0]);const args={...f.args(),choice:'no'};
 f.relay.keys=async(_t,k)=>{f.keys.push(...k);f.setText(dialog(1,'changed while navigating'));};
 await assert.rejects(()=>f.relay.choose(args));assert.ok(!f.keys.includes('Enter'));
}
{
 const f=fixture();f.setText(dialog(0,'long context '.repeat(200)));await f.relay.poll(f.cfg.bindings[0]);assert.ok(f.messages[0].files[0].attachment.length>1500);
}
console.log('PASS: approval parsing, owner/channel/message binding, expiry, process/session changes, navigation race, one-time submission, dedup and full-context attachment.');

// A custom question reply must reach chat only after dismissing this question.
{
 const question='Which colour?\n❯ 1. Blue\n  2. Green\n  3. Type something.\n  4. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel';
 const f=fixture();f.setText(question);
 await f.relay.poll(f.cfg.bindings[0]);const args={...f.args(),choice:'reply',answer:'I cannot choose.'};
 assert.equal(f.messages[0].components[0].components.length,1);
 assert.match(f.messages[0].components[0].components[0].custom_id,/^relay-question:/);
 await assert.rejects(()=>f.relay.choose({...args,choice:'yes'}));
 await assert.rejects(()=>f.relay.choose({...args,answer:'/quit'}));
 f.setText(question.replace('Which colour?','Which other colour?'));
 await assert.rejects(()=>f.relay.choose(args));assert.deepEqual(f.keys,[]);
 f.setText(question);let sent;
 f.relay.replyText=async(t,text,guard)=>{await guard();assert.deepEqual(f.keys,['Escape']);sent=text;};
 await f.relay.choose(args);assert.equal(sent,args.answer);
 await assert.rejects(()=>f.relay.choose(args));assert.deepEqual(f.keys,['Escape']);
 const {parseQuestion}=await import('./approvals.mjs');
 assert.equal(parseQuestion(question,'codex'),null);
 assert.equal(parseQuestion(question+'\n─────────────────\n❯ \n─────────────────','claude'),null);
 assert.equal(parseQuestion(dialog(),'claude'),null);
}
