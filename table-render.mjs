import sharp from 'sharp';
import {fileURLToPath} from 'node:url';
import {displayWidth,wrapCell} from './format.mjs';

const escape=s=>s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const clean=s=>s.replace(/`([^`]+)`/g,'$1').replace(/\*\*([^*]+)\*\*/g,'$1');

// Fixed-size pages prevent mobile clients from reflowing cells. Extremely tall
// rows continue on the next page; source Markdown is always attached separately.
export function layoutTable({headers,rows}){
 if(!headers.length||headers.length>24||rows.length>5000)throw Error('Table exceeds image limits');
 const desired=headers.map((h,c)=>Math.max(4,...[h,...rows.map(r=>r[c]||'')].map(s=>Math.max(...wrapCell(clean(s),10000).map(displayWidth)))));
 const widths=desired.map(w=>Math.min(w,Math.max(8,Math.floor(75/headers.length))));
 let spare=90-widths.reduce((a,b)=>a+b,0);
 while(spare>0){let changed=false;for(let c=0;c<widths.length&&spare>0;c++)if(widths[c]<Math.min(desired[c],52)){widths[c]++;spare--;changed=true;}if(!changed)break;}
 const pixels=widths.map(w=>w*15+32),width=pixels.reduce((a,b)=>a+b,0)+32;
 if(width>3600)throw Error('Table too wide');
 const lines=row=>widths.map((w,c)=>wrapCell(clean(row[c]||''),w));
 const head=lines(headers),headCount=Math.max(...head.map(c=>c.length));
 if(headCount>12)throw Error('Header too tall');
 const headHeight=headCount*36+24,capacity=Math.floor((1560-headHeight-90)/36);
 const pages=[];let page=[],used=0;
 const flush=()=>{if(page.length){pages.push(page);page=[];used=0;if(pages.length>80)throw Error('Too many table pages');}};
 rows.forEach((row,index)=>{
  const columns=lines(row),count=Math.max(...columns.map(c=>c.length));
  if(count+1<=capacity&&used+count+1>capacity)flush();
  for(let start=0;start<count;){
   if(capacity-used<2)flush();
   const take=Math.min(count-start,capacity-used-1);
   page.push({index,continued:start>0,columns:columns.map(c=>c.slice(start,start+take)),height:take*36+24});
   used+=take+1;start+=take;if(start<count)flush();
  }
 });flush();
 return {pages,head,headHeight,pixels,width};
}

export async function renderTable(table){
 const layout=layoutTable(table),{pages,head,headHeight,pixels,width}=layout,out=[];
 for(let n=0;n<pages.length;n++){
  const page=pages[n],height=82+headHeight+page.reduce((s,r)=>s+r.height,0);
  let y=54,svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f7f8fc"/><g font-family="Noto Sans Mono CJK SC,monospace" font-size="24" fill="#202533"><text x="16" y="34" font-size="20">Table · ${n+1}/${pages.length}</text>`;
  const row=(columns,h,fill,bold=false)=>{
   let x=16;
   columns.forEach((lines,c)=>{
    svg+=`<rect x="${x}" y="${y}" width="${pixels[c]}" height="${h}" fill="${fill}" stroke="#cbd2df"/>`;
    lines.forEach((line,i)=>{svg+=`<text x="${x+16}" y="${y+32+i*36}"${bold?' font-weight="bold"':''}>${escape(line)}</text>`;});x+=pixels[c];
   });y+=h;
  };
  row(head,headHeight,'#dfe9fa',true);
  for(const r of page)row(r.columns,r.height,r.index%2?'#edf1f7':'#ffffff');
  svg+='</g></svg>';
  out.push({png:(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')});
 }
 return out;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 let input='';for await(const b of process.stdin){input+=b;if(input.length>1000000)throw Error('Table input too large');}
 process.stdout.write(JSON.stringify(await renderTable(JSON.parse(input))));
}
