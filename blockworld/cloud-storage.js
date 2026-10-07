import { WorldStore } from './storage.js';
export class CloudWorldStore extends WorldStore {
  constructor(){super();this.cloud=null;this.localIds=new Set();this.onCloudError=()=>{};this.writes=Promise.resolve();this.bagModes=new Map();}
  request(op,values={}){
    if(['write','writeProfile','writeRoomProfile','writePlayProfile','rename','create','finish','select'].includes(op)){
      const snapshot=JSON.parse(JSON.stringify(values));
      const pending=this.writes.then(()=>this.send(op,snapshot));this.writes=pending.catch(()=>{});return pending;
    }
    return this.send(op,values);
  }
  async send(op,values={}){
    const auth=this.cloud;if(!auth)throw Error('云存档尚未连接');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000),started=performance.now();
    let status=0,requestId='';
    try{
      const response=await fetch('/api/blockworld/cloud',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth,...values,op}),signal:controller.signal});
      status=response.status;requestId=response.headers.get('X-Request-Id')||'';
      if(response.status===404){const error=Error('云存档接口不存在，请检查服务版本');error.status=404;throw error;}
      const data=await response.json();if(!response.ok){const error=Error(data.error||'云存档同步失败');error.status=response.status;throw error;}return data.value;
    }catch(error){error.status ||= status;error.requestId=requestId;
      error.reason=error.name==='AbortError'?'TIMEOUT':status===401?'AUTH_EXPIRED':status===409?'SESSION_EXPIRED':status>=400?'SERVER_REJECTED':status===200?'INVALID_RESPONSE':'CONNECTION_FAILED';
      window.FangyuDiagnostics?.record({operation:op,status,requestId,reason:error.reason,durationMs:Math.round(performance.now()-started)});
      this.onCloudError(error);throw error;}finally{clearTimeout(timeout);}
  }
  async connect(name,token){
    this.cloud={name,token};
    const {session}=await this.request('connect');this.cloud.session=session;
    const worlds=await this.request('list');
    if(!worlds.length){
      // Import only when the cloud is empty. Never replace an existing cloud world.
      await super.activeFor(name);
      await this.importLocal();
    }
  }
  async importLocal(){
    const name=this.cloud.name,worlds=await super.listFor(name);let count=0;
    for(const old of worlds){
      this.localIds.add(old.id);
      const marker=`block-isle-upload:${name}:${old.id}`;
      if(localStorage.getItem(marker))continue;
      const next=await this.request('create',{title:old.name||'旧岛屿',seed:old.seed,importing:true});
      const prefix=old.id+'/',records=await new Promise((resolve,reject)=>{
        const tx=this.db.transaction('chunks'),req=tx.objectStore('chunks').openCursor(),rows=[];
        req.onerror=()=>reject(req.error);req.onsuccess=()=>{const c=req.result;if(!c)return resolve(rows);if(String(c.key).startsWith(prefix))rows.push({key:String(c.key).slice(prefix.length),edits:c.value});c.continue();};
      });
      for(const row of records)await this.request('write',{id:next.id,...row});
      const profile=await super.readProfile(old.id,name);
      await this.request('writeProfile',{id:next.id,profile});await this.request('finish',{id:next.id});
      localStorage.setItem(marker,next.id);count++;
    }
    return count;
  }
  local(id){return !this.cloud||this.localIds.has(id)||String(id).startsWith('room-');}
  async activeFor(name){if(!this.cloud)return super.activeFor(name);return await this.request('active')||this.create(name);}
  async listFor(name){return this.cloud?this.request('list'):super.listFor(name);}
  async create(name,title){return this.cloud?this.request('create',{title}):super.create(name,title);}
  async selectFor(name,world){return this.cloud?this.request('select',{id:world.id}):super.selectFor(name,world);}
  async rename(id,title){return this.local(id)?super.rename(id,title):this.request('rename',{id,title});}
  async read(id,key){return this.local(id)?super.read(id,key):this.request('read',{id,key});}
  async write(id,key,edits){
    await super.write(id,key,edits); // Keep a local backup even when the network fails.
    if(!this.local(id))await this.request('write',{id,key,edits});
  }
  async readAllEdits(id,limit){return this.local(id)?super.readAllEdits(id,limit):this.request('allEdits',{id,limit});}
  async readProfile(id,name){
    if(this.cloud&&this.bagModes.has(id)){await this.writes;return this.request('readPlayProfile',{id,mode:this.bagModes.get(id)});}
    if(this.cloud&&String(id).startsWith('room-')){
      await this.writes;
      const saved=await this.request('readRoomProfile',{id});if(saved)return saved;
      const local=await super.readProfile(id,name);await this.request('writeRoomProfile',{id,profile:local});return local;
    }
    return this.local(id)?super.readProfile(id,name):this.request('readProfile',{id});
  }
  async backupProfile(id,name,profile){const mode=this.bagModes.get(id);await super.writeProfile(mode?`${id}-${mode}`:id,name,profile);}
  async writeProfile(id,name,profile){const mode=this.bagModes.get(id);await this.backupProfile(id,name,profile);if(this.cloud&&mode)await this.request('writePlayProfile',{id,mode,profile});else if(this.cloud&&String(id).startsWith('room-'))await this.request('writeRoomProfile',{id,profile});else if(!this.local(id))await this.request('writeProfile',{id,profile});}
}
