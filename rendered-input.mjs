import {stripVTControlCharacters} from 'node:util';
import {findInputArea,claudeInputContext} from './input-area.mjs';

// Read SGR attributes across line boundaries. Never classify by suggested words:
// the same words, once accepted or typed, must be treated as a real draft.
function styledLines(raw){
 let dim=false,fg='default';const lines=[[]];
 const tokens=raw.matchAll(/\x1b\[([0-9;:]*)m|([^\x1b]+)/g);
 for(const token of tokens){
  if(token[1]!==undefined){
   const a=(token[1]||'0').split(/[;:]/).map(Number);
   for(let i=0;i<a.length;i++){
    const n=a[i];
    if(n===0){dim=false;fg='default';}
    else if(n===2)dim=true;
    else if(n===22)dim=false;
    else if(n===39)fg='default';
    else if(n>=30&&n<=37||n>=90&&n<=97)fg=String(n);
    else if(n===38||n===48){
     const mode=a[++i],count=mode===5?1:mode===2?3:0;
     const values=a.slice(i+1,i+1+count);i+=count;
     if(n===38)fg=[mode,...values].join(';');
    }
   }
  }else{
   for(const ch of token[2]){
    if(ch==='\n')lines.push([]);
    else for(let i=0;i<ch.length;i++)lines.at(-1).push({dim,fg});
   }
  }
 }
 return lines;
}

export function inspectRenderedInput(raw,{before,after}={}){
 const text=stripVTControlCharacters(raw),input=findInputArea(text,'claude');
 const result={text,input,suggestion:false};
 if(/\x1b(?!\[[0-9;:]*m)/.test(raw))return result;
 // Require a live, stable cursor at the empty input position. Dim text in a
 // viewer, picker, inactive composer, or after a real prefix is not evidence.
 if(!input?.framed||!input.draft||claudeInputContext(text)||!before||before!==after)return result;
 const [x,y,inMode,visible]=before.split(',').map(Number);
 if(x!==2||y!==input.index||inMode!==0||visible!==1)return result;
 if(!/^❯[ \u00a0]/.test(text.split('\n')[input.index]))return result;
 const styles=styledLines(raw),lines=text.split('\n');let count=0;
 for(let row=input.index;row<input.index+input.lineCount;row++){
  const start=row===input.index?2:0;
  for(let col=start;col<lines[row].length;col++){
   if(/\s/.test(lines[row][col]))continue;
   const style=styles[row]?.[col];
   if(!style?.dim)return result;
   count++;
  }
 }
 result.suggestion=count>0;
 return result;
}
