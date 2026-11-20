import {createHash,randomUUID} from 'node:crypto';
import {findInputArea} from './input-area.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
export function parseApproval(text,agent){
 if(!['claude','codex'].includes(agent))return null;
 const lines=text.trimEnd().split('\n');
 const questions=lines.map((line,index)=>/^\s*(?:Do you want to proceed\?|Would you like to run the following command\?)\s*$/.test(line)?index:-1).filter(i=>i>=0);
 if(questions.length!==1)return null;
 const question=questions[0],options=[];let footer=-1;
 for(let row=question+1;row<lines.length;row++){
  const line=lines[row];if(!line.trim())continue;
  const m=line.match(/^\s*([❯›])?\s*([1-9])\.\s+(.+?)\s*$/);
  if(m){options.push({number:Number(m[2]),label:m[3],selected:!!m[1],row});continue;}
  if(/^(?:\s*)(?:Esc to cancel|Press enter to confirm|Enter to confirm)(?:\s|\.|$)/i.test(line)){footer=row;break;}
  return null;
 }
 if(footer<0||options.length<2||options.length>4||options.filter(o=>o.selected).length!==1)return null;
 if(options.some((o,i)=>o.number!==i+1))return null;
 // Never expose an "always allow" or permission-mode-changing choice as Yes.
 const yes=options.findIndex(o=>/^(?:Yes|Yes, proceed)(?:\s*\(y\))?$/i.test(o.label));
 const no=options.findIndex(o=>/^(?:No|No, and tell (?:Claude|Codex) what to do differently)(?:\s*\(esc\))?$/i.test(o.label));
 if(yes<0||no<0)return null;
 const composer=findInputArea(text,agent);
 if(composer&&composer.index>question&&!options.some(o=>o.row===composer.index))return null; // Quoted dialog above a live composer.
 if(lines.slice(footer+1).some(l=>l.trim()))return null; // Not the active bottom dialog.
 // The card includes all visible context, not just a generic approval question.
 const normalized=lines.map((line,row)=>options.some(o=>o.row===row)?line.replace(/^\s*[❯›]?\s*/, ''):line.trimEnd()).join('\n');
 return {agent,text:lines.join('\n'),fingerprint:digest(normalized),options,yes,no,selected:options.findIndex(o=>o.selected)};
}

const identity=(binding,current)=>JSON.stringify([binding.channel,binding.revision,binding.server,current.key,current.target.pane,current.target.root,current.target.pid,current.target.start]);
export class ApprovalRelay{
 constructor({cfg,discover,read,keys,send,redact=s=>s,now=Date.now,language='en'}){Object.assign(this,{cfg,discover,read,keys,send,redact,now,language});this.pending=new Map();}
 label(en,zh){return this.language==='zh'?zh:en;}
 async inspect(binding){const current=await this.discover(binding);return {current,identity:identity(binding,current),prompt:parseApproval(await this.read(current.target),current.target.agent)};}
 async poll(binding){
  const live=await this.inspect(binding),previous=this.pending.get(binding.channel);
  if(!live.prompt){this.pending.delete(binding.channel);return;}
  if(previous?.identity===live.identity&&previous.prompt.fingerprint===live.prompt.fingerprint&&(previous.spent||previous.expires>this.now()))return;
  const record={...live,token:randomUUID().replaceAll('-',''),expires:this.now()+10*60*1000,spent:false};
  const content=this.redact(live.prompt.text);
  const heading=this.label('**Terminal approval — choose once**','**终端等待确认：请选择本次操作**');
  const instructions=this.label('Only the owner can use these buttons. They expire when the prompt changes or after 10 minutes.','仅你本人可操作；内容变化或超过 10 分钟后按钮失效。');
  const payload={content:heading+'\n'+instructions,allowedMentions:{parse:[]},components:[{type:1,components:[
   {type:2,style:3,label:'Yes',custom_id:`relay-approval:${record.token}:yes`},
   {type:2,style:4,label:'No',custom_id:`relay-approval:${record.token}:no`}
  ]}]};
  if(content.length<1500&&!content.includes('```'))payload.content+='\n```text\n'+content+'\n```';
  else{payload.content+='\n'+this.label('Read the attached terminal prompt before choosing.','请先查看附件里的终端确认内容，再选择。');payload.files=[{attachment:Buffer.from(content),name:'terminal-approval.txt'}];}
  const message=await this.send(binding.channel,payload);record.messageId=message.id;
  this.pending.set(binding.channel,record);
 }
 async choose({channel,owner,guild,messageId,token,choice}){
  if(owner!==this.cfg.owner||guild!==this.cfg.guild)throw Error(this.label('Only the configured owner can approve.','只有配置的本人账号可以操作。'));
  const record=this.pending.get(channel),binding=this.cfg.bindings.find(b=>b.channel===channel);
  if(!binding||!record||record.token!==token||record.messageId!==messageId||record.spent||record.expires<=this.now()||!['yes','no'].includes(choice))throw Error(this.label('This approval expired or was already used. Wait for the current approval card.','这条审批已失效或已经处理，请使用当前的审批卡片。'));
  const check=async()=>{
   if(!this.cfg.bindings.includes(binding))throw Error(this.label('The channel binding changed.','频道绑定已变化，未发送选择。'));
   const live=await this.inspect(binding);
   if(live.identity!==record.identity||live.prompt?.fingerprint!==record.prompt.fingerprint)throw Error(this.label('The terminal or approval changed. No choice was submitted.','终端或审批内容已变化，未提交选择。'));
   return live;
  };
  let live=await check();
  const selected=record.prompt[choice];
  for(let step=0;step<4&&live.prompt.selected!==selected;step++){
   const previous=live.prompt.selected,delta=previous<selected?1:-1;
   await this.keys(live.current.target,[delta>0?'Down':'Up']);
   let changed=false;
   for(let n=0;n<12;n++){
    await new Promise(r=>setTimeout(r,80));live=await check();
    if(live.prompt.selected!==previous){changed=true;break;}
   }
   if(!changed||live.prompt.selected!==previous+delta)throw Error(this.label('Selection did not update as expected; nothing was confirmed.','选项没有按预期更新，未按确认。'));
  }
  live=await check();if(live.prompt.selected!==selected)throw Error(this.label('Selection changed; nothing was confirmed.','选项发生变化，未按确认。'));
  record.spent=true; // Consume before confirmation; never retry an ambiguous Enter.
  await this.keys(live.current.target,['Enter']);
  return this.label(`Sent ${choice==='yes'?'Yes':'No'} to this terminal approval.`,`已向这一次终端确认发送 ${choice==='yes'?'Yes':'No'}。`);
 }
}

export function attachApprovals({client,cfg,serial,discover,read,keys,redact,language}){
 const relay=new ApprovalRelay({cfg,discover,read,keys,redact,language,send:async(channel,payload)=>(await client.channels.fetch(channel)).send(payload)});
 let stopped=false,polling=false,timer;
 const tick=async()=>{
  if(stopped||polling)return;polling=true;
  try{for(const b of cfg.bindings)await serial(b.channel,async()=>{if(!stopped&&cfg.bindings.includes(b))await relay.poll(b);}).catch(()=>{});}
  finally{polling=false;}
 };
 client.once('ready',()=>{timer=setInterval(()=>tick(),3000);});
 client.on('interactionCreate',async i=>{
  if(stopped||!i.isButton?.()||!i.customId.startsWith('relay-approval:'))return;
  if(i.user?.id!==cfg.owner||i.guildId!==cfg.guild){await i.reply({content:relay.label('Only the configured owner can approve.','只有配置的本人账号可以操作。'),ephemeral:true}).catch(()=>{});return;}
  try{
   await i.deferReply({ephemeral:true});const [,token,choice]=i.customId.split(':');
   const content=await serial(i.channelId,()=>{if(stopped)throw Error('Relay is restarting.');return relay.choose({channel:i.channelId,owner:i.user.id,guild:i.guildId,messageId:i.message.id,token,choice});});
   await i.editReply({content,allowedMentions:{parse:[]}});
   await i.message.edit({components:[]}).catch(()=>{});
  }catch(e){const payload={content:redact(e.message),allowedMentions:{parse:[]}};if(i.deferred)await i.editReply(payload).catch(()=>{});else await i.reply({...payload,ephemeral:true}).catch(()=>{});}
 });
 return {stop(){stopped=true;clearInterval(timer);}};
}
