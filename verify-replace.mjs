import assert from 'node:assert/strict';
import {prepareInputReplacement,isInputPlaceholder} from './replace-input.mjs';
import {inputBlockReason} from './terminal.mjs';
const frame=s=>`─────────────────\n❯ ${s}\n─────────────────\n  ● main\n❯ ◯ background agent working\n`;
async function fixture({agent='claude',draft='old draft',cursor=draft.length,stuck=false,modal=false,switchAfter=Infinity}){
 let value=draft,pos=cursor,checks=0,keys=[];
 const view=()=>modal?'Do you want to proceed?\n'+frame(value):agent==='claude'?frame(value):'› '+(value||'Ask Codex to do anything')+'\n';
 const run=()=>prepareInputReplacement({agent,readScreen:async()=>view(),checkScreen:(s,o)=>inputBlockReason(s,agent,o),validate:async()=>{},guard:async()=>{if(++checks>switchAfter)throw Error('session changed');},pause:async()=>{},sendKeys:async batch=>{
  keys.push(...batch);if(stuck)return;
  for(const key of batch){
   // Readline editing: kill-to-end on an empty line consumes its newline;
   // kill-to-start at BOL consumes the previous newline. No submit key.
   if(key==='C-a')pos=value.slice(0,pos).lastIndexOf('\n')+1;
   if(key==='C-k'){let end=value.indexOf('\n',pos);if(end<0)end=value.length;else if(end===pos)end++;value=value.slice(0,pos)+value.slice(end);}
   if(key==='C-u'){let start=value.slice(0,pos).lastIndexOf('\n')+1;if(start===pos&&pos>0)start--;value=value.slice(0,start)+value.slice(pos);pos=start;}
  }
 }});
 return {run,get value(){return value;},keys};
}
for(const agent of ['claude','codex'])for(const draft of ['old draft','before\nsecond\nthird','\n\nlast','Ask Codex to do anything','中文\nsecond 😀 line'])for(const cursor of [0,Math.floor(draft.length/2),draft.length]){
 const f=await fixture({agent,draft,cursor});await f.run();assert.equal(f.value,'');assert.ok(f.keys.length);assert.ok(f.keys.every(k=>['C-a','C-k','C-u'].includes(k)));
}
const modal=await fixture({modal:true});await assert.rejects(modal.run);assert.equal(modal.keys.length,0);
const switched=await fixture({switchAfter:0});await assert.rejects(switched.run,/session changed/);assert.equal(switched.value,'old draft');
const mid=await fixture({switchAfter:1});await assert.rejects(mid.run,/session changed/);assert.ok(!mid.keys.includes('Enter'));
const stuck=await fixture({stuck:true});await assert.rejects(stuck.run);assert.ok(stuck.keys.length<=15);
assert.equal(isInputPlaceholder('Ask Codex to do anything plus real draft'),false);
console.log('PASS: Discord replaces single/multiline drafts from any cursor; placeholder-shaped drafts clear; no submit/interrupt keys; modals, target changes and failed clears block.');
