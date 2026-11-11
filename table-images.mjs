import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function renderTableImages(table){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./table-render.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
  const output=[];let length=0,settled=false;
  const fail=e=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(e);};
  const timer=setTimeout(()=>fail(Error('Table rendering timed out')),20000);
  child.on('error',fail);child.stdin.on('error',fail);child.stderr.resume();
  child.stdout.on('data',b=>{length+=b.length;if(length>32*1024*1024)fail(Error('Table output too large'));else output.push(b);});
  child.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);try{if(code!==0)throw Error('Table renderer failed');resolve(JSON.parse(Buffer.concat(output).toString()));}catch(e){reject(e);}});
  child.stdin.end(JSON.stringify(table));
 });
}

export async function tablePayloads(table,number,render=renderTableImages){
 const images=await render(table).catch(()=>[]),name=`table-${number}`;
 const source={attachment:Buffer.from(table.raw,'utf8'),name:name+'.md',description:'Complete table source for copying'};
 if(!images.length)return [{content:'Table image unavailable; the complete table is attached.',files:[source]}];
 return images.map((image,i)=>({files:[{attachment:Buffer.from(image.png,'base64'),name:`${name}-${i+1}.png`,description:`Table ${number}, page ${i+1}/${images.length}`},...(i===images.length-1?[source]:[])]}));
}
