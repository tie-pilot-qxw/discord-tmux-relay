import {findInputArea} from './input-area.mjs';

export function isInputPlaceholder(text){
 return /^(?:Ask Codex to do anything|Type a message|Try "[^"\n]+")$/.test(text.trim());
}

// Use editing keys only. Escape/Ctrl+C could interrupt the agent, and Ctrl+D
// could exit it. A bounded loop clears both sides of an arbitrary cursor and
// crosses logical newlines without submitting the old draft.
export async function prepareInputReplacement({agent,readScreen,checkScreen,validate,guard,sendKeys,pause,maxPasses=64,settleReads=8,observe=null}){
 let unchanged=0,last=null;
 const record=async sample=>{try{await observe?.(sample);}catch{}};
 const signature=input=>JSON.stringify([input?.draft,input?.lineCount,input?.framed]);
 const empty=input=>!!input&&(agent==='codex'?isInputPlaceholder(input.draft):input.framed&&input.lineCount===1&&(!input.draft||isInputPlaceholder(input.draft)));
 for(let pass=0;pass<maxPasses;pass++){
  await validate();await guard();
  const view=await readScreen(),reason=checkScreen(view,{allowDraft:true});
  await record({view,phase:'before-clear',pass,reason});
  if(reason)throw Error(reason);
  const before=findInputArea(view,agent);
  if(agent==='claude'&&!before?.framed)throw Error('Cannot identify the Claude composer boundaries. No draft was replaced.');
  // A visibly blank, bounded composer needs no editing. Placeholder-shaped
  // text still goes through normalization because it may be a real draft.
  if(agent==='claude'&&before.lineCount===1&&!before.draft)return;
  // Normalize even a placeholder-looking draft once: actual user text can
  // equal a placeholder, so text matching alone must never bypass deletion.
  await validate();await guard();await sendKeys(['C-a','C-k','C-u']);
  let input=before,lastView=view;
  // Give a loaded terminal time to repaint before sending more editing keys.
  // Session and modal checks stay active throughout this wait.
  for(let read=0;read<settleReads;read++){
   await pause();await validate();await guard();
   const next=await readScreen(),blocked=checkScreen(next,{allowDraft:true});
   if(blocked){await record({view:next,phase:'blocked-after-clear',pass,reason:blocked});throw Error(blocked);}
   lastView=next;input=findInputArea(next,agent);
   if(empty(input))return;
   if(signature(input)!==signature(before))break;
  }
  // Codex renders its placeholder only when the entire buffer is empty; a
  // blank first line alone is insufficient proof for a multiline draft.
  await record({view:lastView,phase:'after-clear',pass});
  last=input;
  if(signature(input)===signature(before))unchanged++;else unchanged=0;
  if(unchanged>=4)break;
 }
 // The journal retains metrics only; opt-in private diagnostics capture composer text.
 console.warn('input-clear-unconfirmed',JSON.stringify({agent,lineCount:last?.lineCount,draftChars:last?.draft?.length,framed:last?.framed,unchanged}));
 throw Error('Unable to confirm that the draft is empty. The new message was not sent.');
}
