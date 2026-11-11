import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {discordMessages} from './format.mjs';

// Recognize TeX only outside fenced/inline/indented code. Do not treat prices
// such as "$20 and $30" as formulas. Unclosed delimiters stay untouched.
export function mathParts(text){
 const protectedRanges=[];let fence=null,offset=0;
 for(const line of text.split(/(?<=\n)/)){
  const marker=line.match(/^\s{0,3}(?:>\s*)*(`{3,}|~{3,})/);
  if(fence){protectedRanges.push([offset,offset+line.length]);if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
  else if(marker){fence=marker[1];protectedRanges.push([offset,offset+line.length]);}
  else if(/^(?: {4}|\t)/.test(line))protectedRanges.push([offset,offset+line.length]);
  else for(const m of line.matchAll(/(`+)([^\n]*?)\1(?!`)/g))protectedRanges.push([offset+m.index,offset+m.index+m[0].length]);
  offset+=line.length;
 }
 const protectedAt=i=>protectedRanges.some(([a,b])=>i>=a&&i<b);
 const escaped=i=>{let n=0;while(i>0&&text[--i]==='\\')n++;return n%2===1;};
 const out=[];let start=0;
 for(let i=0;i<text.length;i++){
  if(protectedAt(i)||escaped(i))continue;
  let open,close,display;
  if(text.startsWith('\\[',i)){open='\\[';close='\\]';display=true;}
  else if(text.startsWith('$$',i)){open=close='$$';display=true;}
  else if(text.startsWith('\\(',i)){open='\\(';close='\\)';display=false;}
  else if(text[i]==='$'&&text[i+1]&&!/\s|\d|\$/.test(text[i+1])){open=close='$';display=false;}
  else continue;
  let end=text.indexOf(close,i+open.length);
  while(end>=0&&(escaped(end)||protectedAt(end)))end=text.indexOf(close,end+close.length);
  if(end<0)continue;
  const tex=text.slice(i+open.length,end);
  if(!tex.trim()||(!display&&tex.includes('\n'))||(close==='$'&&(/\s$/.test(tex)||/^\d/.test(text.slice(end+1)))))continue;
  if(protectedRanges.some(([a,b])=>a<end+close.length&&b>i))continue;
  if(i>start)out.push({text:text.slice(start,i)});
  out.push({tex:tex.trim(),raw:text.slice(i,end+close.length),display});
  i=end+close.length-1;start=i+1;
 }
 if(start<text.length)out.push({text:text.slice(start)});
 return out;
}

async function renderBatch(items){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./math-render.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
  const output=[];let length=0,settled=false;
  const fail=e=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(e);};
  const timer=setTimeout(()=>fail(Error('Formula rendering timed out')),8000);
  child.on('error',fail);child.stdin.on('error',fail);child.stderr.resume();
  child.stdout.on('data',b=>{length+=b.length;if(length>16*1024*1024)fail(Error('Formula output too large'));else output.push(b);});
  child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);try{if(code!==0)throw Error('Formula renderer failed');resolve(JSON.parse(Buffer.concat(output).toString()));}catch(e){reject(e);}});
  child.stdin.end(JSON.stringify(items));
 });
}

export async function discordPayloads(text,render=renderBatch){
 const parts=mathParts(text),eligible=parts.filter(p=>p.tex&&p.tex.length<=12000).slice(0,24);
 let images=[];if(eligible.length)images=await render(eligible).catch(()=>[]);
 const out=[];let number=0;
 for(const part of parts){
  if(part.text!==undefined){for(const content of discordMessages(part.text))if(content.trim())out.push({content});continue;}
  const index=eligible.indexOf(part),image=index>=0&&images[index];
  if(image?.png){
   number++;out.push({files:[{attachment:Buffer.from(image.png,'base64'),name:`formula-${number}.png`,description:part.tex.slice(0,1000)}]});
  }else{
   // Keep source readable/copyable even if TeX is unsupported or too large.
   const safe=part.raw.replace(/```/g,'`\u200b``');
   for(const content of discordMessages(safe))out.push({content:'```latex\n'+content+'\n```'});
  }
 }
 return out;
}
