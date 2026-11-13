import {readFile,writeFile,rename,stat,open} from 'node:fs/promises';
import {join} from 'node:path';
import {Client,GatewayIntentBits,REST,Routes} from 'discord.js';
import {dataDir} from './runtime.mjs';
import {createHash} from 'node:crypto';
import {sendText,validateTarget,redact} from './terminal.mjs';
import {chatMessage,chunks} from './chat.mjs';
import {discover,adopt,timestamp} from './follow.mjs';
import {ConnectionPicker,connectControls,initialState,atomicJson} from './connections.mjs';
import {discordPayloads} from './math.mjs';
import {groupReply} from './reply-groups.mjs';
import {ModelAvatars} from './model-avatars.mjs';
const dir=dataDir,cfg=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));
if(!/^\d{17,20}$/.test(cfg.owner)||!/^\d{17,20}$/.test(cfg.guild)||!Array.isArray(cfg.bindings))throw Error('Invalid config.json: run npm run init first.');
const stateFile=join(dir,'state.json');let state=JSON.parse(await readFile(stateFile,'utf8').catch(()=>'{}'));
let saving=Promise.resolve();const save=()=>{const body=JSON.stringify(state);saving=saving.catch(()=>{}).then(async()=>{try{await writeFile(stateFile+'.tmp',body,{mode:0o600});await rename(stateFile+'.tmp',stateFile);}catch(e){e.relayStorage=true;throw e;}});return saving;};
const token=(await readFile(join(dir,'discord-token'),'utf8')).trim();
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent],allowedMentions:{parse:[]}});
const hash=s=>createHash('sha256').update(typeof s==='string'?s.trim():s).digest('hex');
const queues=new Map();const serial=(key,fn)=>{const p=(queues.get(key)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(key,p);return p;};
const picker=new ConnectionPicker({cfg,persist:next=>atomicJson(join(dir,'config.json'),next)});
const modelAvatars=new ModelAvatars({avatarDir:join(dir,'avatars'),botId:()=>client.user.id,enabled:()=>cfg.modelAvatars===true});
async function post(channel,text,replyNumber,agent){const parts=await discordPayloads(redact(text));for(const payload of replyNumber?groupReply(parts,replyNumber):parts)await modelAvatars.send(channel,payload,agent);}
function info(b){if(!b)return 'This channel is not connected. Select a tmux pane with Connect terminal.';const a=state[b.channel]?.active;return `**Following tmux pane: ${b.location||b.target?.location}**\n${a?`Last identified: ${a.target.agent} · ${a.title}${a.id?`（…${a.id.slice(-8)}）`:''}`:'Waiting for the model to become ready.'}\nSend text directly. The relay follows supported session and process changes in this pane. Messages are not queued while the model is absent.\nUse Connect terminal to change panes or reconnect after a restart.`;}
const connectionMessage=content=>({content:redact(content),components:connectControls(),allowedMentions:{parse:[]}});
const storageError=e=>Boolean(e?.relayStorage||['ENOSPC','EDQUOT','EIO','EROFS'].includes(e?.code));
const pauseMessage=e=>storageError(e)?{content:'Forwarding paused: the server cannot save relay progress (storage space or disk write error). The relay retries automatically when storage is writable; switching models or reconnecting the terminal will not fix this.',allowedMentions:{parse:[]}}:connectionMessage('Forwarding paused: '+redact(e.message)+'\nThe relay reconnects when the model is ready. Use the button below to change panes or reconnect after a restart.');
async function initBinding(b){
 state[b.channel]=initialState(b,state[b.channel]);
 const s=state[b.channel];
 // Preserve the existing delivered cursor on the first upgrade.
 if(!s.active&&b.log){const id=b.log.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0];s.active={key:b.target.agent+':'+id,id,log:b.log,target:b.target,title:b.label};s.log=b.log;}
 s.lastChecked??=Date.now();await save();
}
async function refresh(b){
 const s=state[b.channel],current=await discover(b),changed=await adopt(s,current);
 b.target=current.target;b.log=current.log;
 if(changed){await save();const channel=await client.channels.fetch(b.channel);await post(channel,`↪️ Following ${current.target.agent}：**${current.title}**${current.id?`（…${current.id.slice(-8)}）`:''}\nNew messages will remain in this channel. Previous session history is not imported.`);}
 return current;
}
async function handleMessage(message){
 if(stopping)return;
 if(message.author.bot||message.author.id!==cfg.owner||message.guildId!==cfg.guild)return;
 await serial(message.channelId,async()=>{
  const b=cfg.bindings.find(x=>x.channel===message.channelId);
  let text=message.content.replace(new RegExp(`^<@!?${client.user.id}>\\s*`),'').trim();
  if(['Connect terminal','Change terminal','Connect pane','/connect'].includes(text)){
   try{await message.channel.send(await picker.create(message.channelId,message.author.id));}catch(e){await message.channel.send(connectionMessage(redact(e.message)));}return;
  }
  if(['Menu','/menu','/status','/status'].includes(text)){await message.channel.send(connectionMessage(info(b)));return;}
  if(!b)return;
  const s=state[b.channel];if(s.incoming[message.id])return;
  if(message.attachments.size){await message.reply({content:'Only text input is supported. Attachments were not sent to the terminal.',allowedMentions:{repliedUser:false}});return;}
  if(!text)return;
  if(/^\/(?:ssn?|sessions?|use|cancel)(?:\s|$)/.test(text)){await post(message.channel,'This channel follows a tmux pane. Switch sessions in the native terminal; legacy bot session commands are not supported.');return;}
  // Mark before pressing Enter: a restart must never automatically replay an input.
  s.incoming[message.id]='sending';
  try{
   await save();
   const current=await refresh(b);s.inputs.push({hash:hash(redact(text)),at:Date.now()});await save();
   await sendText(current.target,text,async()=>{const check=await discover(b);if(check.key!==current.key||check.target.pid!==current.target.pid||check.target.start!==current.target.start)throw Error('The terminal changed model or session. This message was not sent; check the terminal before retrying.');},cfg.inputDiagnostics===true?join(dir,'diagnostics'):undefined);
   s.incoming[message.id]='sent';await message.react('✅').catch(()=>{});
  }
  catch(error){s.incoming[message.id]='blocked';s.inputs=s.inputs.filter(x=>x.hash!==hash(redact(text)));await message.reply({...storageError(error)?pauseMessage(error):connectionMessage('Terminal delivery was not confirmed: '+redact(error.message)+'\nCheck the terminal or reconnect before resending this message.'),allowedMentions:{parse:[],repliedUser:false}});}
  const entries=Object.entries(s.incoming);if(entries.length>1000)s.incoming=Object.fromEntries(entries.slice(-1000));await save();
 });
}
client.on('messageCreate',m=>handleMessage(m).catch(e=>console.error('message:',redact(e.message))));
client.on('interactionCreate',async i=>{
 if(stopping)return;
 if(i.user?.id!==cfg.owner||i.guildId!==cfg.guild)return;
 if(!i.isChatInputCommand()&&!i.customId?.startsWith('project-menu:')&&!i.customId?.startsWith('relay:'))return;
 try{
  if(i.customId?.startsWith('relay:choose:')){
   await i.deferUpdate();
   await serial('connections',()=>serial(i.channelId,async()=>{
    const token=i.customId.split(':')[2],result=await picker.select(token,i.values?.[0],i.channelId,i.user.id),b=result.binding;
    if(!result.unchanged){await initBinding(b);notified.delete(b.channel);}
    const content=`✅ ${result.unchanged?'This channel is already connected':'Terminal connected'}：**${b.location}**\nStart Claude or Codex in that pane, then send text here. Channel history is retained. Unsent messages are not replayed automatically.`;
    await i.editReply(connectionMessage(content));
    if(!result.unchanged){const channel=await client.channels.fetch(i.channelId);await channel.send(connectionMessage(content));}
   }));return;
  }
  if(i.customId?.startsWith('relay:page:')){const [, , token,page]=i.customId.split(':');await i.update(picker.render(token,page,i.channelId,i.user.id));return;}
  await i.deferReply({ephemeral:true});
  if(i.commandName==='connect'||i.customId==='relay:connect'){await i.editReply(await picker.create(i.channelId,i.user.id));return;}
  await i.editReply(connectionMessage(info(cfg.bindings.find(x=>x.channel===i.channelId))));
 }catch(e){console.error('interaction:',redact(e.message));const payload=connectionMessage(redact(e.message));try{if(i.deferred||i.replied)await i.editReply(payload);else await i.reply({...payload,ephemeral:true});}catch{}}
});
async function poll(b){
 const s=state[b.channel];await validateTarget(b.target);
 if(!b.log)return;
 const meta=await stat(b.log).catch(e=>{if(e.code==='ENOENT'&&s.ino===null)return null;throw e;});if(!meta)return;
 if(s.ino===null)s.ino=meta.ino;
 if(meta.ino!==s.ino||meta.size<s.offset)throw Error('The current transcript was replaced or truncated. Forwarding is paused.');
 if(meta.size===s.offset)return;
 const f=await open(b.log,'r');let cursor=s.offset,carry=Buffer.alloc(0),position=cursor,delivered=0;
 try{
  while(position<meta.size&&delivered<30){
   const bytes=Buffer.alloc(Math.min(1024*1024,meta.size-position));const read=await f.read(bytes,0,bytes.length,position);if(!read.bytesRead)break;position+=read.bytesRead;
   carry=Buffer.concat([carry,bytes.subarray(0,read.bytesRead)]);let start=0,nl;
   while((nl=carry.indexOf(10,start))>=0&&delivered<30){
    const line=carry.subarray(start,nl),next=cursor+(nl-start)+1;let o;try{o=JSON.parse(line.toString('utf8'));}catch{}
    const time=timestamp(o),m=o&&(!s.since||(time!==null&&time>=s.since))&&chatMessage(o,b.target.agent),id=m?.id||hash(line);
    if(m&&!s.seen.includes(id)){
     const inputIndex=m.role==='user'?s.inputs.findIndex(x=>x.hash===hash(m.text)):-1;
     if(inputIndex>=0)s.inputs.splice(inputIndex,1);
     else{
      const channel=await client.channels.fetch(b.channel);
      let replyNumber;
      if(m.role==='assistant'){
       const key=(s.active?.key||b.target.agent)+':'+id;
       if(s.pendingReply?.key!==key){s.replyCounter=(s.replyCounter||0)+1;s.pendingReply={key,number:s.replyCounter};}
       await save();
       replyNumber=s.pendingReply.number;
      }
      await post(channel,(m.role==='user'?'**You (terminal)**\n':'')+m.text,replyNumber,m.role==='assistant'?b.target.agent:undefined);delivered++;
      if(replyNumber)delete s.pendingReply;
     }
     s.seen.push(id);if(s.seen.length>2000)s.seen.shift();
    }
    cursor=next;s.offset=cursor;start=nl+1;
    if(m)await save();
   }
   carry=carry.subarray(start);
  }
  await save();
 }finally{await f.close();}
}
let polling=false,stopping=false;const notified=new Map();
async function tick(){
 if(polling||stopping)return;polling=true;
 try{for(const b of cfg.bindings){await serial(b.channel,async()=>{if(!cfg.bindings.includes(b))return;try{await refresh(b);await save();await poll(b);await save();if(notified.has(b.channel)){const channel=await client.channels.fetch(b.channel);await post(channel,'✅ Terminal connection restored. You can send messages again.');}notified.delete(b.channel);}catch(e){const error=redact(e.message);if(notified.get(b.channel)!==error){console.error('poll:',b.channel,error);notified.set(b.channel,error);const channel=await client.channels.fetch(b.channel).catch(()=>null);if(channel)await channel.send(pauseMessage(e)).catch(()=>{});}}});}}
 finally{polling=false;}
}
client.once('clientReady',async()=>{
 for(const b of cfg.bindings)await initBinding(b);
 const rest=new REST({version:'10'}).setToken(token),commands=[{name:'status',description:'Show the connected tmux pane and last identified conversation'},{name:'connect',description:'Connect this channel to a tmux pane or reconnect after a server restart'}];
 await rest.put(Routes.applicationGuildCommands(client.user.id,cfg.guild),{body:commands});
 console.log('ready: follows tmux pane across process/session changes; no model launch or resume');setInterval(()=>tick(),2000);await tick();
});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;while(polling)await new Promise(r=>setTimeout(r,25));await Promise.allSettled([...queues.values()]);try{await save();}catch(e){console.error('shutdown-save:',redact(e.message));}await client.destroy();process.exit(0);});
client.on('error',e=>console.error('discord:',redact(e.message)));
await client.login(token);
