// Runs in a bounded child process: malformed/expensive TeX cannot stall the
// Discord connection. Everything is rendered locally; no remote formula API.
import {mathjax} from 'mathjax-full/js/mathjax.js';
import {TeX} from 'mathjax-full/js/input/tex.js';
import {SVG} from 'mathjax-full/js/output/svg.js';
import {liteAdaptor} from 'mathjax-full/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import sharp from 'sharp';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>400000)throw Error('Input too large');}
const items=JSON.parse(input);if(items.length>24)throw Error('Too many formulas');
function convert(tex,display){
 const doc=mathjax.document('',{InputJax:new TeX({packages:['base','ams','newcommand'],maxBuffer:16000,maxMacros:1000}),OutputJax:new SVG({fontCache:'none'})});
 const node=doc.convert(tex,{display,em:32,ex:16,containerWidth:900});
 const svg=adaptor.firstChild(node),source=adaptor.outerHTML(svg);
 if(/data-mjx-error|<merror|<image|<script|<foreignObject|(?:href|src)="(?!#)/i.test(source))throw Error('Unsupported formula');
 const box=adaptor.getAttribute(svg,'viewBox').split(/\s+/).map(Number);
 if(box.length!==4||box.some(x=>!Number.isFinite(x))||box[2]<=0||box[3]<=0)throw Error('Invalid formula dimensions');
 return {source,box};
}
function splitClauses(tex){
 let depth=0,last=0;const clauses=[];
 for(let i=0;i<tex.length;i++){
  if(tex[i]==='\\'&&tex[i+1]&&/[{}]/.test(tex[i+1])){i++;continue;}
  if(tex[i]==='{')depth++;else if(tex[i]==='}')depth--;
  if(depth===0&&tex.startsWith('\\qquad',i)){clauses.push(tex.slice(last,i).trim());i+=5;last=i+1;}
 }
 clauses.push(tex.slice(last).trim());return clauses;
}
const output=[];
for(const item of items){
 try{
  if(item.tex.length>12000)throw Error('Formula too large');
  let rendered=convert(item.tex,item.display);
  // Long chains separated by explicit wide spaces fit phones better stacked.
  if(item.display&&rendered.box[2]*0.032>850){const clauses=splitClauses(item.tex);if(clauses.length>1)rendered=convert('\\begin{gathered}'+clauses.join('\\\\[0.5em]')+'\\end{gathered}',true);}
  const {box,source}=rendered,padding=24,scale=0.032;
  const width=Math.ceil(box[2]*scale)+padding*2,height=Math.ceil(box[3]*scale)+padding*2;
  if(width>5000||height>5000||width*height>8000000)throw Error('Formula dimensions exceed limit');
  const body=source.replace(/<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" rx="12" fill="#f7f8fc"/><g color="#20232a" fill="#20232a" transform="translate(${padding},${padding}) scale(${scale}) translate(${-box[0]},${-box[1]})">${body}</g></svg>`;
  const png=await sharp(Buffer.from(svg),{density:144,limitInputPixels:32000000}).png().toBuffer();
  output.push({png:png.toString('base64'),width:width*2,height:height*2});
 }catch{output.push(null);}
}
process.stdout.write(JSON.stringify(output));
