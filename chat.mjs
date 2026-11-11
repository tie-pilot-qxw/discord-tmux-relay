import {redact} from './terminal.mjs';
export function chatMessage(o,agent){
 if(agent==='claude'){
  if(!['user','assistant'].includes(o.type)||o.isMeta||o.isSidechain||o.isCompactSummary||o.isVisibleInTranscriptOnly)return null;
  const c=o.message?.content;let text=typeof c==='string'?c:Array.isArray(c)?c.filter(x=>x.type==='text').map(x=>x.text).join('\n'):'';
  if(o.type==='user'&&/^\s*<(task-notification|command-name|command-message|local-command-caveat|local-command-stdout|bash-input|bash-stdout|bash-stderr|system-reminder|artifact-content-authored-by-others)(?:\s|\/?>)/i.test(text))return null;
  if(o.type==='user')text=text.replace(/<\/?pasted_content(?:\s[^>]*)?>/g,'').trim();
  if(!text||text.trim()==='No response requested.')return null;
  return {role:o.type,text:redact(text),id:o.uuid};
 }
 if(o.type!=='response_item'||o.payload?.type!=='message'||!['user','assistant'].includes(o.payload.role))return null;
 const text=(o.payload.content||[]).filter(x=>['input_text','output_text','text'].includes(x.type)).map(x=>x.text||'').join('\n');
 if(!text||o.payload.role==='user'&&/^\s*(?:<environment_context>|<permissions instructions>|<turn_aborted>|# AGENTS\.md)/.test(text))return null;
 return {role:o.payload.role,text:redact(text),id:o.payload.id};
}
export function chunks(text,limit=1800){
 const out=[];let rest=text;
 while(rest.length>limit){let cut=rest.lastIndexOf('\n',limit);if(cut<limit/3)cut=limit;if(cut>0&&/[\uD800-\uDBFF]/.test(rest[cut-1]))cut--;out.push(rest.slice(0,cut));rest=rest.slice(cut);}
 if(rest)out.push(rest);return out;
}
