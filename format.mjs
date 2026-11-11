// Discord has no pipe-table renderer. Convert only recognized, unfenced
// tables; preserve every cell and keep each emitted table block self-contained.
import {chunks} from './chat.mjs';
const segmenter=new Intl.Segmenter('en',{granularity:'grapheme'});
const graphemes=s=>Array.from(segmenter.segment(s),x=>x.segment);
export function displayWidth(s){
 let width=0;
 for(const g of graphemes(s)){
  if(/^[\p{Mark}\u200b-\u200f\uFEFF]+$/u.test(g))continue;
  if(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(g)){width+=2;continue;}
  const cp=g.codePointAt(0);
  width+=(cp>=0x1100&&(cp<=0x115f||cp===0x2329||cp===0x232a||(cp>=0x2e80&&cp<=0xa4cf&&cp!==0x303f)||(cp>=0xac00&&cp<=0xd7a3)||(cp>=0xf900&&cp<=0xfaff)||(cp>=0xfe10&&cp<=0xfe19)||(cp>=0xfe30&&cp<=0xfe6f)||(cp>=0xff00&&cp<=0xff60)||(cp>=0xffe0&&cp<=0xffe6)||(cp>=0x20000&&cp<=0x3fffd)))?2:1;
 }
 return width;
}
export function cells(line){
 let text=line.trim(),parts=[],cell='',ticks=0,pipes=0;
 for(let i=0;i<text.length;){
  if(text[i]==='\\'&&i+1<text.length){cell+=text.slice(i,i+2);i+=2;continue;}
  if(text[i]==='`'){let j=i;while(text[j]==='`')j++;const run=j-i;if(!ticks)ticks=run;else if(ticks===run)ticks=0;cell+=text.slice(i,j);i=j;continue;}
  if(text[i]==='|'&&!ticks){parts.push(cell.trim());cell='';pipes++;i++;continue;}
  cell+=text[i++];
 }
 parts.push(cell.trim());if(!pipes)return null;
 if(text.startsWith('|')&&parts[0]==='')parts.shift();
 if(parts.at(-1)===''&&text.endsWith('|'))parts.pop();
 return parts;
}
function wrapCell(text,width){
 const out=[];
 for(const line of text.replace(/\\\|/g,'|').replace(/<br\s*\/?>/gi,'\n').replace(/\t/g,'    ').replace(/`{3}/g,'`\u200b``').split('\n')){
  let part='',used=0;
  // Keep technical identifiers/paths together when they fit on one line.
  const tokens=line.match(/[A-Za-z0-9_./:\-]+|[^A-Za-z0-9_./:\-]+/gu)||[];
  for(const token of tokens){
   const n=displayWidth(token);
   if(/^[A-Za-z0-9_./:\-]+$/.test(token)&&n<=width){if(used+n>width&&part){out.push(part);part='';used=0;}part+=token;used+=n;continue;}
   for(const g of graphemes(token)){const size=displayWidth(g);if(used+size>width&&part){out.push(part);part='';used=0;}part+=g;used+=size;}
  }
  out.push(part);
 }
 return out;
}
function tableLines(headers,rows){
 const all=[headers,...rows],count=headers.length;
 const desired=headers.map((_,col)=>Math.max(1,...all.map(row=>Math.max(...wrapCell(row[col]||'',10000).map(displayWidth)))));
 // Short columns (row numbers, percentages) give their unused space to prose.
 const budget=Math.max(count*8,60-(count-1)*3);
 const cap=Math.max(8,Math.min(32,Math.floor(budget/count)));
 const widths=desired.map(w=>Math.min(cap,w));
 let spare=budget-widths.reduce((a,b)=>a+b,0);
 while(spare>0){let changed=false;for(let col=0;col<count&&spare>0;col++)if(widths[col]<Math.min(desired[col],40)){widths[col]++;spare--;changed=true;}if(!changed)break;}
 const render=row=>{
  const columns=widths.map((w,col)=>wrapCell(row[col]||'',w));
  return Array.from({length:Math.max(...columns.map(c=>c.length))},(_,line)=>columns.map((c,col)=>{const s=c[line]||'';return s+' '.repeat(widths[col]-displayWidth(s));}).join(' | ').trimEnd());
 };
 const rule=widths.map(w=>'-'.repeat(w)).join('-+-'),rendered=rows.map(render);
 return {head:[...render(headers),rule],rule,rows:rendered,multiline:rendered.some(r=>r.length>1)};
}
export function tableMessages(headers,rows,limit=1800){
 const layout=tableLines(headers,rows),out=[],open='```text\n',close='\n```';
 const header=layout.head.join('\n');
 // Pathological very-wide tables must not exceed Discord's message limit.
 // Keep their original cell content in smaller fenced blocks if necessary.
 if(open.length+header.length+close.length>limit/2){
  const raw=[headers,...rows].map(r=>r.join(' | ')).join('\n');return chunks(raw,limit-open.length-close.length).map(s=>open+s+close);
 }
 let body=header;
 for(const lines of layout.rows){
  const row=lines.join('\n');
  const divider=layout.multiline&&body!==header?'\n'+layout.rule:'';
  if(body.length+divider.length+row.length+1+open.length+close.length<=limit){body+=divider+'\n'+row;continue;}
  if(body!==header){out.push(open+body+close);body=header;}
  for(const line of lines){
   if(body.length+line.length+1+open.length+close.length>limit){out.push(open+body+close);body=header;}
   body+='\n'+line;
  }
 }
 if(body!==header||!out.length)out.push(open+body+close);
 return out;
}
export function discordMessages(text,limit=1800){
 const lines=text.split('\n'),out=[];let plain=[],fence=null;
 const flush=()=>{if(plain.length){out.push(...chunks(plain.join('\n'),limit));plain=[];}};
 for(let i=0;i<lines.length;i++){
  const line=lines[i],marker=line.match(/^\s*(?:>\s*)*(`{3,}|~{3,})/);
  if(marker){if(!fence)fence={char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length)fence=null;plain.push(line);continue;}
  if(fence||/^ {4}|^\t/.test(line)){plain.push(line);continue;}
  const headers=cells(line),separator=i+1<lines.length?cells(lines[i+1]):null;
  if(!headers?.length||!separator||separator.length!==headers.length||!separator.every(c=>/^:?-{3,}:?$/.test(c))){plain.push(line);continue;}
  const rows=[];let end=i+2,invalid=false;
  for(;end<lines.length;end++){const row=cells(lines[end]);if(!row||!lines[end].trim())break;if(row.length>headers.length){invalid=true;break;}rows.push([...row,...Array(headers.length-row.length).fill('')]);}
  if(invalid||!rows.length){plain.push(line);continue;}
  flush();out.push(...tableMessages(headers,rows,limit));i=end-1;
 }
 flush();return out;
}
