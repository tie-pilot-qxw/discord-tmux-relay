import {findInputArea} from './input-area.mjs';

export function isInputPlaceholder(text){
 return /^(?:Ask Codex to do anything|Type a message|Try "[^"\n]+")$/.test(text.trim());
}

// Use editing keys only. Escape/Ctrl+C could interrupt the agent, and Ctrl+D
// could exit it. A bounded loop clears both sides of an arbitrary cursor and
// crosses logical newlines without submitting the old draft.
export async function prepareInputReplacement({agent,readScreen,checkScreen,validate,guard,sendKeys,pause,maxPasses=64}){
 let previous=null,unchanged=0;
 for(let pass=0;pass<maxPasses;pass++){
  await validate();await guard();
  const view=await readScreen(),reason=checkScreen(view,{allowDraft:true});
  if(reason)throw Error(reason);
  if(agent==='claude'&&!findInputArea(view,agent)?.framed)throw Error('Cannot identify the Claude composer boundaries. No draft was replaced.');
  // Normalize even a placeholder-looking draft once: actual user text can
  // equal a placeholder, so text matching alone must never bypass deletion.
  await validate();await sendKeys(['C-a','C-k','C-u']);await pause();
  await validate();await guard();
  const next=await readScreen(),blocked=checkScreen(next,{allowDraft:true});
  if(blocked)throw Error(blocked);
  const input=findInputArea(next,agent);
  // Codex renders its placeholder only when the entire buffer is empty; a
  // blank first line alone is insufficient proof for a multiline draft.
  const empty=agent==='codex'?isInputPlaceholder(input.draft):input.lineCount===1&&(!input.draft||isInputPlaceholder(input.draft));
  if(empty)return;
  if(input.draft===previous)unchanged++;else unchanged=0;
  if(unchanged>=3)break;
  previous=input.draft;
 }
 throw Error('Unable to confirm that the draft is empty. The new message was not sent.');
}
