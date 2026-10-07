const crypto=require('node:crypto');
const modules=Promise.all([import('./blockworld/world-core.js'),import('./blockworld/physics.js')]);
const lootTypes=['dirt','stone','wood','leaves','sand','cotton'];
class RoomLife {
  constructor(core,physics,room,time,now){this.core=core;this.Physics=physics.Physics;this.room=room;this.time=Number.isFinite(time)&&time>=0?time:28800;this.last=now;this.spawnAt=now-8000;this.chunks=new Map();this.revision=-1;this.terrain=new core.Terrain(room.world.seed);this.monsters=new Map();this.loot=new Map();this.clients=new Map();this.version=0;}
  block(x,y,z){
    const c=this.core;x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);if(y<c.MIN_Y||y>=c.HEIGHT)return 0;
    const key=c.chunkKey(x,z);let data=this.chunks.get(key);
    if(!data){const [cx,cz]=key.split(',').map(Number),gen=this.terrain.generate(cx,cz);let result;do{result=gen.next();}while(!result.done);data=result.value;this.chunks.set(key,data);if(this.chunks.size>64)this.chunks.delete(this.chunks.keys().next().value);}
    const editKey=`${x},${y},${z}`;return Object.hasOwn(this.room.edits,editKey)?Math.max(0,c.TYPES.indexOf(this.room.edits[editKey])):data[c.indexOf(x,y,z)];
  }
  get night(){const hour=(this.time%86400)/3600;return hour>=18||hour<8;}
  clear(){this.monsters.clear();}
  distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);}
  push(from,to){const dx=to.x-from.x,dz=to.z-from.z,d=Math.hypot(dx,dz)||1;return {x:dx/d*7,z:dz/d*7};}
  visible(a,b){const d=this.distance(a,b);return !this.core.trace(a,{x:(b.x-a.x)/(d||1),y:(b.y-a.y)/(d||1),z:(b.z-a.z)/(d||1)},(x,y,z)=>this.block(x,y,z),()=>true,Math.max(0,d-.05));}
  sleepState(now){
    if(now-(this.sleepPoll||now)>=3000)this.sleepSince=null;
    this.sleepPoll=now;
    const ids=[...this.room.players.keys()],signature=ids.slice().sort().join(',');
    const sleepers=ids.filter(id=>{const c=this.clients.get(id),bed=c?.bed;return c?.active&&now-c.seen<3000&&bed&&this.distance(c.position,{x:bed.x+.5,y:bed.y+.5,z:bed.z+.5})<7&&this.block(bed.x,bed.y,bed.z)===8;});
    const all=this.night&&ids.length>0&&sleepers.length===ids.length;
    if(!all||signature!==this.sleepMembers)this.sleepSince=null;
    this.sleepMembers=signature;
    if(all&&this.sleepSince==null)this.sleepSince=now;
    let remaining=all?Math.max(0,10-(now-this.sleepSince)/1000):10;
    if(all&&remaining===0){this.time=(Math.floor(this.time/86400)+(this.time%86400>=64800?1:0))*86400+28800;this.clear();for(const c of this.clients.values())c.bed=null;this.sleepSince=null;}
    return {sleeping:sleepers.length,total:ids.length,remaining,all};
  }
  step(now){
    const elapsed=Math.max(0,Math.min((now-this.last)/1000,1));this.last=now;
    const players=[...this.clients].filter(([id,c])=>this.room.players.has(id)&&c.active&&now-c.seen<3000);
    if(!players.length)return;
    this.time+=elapsed*60;if(!this.night){this.clear();return;}
    if(now-this.spawnAt>=8000&&this.monsters.size<6){
      this.spawnAt=now;const player=players[Math.floor(Math.random()*players.length)][1];
      for(let attempt=0;attempt<20;attempt++){
        const angle=Math.random()*Math.PI*2,r=16+Math.random()*20,x=Math.floor(player.position.x+Math.cos(angle)*r)+.5,z=Math.floor(player.position.z+Math.sin(angle)*r)+.5;
        let floor=null;const center=Math.floor(player.position.y-1.72);
        for(let o=0;o<=8&&floor===null;o++)for(const y of o?[center-o,center+o]:[center])if(y>this.core.MIN_Y&&y+2<this.core.HEIGHT&&this.block(x,y-1,z)&&![0,1,2].some(d=>this.block(x,y+d,z))){floor=y;break;}
        if(floor===null)continue;
        const position={x,y:floor+1.72,z},id=crypto.randomUUID();
        this.monsters.set(id,{id,position,health:50,cooldown:now+1000,physics:new this.Physics(position,(x,y,z)=>this.block(x,y,z),()=>true)});break;
      }
    }
    const dt=Math.min(elapsed,.2);
    for(const [id,m] of this.monsters){
      const [targetId,target]=players.reduce((a,b)=>this.distance(m.position,a[1].position)<this.distance(m.position,b[1].position)?a:b);
      if(this.distance(m.position,target.position)>64||m.position.y< -260){this.monsters.delete(id);continue;}
      const dx=target.position.x-m.position.x,dz=target.position.z-m.position.z,d=Math.hypot(dx,dz),before={...m.position};
      m.physics.update(dt,{x:d>1.3?dx/(d||1):0,z:d>1.3?dz/(d||1):0},2.2);
      if(d>2&&m.physics.grounded&&Math.hypot(m.position.x-before.x,m.position.z-before.z)<dt*.5)m.physics.jump();
      m.yaw=Math.atan2(-dx,-dz);
      if(now>=m.cooldown&&now>=target.grace&&this.distance(m.position,target.position)<2&&this.visible(m.position,target.position)){target.damage+=20;m.cooldown=now+1000;}
    }
  }
  request(clientId,b,now=Date.now()){
    let client=this.clients.get(clientId);if(!client){client={position:{...this.room.players.get(clientId).position},seen:now,active:false,damage:0,grace:now+3000,results:new Map()};this.clients.set(clientId,client);}
    const position=b.position;
    if(position&&['x','y','z'].every(k=>Number.isFinite(position[k])&&Math.abs(position[k])<100000))client.position={x:position.x,y:position.y,z:position.z};
    client.active=b.active===true;client.seen=now;
    const bed=b.sleeping;
    client.bed=client.active&&bed&&['x','y','z'].every(k=>Number.isSafeInteger(bed[k]))?{x:bed.x,y:bed.y,z:bed.z}:null;
    this.step(now);
    for(const action of (Array.isArray(b.commands)?b.commands:[]).slice(0,10)){
      if(typeof action.id!=='string'||action.id.length>80||client.results.has(action.id)||client.results.size>=256)continue;
      let result={id:action.id,ok:false};
      if(client.active&&action.type==='hit'){
        const m=this.monsters.get(action.monster);
        if(m&&now-(client.lastHit||0)>=350&&this.distance(client.position,m.position)<4.8&&this.visible(client.position,m.position)){
          client.lastHit=now;m.health=Math.max(0,m.health-(action.tool==='sword'?20:5));const push=this.push(client.position,m.position);m.physics.knockback(push.x,push.z);result={...result,ok:true,type:'hit',tool:action.tool};
          if(!m.health){this.monsters.delete(m.id);for(let i=0,n=1+Math.floor(Math.random()*3);i<n&&this.loot.size<128;i++){const id=crypto.randomUUID();this.loot.set(id,{id,x:m.position.x,y:m.position.y-1.17,z:m.position.z,type:lootTypes[Math.floor(Math.random()*lootTypes.length)]});}}
        }
      }
      if(client.active&&action.type==='hitPlayer'){
        const victim=this.clients.get(action.player);
        if(action.player!==clientId&&this.room.players.has(action.player)&&victim?.active&&now-victim.seen<3000&&now>=victim.grace&&now-(client.lastHit||0)>=350&&this.distance(client.position,victim.position)<4.8&&this.visible(client.position,victim.position)){
          client.lastHit=now;victim.damage+=action.tool==='sword'?20:5;victim.bed=null;
          const push=this.push(client.position,victim.position);victim.knockback||={x:0,z:0};victim.knockback.x+=push.x;victim.knockback.z+=push.z;
          result={...result,ok:true,type:'hit',tool:action.tool};
        }
      }
      if(client.active&&action.type==='pickup'){
        const drop=this.loot.get(action.loot);
        if(drop&&this.distance(client.position,drop)<3){this.loot.delete(drop.id);result={...result,ok:true,type:'pickup',item:drop.type};}
      }
      if(client.active&&action.type==='sleep'){
        const bed=action.bed;
        // Old clients cannot skip the night with a one-shot sleep command.
        result={...result,ok:false,type:'sleep'};
      }
      client.results.set(action.id,result);
    }
    for(const id of Array.isArray(b.ack)?b.ack.slice(0,100):[])client.results.delete(id);
    // Clients retry unacknowledged commands with stable IDs; retain receipts until acknowledged.
    this.version++;
    const sleep=this.sleepState(now);
    return {version:this.version,time:this.time,sleep,damage:client.damage,knockback:client.knockback||{x:0,z:0},monsters:[...this.monsters.values()].map(m=>({id:m.id,...m.position,health:m.health,yaw:m.yaw||0})),loot:[...this.loot.values()],results:[...client.results.values()]};
  }
}
async function roomLife(room,clientId,b){const [core,physics]=await modules;room.life ||=new RoomLife(core,physics,room,room.lifeStartTime??(clientId===room.world.hostClientId?b.time:28800),Date.now());return room.life.request(clientId,b);}
module.exports={roomLife,RoomLife};
