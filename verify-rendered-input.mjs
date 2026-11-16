import assert from 'node:assert/strict';
import {inspectRenderedInput} from './rendered-input.mjs';
import {inputBlockReason} from './terminal.mjs';
import {prepareInputReplacement} from './replace-input.mjs';
const frame=body=>`prior output\n─────────────────\n❯ ${body}\n─────────────────\n  ● main\n`;
const atStart={before:'2,2,0,1',after:'2,2,0,1'};
const ghost=s=>`\x1b[2m\x1b[37m${s}\x1b[0m\x1b[39m`;
const probe=(body,meta=atStart)=>inspectRenderedInput(frame(body),meta);
for(const text of ['Continue with the next step','中文建议，继续下一步','😀 another suggestion','a\nwrapped suggestion']){
 const sample=probe(ghost(text));assert.equal(sample.suggestion,true);
 assert.equal(sample.input.draft,text);
 assert.equal(inputBlockReason(sample.text,'claude',{suggestion:sample.suggestion}),null);
 assert.ok(inputBlockReason(sample.text,'claude'));
 assert.equal(probe(text).suggestion,false,'accepted/typed identical text is a real draft');
}
assert.equal(probe('typed '+ghost('completion')).suggestion,false);
assert.equal(probe('\x1b[2mfoo\x1b[22mbar').suggestion,false);
assert.equal(probe('\x1b[38;2;2;2;2mreal RGB text').suggestion,false,'RGB component 2 is not dim');
assert.equal(probe('\x1b[38;5;2mreal indexed text').suggestion,false);
assert.equal(probe('\x1b[37mgray but not dim').suggestion,false);
assert.equal(probe(ghost('suggestion'),{before:'3,2,0,1',after:'3,2,0,1'}).suggestion,false);
assert.equal(probe(ghost('suggestion'),{before:'2,2,1,1',after:'2,2,1,1'}).suggestion,false);
assert.equal(probe(ghost('suggestion'),{before:'2,2,0,0',after:'2,2,0,0'}).suggestion,false);
assert.equal(probe(ghost('suggestion'),{before:'2,2,0,1',after:'3,2,0,1'}).suggestion,false);
assert.equal(probe(ghost('suggestion'),{}).suggestion,false);
assert.equal(probe('\x1b[2mghost\x1b[K').suggestion,false,'unknown ANSI must not be trusted');
assert.equal(inspectRenderedInput(frame(ghost('Message @general-purpose…')),atStart).suggestion,false);
assert.equal(inspectRenderedInput(frame(ghost('hint')).replace('  ● main','  ↑/↓ to select\n❯ ● main'),atStart).suggestion,false);
assert.equal(inspectRenderedInput(frame(ghost('hint')).replace('  ● main','  ◯ main\n  ● general-purpose  working'),atStart).suggestion,false);
// Dim prompt markers alone are not evidence of a suggestion.
assert.equal(inspectRenderedInput(frame('actual input').replace('❯ ','\x1b[2m❯ \x1b[0m'),atStart).suggestion,false);
// Exercise replacement with actual style-derived evidence, including a suggestion
// appearing after clearing a real draft. No fake allow-list of prompt words.
for(const startsAsDraft of [false,true]){
 let raw=frame(startsAsDraft?'real draft':ghost('next prompt')),last,keys=[];
 await prepareInputReplacement({agent:'claude',
  readScreen:async()=>{last=inspectRenderedInput(raw,atStart);return last.text;},
  isSuggestion:v=>last.text===v&&last.suggestion,
  checkScreen:(v,o)=>inputBlockReason(v,'claude',{...o,suggestion:last.text===v&&last.suggestion}),
  validate:async()=>{},guard:async()=>{},pause:async()=>{},
  sendKeys:async k=>{keys.push(...k);raw=frame(ghost('next prompt'));}
 });
 assert.deepEqual(keys,startsAsDraft?['C-a','C-k','C-u']:[]);
 const final=inspectRenderedInput(frame(ghost('a late suggestion')),atStart);
 assert.equal(inputBlockReason(final.text,'claude',{suggestion:final.suggestion}),null);
 const accepted=inspectRenderedInput(frame('a late suggestion'),atStart);
 assert.ok(inputBlockReason(accepted.text,'claude',{suggestion:accepted.suggestion}));
}
console.log('PASS: styled suggestions vs identical real drafts, real prefixes, cursor/focus guards, multiline/Unicode, late suggestions and accepted suggestions.');
