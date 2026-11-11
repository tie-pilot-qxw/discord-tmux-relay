// Keep each native assistant message visually distinct, including all of its
// table chunks and formula images. System notices remain ungrouped.
export function groupReply(payloads,number,{label='Reply'}={}){
 if(!Number.isSafeInteger(number)||number<1)throw Error('Invalid reply number');
 const count=payloads.length;
 return payloads.map((payload,index)=>{
  const part=count>1?` · ${index+1}/${count}`:'';
  const heading=index===0?`**━━━━ ${label} ${number}${part} ━━━━**`:`**↳ ${label} ${number}${part}**`;
  const content=heading+(payload.content?'\n\n'+payload.content:'');
  if(content.length>2000)throw Error('Grouped reply exceeds Discord message limit');
  return {...payload,content};
 });
}
