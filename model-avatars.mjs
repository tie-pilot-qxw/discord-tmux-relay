import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

const labels={claude:'Claude',codex:'Codex'};
const unavailable=e=>[10015,50001,50013].includes(Number(e?.code));

// Separate, bot-owned webhooks preserve each model's identity even when other
// channels switch models. Tokens remain in memory, never config or logs.
export class ModelAvatars {
 constructor({avatarDir,botId,enabled=()=>false,load=readFile,warn=console.warn,now=Date.now}){
  Object.assign(this,{avatarDir,botId,enabled,load,warn,now});this.cache=new Map();this.pending=new Map();
 }
 async webhook(channel,agent){
  const parent=channel.isThread?.()?channel.parent:channel;
  if(!parent?.fetchWebhooks||!parent?.createWebhook)return null;
  const key=parent.id+':'+agent,cached=this.cache.get(key);
  if(cached&&cached.until>this.now())return cached.hook;
  if(this.pending.has(key))return this.pending.get(key);
  const work=(async()=>{
   try{
    const name='Relay · '+labels[agent],hooks=await parent.fetchWebhooks();
    let hook=hooks.find(h=>h.type===1&&h.owner?.id===this.botId()&&h.name===name&&h.token);
    if(!hook){
     const avatar=await this.load(join(this.avatarDir,agent+'.png'));
     hook=await parent.createWebhook({name,avatar,reason:'Model-specific relay avatar'});
    }
    this.cache.set(key,{hook,until:Infinity});return hook;
   }catch(e){
    // Missing permission/assets should not stop an otherwise healthy relay.
    this.cache.set(key,{hook:null,until:this.now()+60000});
    this.warn('model-avatar-unavailable',JSON.stringify({channel:parent.id,agent,code:typeof e?.code==='number'?e.code:'setup'}));
    return null;
   }finally{this.pending.delete(key);}
  })();this.pending.set(key,work);return work;
 }
 async send(channel,payload,agent){
  const safe={...payload,allowedMentions:{parse:[]}};
  if(!this.enabled()||!Object.hasOwn(labels,agent))return channel.send(safe);
  const hook=await this.webhook(channel,agent);
  if(!hook)return channel.send(safe);
  try{return await hook.send({...safe,username:labels[agent],...(channel.isThread?.()?{threadId:channel.id}:{})});}
  catch(e){
   // Only definite rejection can fall back safely. A timeout may have posted
   // already, so propagate it into the relay's existing delivery retry logic.
   if(!unavailable(e))throw e;
   const parent=channel.isThread?.()?channel.parent:channel;
   this.cache.delete(parent.id+':'+agent);
   this.warn('model-avatar-rejected',JSON.stringify({channel:channel.id,agent,code:Number(e.code)}));
   return channel.send(safe);
  }
 }
}
