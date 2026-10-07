const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class CloudWorlds {
  constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true});this.accounts=new Map();}
  account(name){
    if(this.accounts.has(name))return this.accounts.get(name);
    const file=path.join(this.directory,crypto.createHash('sha256').update(name).digest('hex')+'.jsonl');
    const state={file,worlds:new Map(),roomProfiles:new Map(),privateProfiles:new Map(),sharedBag:null,permanentTools:new Set(),grants:new Set(),active:null,session:null};
    try{for(const line of fs.readFileSync(file,'utf8').split('\n'))if(line.trim())this.apply(state,JSON.parse(line));}
    catch(error){if(error.code!=='ENOENT')throw Error('服务器存档读取失败，原文件已保留');}
    const grantsFile=path.join(this.directory,'recovery-grants.json');
    let grants=[];try{grants=JSON.parse(fs.readFileSync(grantsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const grant of grants){
      if(grant.name!==name||state.grants.has(grant.key))continue;
      const world=state.worlds.get(grant.worldId);if(grant.scope!=='shared'&&!world)throw Error('补发目标地图不存在，未更改存档');
      const profile=JSON.parse(JSON.stringify(grant.scope==='shared'?this.shared(state):world.profile||{}));profile.inventory||={};profile.toolDurability||={};
      for(const [item,count] of Object.entries(grant.items))profile.inventory[item]=Math.max(0,Number(profile.inventory[item])||0)+count;
      profile.tools=[...new Set([...(profile.tools||[]),...grant.tools])];
      for(const tool of grant.tools)profile.toolDurability[tool]=100;
      if(grant.hasWorkbench===true)profile.hasWorkbench=true;
      const backup=state.file+'.before-recovery-'+grant.key;
      if(fs.existsSync(state.file)&&!fs.existsSync(backup))fs.copyFileSync(state.file,backup,fs.constants.COPYFILE_EXCL);
      this.commit(state,{op:'recovery',id:grant.worldId,scope:grant.scope,grant:grant.key,profile});
    }
    this.accounts.set(name,state);return state;
  }
  apply(state,e){
    if(e.op==='session')state.session=e.session;
    if(e.op==='sharedBag')state.sharedBag=e.bag;
    if(e.op==='playProfile'){
      if(e.mode==='private')state.privateProfiles.set(e.id,e.profile);
      else {state.sharedBag=this.bag(e.profile);const w=state.worlds.get(e.id);if(w)w.profile=e.profile;else state.roomProfiles.set(e.id,e.profile);}
    }
    if(e.op==='roomProfile')state.roomProfiles.set(e.id,e.profile);
    if(e.op==='recovery') { if(state.grants.has(e.grant))return;state.grants.add(e.grant);if(e.scope==='shared')state.sharedBag=this.bag(e.profile);else{const w=state.worlds.get(e.id);if(w)w.profile=e.profile;} }
    if(e.op==='create')state.worlds.set(e.meta.id,{meta:e.meta,chunks:{},profile:{inventory:{}}});
    if(e.op==='active')state.active=e.id;
    const world=state.worlds.get(e.id);
    if(e.op==='chunk'&&world)world.chunks[e.key]=e.edits;
    if(e.op==='profile'&&world)world.profile=e.profile;
    if(e.op==='meta'&&world)world.meta={...world.meta,...e.meta};
    // A granted infinite-durability tool is an account entitlement, not a
    // consumable that an older client snapshot may silently remove.
    if(e.op==='recovery'&&e.scope==='shared'&&e.profile?.tools?.includes('omni'))state.permanentTools.add('omni');
    if(state.sharedBag&&state.permanentTools.size){
      state.sharedBag={...state.sharedBag,tools:[...new Set([...state.sharedBag.tools,...state.permanentTools])],toolDurability:{...state.sharedBag.toolDurability}};
      for(const tool of state.permanentTools)state.sharedBag.toolDurability[tool]=100;
    }
  }
  commit(state,e){fs.appendFileSync(state.file,JSON.stringify(e)+'\n','utf8');this.apply(state,e);}
  bag(profile={}){return {inventory:profile.inventory||{},tools:profile.tools||[],toolDurability:profile.toolDurability||{},quickbar:profile.quickbar||[],hasWorkbench:!!profile.hasWorkbench};}
  shared(state){
    if(state.sharedBag)return state.sharedBag;
    const bag=this.bag();
    for(const p of [...state.worlds.values()].map(w=>w.profile).concat([...state.roomProfiles.values()])){
      for(const [id,n] of Object.entries(p.inventory||{}))bag.inventory[id]=(bag.inventory[id]||0)+Math.max(0,Number(n)||0);
      bag.tools=[...new Set([...bag.tools,...(p.tools||[])])];
      for(const [id,n] of Object.entries(p.toolDurability||{}))bag.toolDurability[id]=Math.max(bag.toolDurability[id]||0,Number(n)||0);
      bag.hasWorkbench ||= !!p.hasWorkbench;
    }
    this.commit(state,{op:'sharedBag',bag});return bag;
  }
  handle(name,b){
    const state=this.account(name);
    if(b.op==='connect'){this.commit(state,{op:'session',session:crypto.randomUUID()});return {session:state.session};}
    // One-time upgrade for old servers that kept sessions only in RAM.
    // The HTTP route has already authenticated this account's current token.
    // Once a session is recorded, never let a stale device replace it here.
    if(!state.session&&typeof b.session==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.session))this.commit(state,{op:'session',session:b.session});
    if(!state.session||b.session!==state.session){const error=Error('账号已在另一设备打开，或服务器已重启，请刷新后重新进入；此设备未覆盖云存档');error.status=409;throw error;}
    const list=()=>[...state.worlds.values()].filter(w=>!w.meta.importing).map(w=>w.meta);
    if(b.op==='list')return list();
    if(b.op==='active')return state.worlds.get(state.active)?.meta||list()[0]||null;
    if(b.op==='readPlayProfile'||b.op==='writePlayProfile'){
      if(!state.worlds.has(b.id)&&!/^room-[-a-zA-Z0-9_]{1,96}$/.test(b.id||''))throw Error('找不到此账号的地图');
      if(!['shared','private'].includes(b.mode))throw Error('请选择背包模式');
      this.shared(state);
      if(b.op==='readPlayProfile')return b.mode==='private'?(state.privateProfiles.get(b.id)||{inventory:{}}):{...(state.worlds.get(b.id)?.profile||state.roomProfiles.get(b.id)||{}),...state.sharedBag};
      if(!b.profile||typeof b.profile!=='object'||Array.isArray(b.profile)||JSON.stringify(b.profile).length>300000)throw Error('背包存档过大或无效');
      this.commit(state,{op:'playProfile',id:b.id,mode:b.mode,profile:b.profile});return true;
    }
    if(b.op==='create'){
      const meta={id:crypto.randomUUID(),owner:name,name:String(b.title||'新的岛屿').slice(0,24),seed:Number.isSafeInteger(b.seed)&&b.seed>0?b.seed:crypto.randomInt(100000,1000000),version:2,created:Date.now(),importing:b.importing===true};
      this.commit(state,{op:'create',meta});if(!meta.importing)this.commit(state,{op:'active',id:meta.id});return meta;
    }
    if(b.op==='readRoomProfile'||b.op==='writeRoomProfile'){
      if(!/^room-[-a-zA-Z0-9_]{1,96}$/.test(b.id||''))throw Error('无效房间存档');
      if(b.op==='readRoomProfile')return state.roomProfiles.get(b.id)||null;
      if(!b.profile||typeof b.profile!=='object'||Array.isArray(b.profile)||JSON.stringify(b.profile).length>300000)throw Error('背包存档过大或无效');
      this.commit(state,{op:'roomProfile',id:b.id,profile:b.profile});return true;
    }
    const world=state.worlds.get(b.id);if(!world){const error=Error('找不到此账号的云地图');error.status=404;throw error;}
    if(b.op==='select'){if(world.meta.importing)throw Error('旧地图还未完成上传');this.commit(state,{op:'active',id:b.id});return world.meta;}
    if(b.op==='finish'){this.commit(state,{op:'meta',id:b.id,meta:{importing:false}});this.commit(state,{op:'active',id:b.id});return world.meta;}
    if(b.op==='rename'){this.commit(state,{op:'meta',id:b.id,meta:{name:String(b.title||'未命名地图').slice(0,24)}});return world.meta;}
    if(b.op==='readProfile')return world.profile;
    if(b.op==='writeProfile'){
      if(!b.profile||typeof b.profile!=='object'||Array.isArray(b.profile)||JSON.stringify(b.profile).length>300000)throw Error('背包存档过大或无效');
      this.commit(state,{op:'profile',id:b.id,profile:b.profile});return true;
    }
    if(b.op==='allEdits')return Object.values(world.chunks).flatMap(edits=>Object.entries(edits).map(([key,block])=>{const [x,y,z]=key.split(',').map(Number);return {x,y,z,block};})).slice(0,Math.max(0,Math.min(50000,Number(b.limit)||5000)));
    if(!/^-?\d+,-?\d+$/.test(b.key||''))throw Error('无效分区');
    if(b.op==='read')return world.chunks[b.key]||{};
    if(b.op==='write'){
      if(!b.edits||typeof b.edits!=='object'||Array.isArray(b.edits))throw Error('无效方块记录');
      const [cx,cz]=b.key.split(',').map(Number);
      for(const [key,block] of Object.entries(b.edits)){
        if(!/^-?\d+,-?\d+,-?\d+$/.test(key))throw Error('无效坐标');
        const [x,y,z]=key.split(',').map(Number);
        if(![x,y,z].every(Number.isSafeInteger)||y<=-256||y>=100||Math.floor(x/16)!==cx||Math.floor(z/16)!==cz||![null,'grass','dirt','stone','wood','leaves','sand','cotton','bed'].includes(block))throw Error('无效方块');
      }
      this.commit(state,{op:'chunk',id:b.id,key:b.key,edits:b.edits});return true;
    }
    throw Error('未知云存档操作');
  }
}
module.exports={CloudWorlds};
