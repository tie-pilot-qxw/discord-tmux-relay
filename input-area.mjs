// Claude uses the same prompt marker in its composer and background-agent list.
// Prefer the composer bounded by horizontal rules, not the last marker on screen.
export function claudeInputContext(text){
 const input=findInputArea(text,'claude');
 if(!input?.framed)return null;
 const footer=text.split('\n').slice(input.index+input.lineCount+1);
 // Inspect only the real composer/footer, never quoted conversation text.
 if(footer.some(line=>/^\s*(?:↑\/↓ to select|Enter to view\s*·\s*x to stop)(?:\s|$)/.test(line)))return 'agent-picker';
 if(/^Message @[^\n]+(?:…|\.\.\.)$/.test(input.draft)||footer.some(line=>/^\s*●\s+(?!main(?:\s|$))\S+/.test(line)))return 'subagent';
 return null;
}
export function findInputArea(text,agent){
 const lines=text.split('\n');
 const marker=agent==='claude'?/^❯(?:[\s\u00a0]|$)/:/^›(?:[\s\u00a0]|$)/;
 const candidates=lines.map((line,index)=>({line,index})).filter(x=>marker.test(x.line));
 if(agent==='claude'){
  const rule=line=>/^[─━-]{6,}/.test((line||'').trim());
  const boxes=[];
  for(const candidate of candidates){
   if(!rule(lines[candidate.index-1]))continue;
   const end=lines.findIndex((line,index)=>index>candidate.index&&rule(line));
   if(end<0)continue;
   const body=[candidate.line.slice(1),...lines.slice(candidate.index+1,end)];
   boxes.push({index:candidate.index,draft:body.join('\n').trim(),lineCount:body.length,framed:true});
  }
  if(boxes.length)return boxes.at(-1);
  // Unknown/multi-marker layouts are ambiguous: never guess from agent names.
  if(candidates.length!==1)return null;
 }
 const prompt=candidates.at(-1);
 return prompt?{index:prompt.index,draft:prompt.line.slice(1).trim(),lineCount:1,framed:false}:null;
}
