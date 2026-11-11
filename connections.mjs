import {randomUUID} from 'node:crypto';
import {writeFile,rename} from 'node:fs/promises';
import {listPanes,listTerminals} from './terminal.mjs';
import {serverIdentity,sameServer} from './follow.mjs';

export const connectControls=()=>[{type:1,components:[{type:2,style:1,custom_id:'relay:connect',label:'Connect terminal'}]}];
export function initialState(b,old){
 if(old&&old.bindingRevision===b.revision)return old;
 // Old bindings have no revision: retain their existing transcript cursor.
 if(old&&!b.revision)return old;
 return {bindingRevision:b.revision,offset:0,ino:null,seen:[],inputs:[],incoming:old?.incoming||{},replyCounter:old?.replyCounter||0,lastChecked:b.connectedAt||Date.now()};
}
export async function atomicJson(path,value){await writeFile(path+'.tmp',JSON.stringify(value,null,2),{mode:0o600});await rename(path+'.tmp',path);}

export class ConnectionPicker{
 constructor({cfg,persist,getServer=serverIdentity,getPanes=listPanes,getModels=listTerminals,now=Date.now}){Object.assign(this,{cfg,persist,getServer,getPanes,getModels,now});this.menus=new Map();}
 async create(channel,owner){
  for(const [key,menu] of this.menus)if(menu.expires<this.now())this.menus.delete(key);
  const server=await this.getServer(),panes=await this.getPanes(),models=await this.getModels();
  if(!sameServer(server,await this.getServer()))throw Error('The pane list changed. Open Connect terminal again.');
  const token=randomUUID().replaceAll('-','').slice(0,16),revision=this.cfg.bindings.find(b=>b.channel===channel)?.revision;
  const menu={channel,owner,server,revision,panes:panes.map(p=>({...p,agent:models.find(m=>m.pane===p.pane)?.agent})),expires:this.now()+10*60*1000};
  this.menus.set(token,menu);return this.render(token,0,channel,owner);
 }
 get(token,channel,owner){const m=this.menus.get(token);if(!m||m.channel!==channel||m.owner!==owner||m.expires<this.now())throw Error('This picker expired. Open Connect terminal again.');return m;}
 render(token,page,channel,owner){
  const m=this.get(token,channel,owner),pages=Math.max(1,Math.ceil(m.panes.length/25));page=Math.max(0,Math.min(pages-1,Number(page)||0));
  const options=m.panes.slice(page*25,page*25+25).map((p,index)=>({label:`${p.location} · ${p.agent||'waiting for model'}`.slice(0,100),description:(p.cwd||'unknown directory').slice(0,100),value:String(page*25+index)}));
  const components=options.length?[{type:1,components:[{type:3,custom_id:`relay:choose:${token}`,placeholder:'Choose the tmux pane for this channel',min_values:1,max_values:1,options}]}]:[];
  const buttons=[];
  if(page>0)buttons.push({type:2,style:2,custom_id:`relay:page:${token}:${page-1}`,label:'Previous'});
  if(page<pages-1)buttons.push({type:2,style:2,custom_id:`relay:page:${token}:${page+1}`,label:'Next'});
  buttons.push({type:2,style:2,custom_id:'relay:connect',label:'Refresh panes'});components.push({type:1,components:buttons});
  return {content:`**Connect terminal**\nThis channel follows the selected pane. Existing channel history is retained; a new binding forwards messages from now on.\n${options.length?`Page ${page+1}/${pages}; ${m.panes.length} panes.`:'No panes available. Start tmux on the server first.'}\nYou can select a pane marked waiting for model, then start Claude or Codex there.`,components,allowedMentions:{parse:[]}};
 }
 async select(token,index,channel,owner){
  const menu=this.get(token,channel,owner),old=this.cfg.bindings.find(b=>b.channel===channel);
  if(old?.revision!==menu.revision)throw Error('This channel binding changed. Refresh the pane list.');
  if(!/^\d+$/.test(String(index))||!menu.panes[Number(index)])throw Error('Invalid pane. Refresh the list.');
  const selected=menu.panes[Number(index)],server=await this.getServer();
  if(!sameServer(menu.server,server))throw Error('The server or tmux restarted. Refresh the pane list.');
  const live=(await this.getPanes()).find(p=>p.pane===selected.pane);
  if(!live||live.root!==selected.root||live.rootStart!==selected.rootStart)throw Error('The selected pane changed. Refresh the list.');
  const duplicate=this.cfg.bindings.find(b=>b.channel!==channel&&b.pane===live.pane&&sameServer(b.server,server));
  if(duplicate)throw Error(`This pane is already connected to <#${duplicate.channel}>. Use that channel or select another pane.`);
  if(old?.pane===live.pane&&sameServer(old.server,server)){this.menus.delete(token);return {binding:old,unchanged:true};}
  const binding={channel,pane:live.pane,location:live.location,server:{pid:server.pid,start:server.start,boot:server.boot},revision:randomUUID(),connectedAt:this.now(),label:live.location};
  const next={...this.cfg,bindings:[...this.cfg.bindings.filter(b=>b.channel!==channel),binding]};
  await this.persist(next);this.cfg.bindings=next.bindings;this.menus.delete(token);return {binding,unchanged:false};
 }
}
