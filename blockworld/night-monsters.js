import * as THREE from './vendor/three/three.module.js';
import { WATER, HEIGHT, MIN_Y, trace } from './world-core.js';
import { Physics, EYE_HEIGHT } from './physics.js';
export const MONSTER_HEALTH=50,MONSTER_DAMAGE=20,MONSTER_LIMIT=6;
export const MONSTER_LOOT=['dirt','stone','wood','leaves','sand','cotton'];
export class NightMonsters {
  constructor(scene,world){
    this.scene=scene;this.world=world;this.entities=new Set();this.spawnClock=8;this.ray=new THREE.Raycaster();
    this.geometry=new THREE.BoxGeometry(1,1,1);
    this.skin=new THREE.MeshStandardMaterial({color:0x285a64,roughness:.8});
    this.eye=new THREE.MeshStandardMaterial({color:0xff6644,emissive:0xff3300,emissiveIntensity:2});
  }
  create(x,z,feetY=WATER+1){
    const group=new THREE.Group();
    const part=(mat,sx,sy,sz,px,py,pz)=>{const m=new THREE.Mesh(this.geometry,mat);m.scale.set(sx,sy,sz);m.position.set(px,py,pz);m.castShadow=true;group.add(m);return m;};
    part(this.skin,.85,1,.5,0,1,0);part(this.skin,.65,.6,.65,0,1.78,0);
    for(const x of [-.22,.22]){part(this.skin,.25,.65,.3,x,.325,0);part(this.eye,.13,.12,.05,x,1.85,-.34);}
    for(const x of [-.57,.57])part(this.skin,.25,.95,.3,x,1.1,-.1);
    const position=new THREE.Vector3(x,feetY+EYE_HEIGHT,z);
    const physics=new Physics(position,(x,y,z)=>this.world.block(x,y,z),(x,z)=>this.world.loaded(x,z));
    const monster={group,position,physics,health:MONSTER_HEALTH,cooldown:1,flash:0};
    group.position.set(x,feetY,z);group.userData.monster=monster;this.scene.add(group);this.entities.add(monster);return monster;
  }
  spawnFloor(x,z,playerY){
    if(!this.world.loaded(x,z))return null;
    const center=Math.floor(playerY-EYE_HEIGHT);
    // Pick a real floor near the player's elevation, including underground caves.
    for(let offset=0;offset<=8;offset++)for(const feet of offset?[center-offset,center+offset]:[center]){
      if(feet<=MIN_Y||feet+2>=HEIGHT)continue;
      if(this.world.block(x,feet-1,z)&&![0,1,2].some(d=>this.world.block(x,feet+d,z)))return feet;
    }
    return null;
  }
  spawnNear(player){
    if(this.entities.size>=MONSTER_LIMIT)return;
    for(let attempt=0;attempt<40;attempt++){
      const a=Math.random()*Math.PI*2,r=16+Math.random()*20,x=Math.floor(player.x+Math.cos(a)*r),z=Math.floor(player.z+Math.sin(a)*r);
      const feet=this.spawnFloor(x,z,player.y);
      if(feet===null||[...this.entities].some(m=>Math.hypot(m.position.x-x,m.position.z-z)<4))continue;
      this.create(x+.5,z+.5,feet);return;
    }
  }
  clear(){for(const m of this.entities)this.scene.remove(m.group);this.entities.clear();this.spawnClock=8;}
  update(dt,player,night,damage){
    if(!night){this.clear();return;}
    this.spawnClock+=dt;if(this.spawnClock>=8){this.spawnClock=0;this.spawnNear(player);}
    for(const m of this.entities){
      if(m.position.distanceTo(player)>64||m.position.y<MIN_Y-4){this.scene.remove(m.group);this.entities.delete(m);continue;}
      if(!this.world.loaded(m.position.x,m.position.z))continue;
      const dx=player.x-m.position.x,dz=player.z-m.position.z,d=Math.hypot(dx,dz),before=m.position.clone();
      m.physics.update(dt,{x:d>1.3?dx/d:0,z:d>1.3?dz/d:0},2.2);
      if(d>2&&m.physics.grounded&&Math.hypot(m.position.x-before.x,m.position.z-before.z)<dt*.5)m.physics.jump();
      m.group.position.copy(m.position);m.group.position.y-=EYE_HEIGHT;m.group.rotation.y=Math.atan2(-dx,-dz);
      m.flash=Math.max(0,m.flash-dt);m.group.scale.setScalar(m.flash>0?1.08:1);
      m.cooldown=Math.max(0,m.cooldown-dt);
      const delta=new THREE.Vector3().subVectors(player,m.position),distance=delta.length();
      if(distance<2&&m.cooldown===0){
        const blocked=trace(m.position,delta.normalize(),(x,y,z)=>this.world.block(x,y,z),(x,z)=>this.world.loaded(x,z),distance);
        if(!blocked){m.cooldown=1;damage(MONSTER_DAMAGE);}
      }
    }
  }
  target(camera,blockDistance=Infinity){
    camera.updateMatrixWorld();this.scene.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2(),camera);this.ray.far=Math.min(4.5,blockDistance);
    const hit=this.ray.intersectObjects([...this.entities].map(m=>m.group),true)[0];if(!hit)return null;
    let obj=hit.object;while(obj&&!obj.userData.monster)obj=obj.parent;return obj?.userData.monster||null;
  }
  syncRemote(rows){
    const ids=new Set(rows.map(row=>row.id));
    for(const m of this.entities)if(!ids.has(m.id)){this.scene.remove(m.group);this.entities.delete(m);}
    for(const row of rows){
      let m=[...this.entities].find(m=>m.id===row.id);
      if(!m){m=this.create(row.x,row.z,row.y-EYE_HEIGHT);m.id=row.id;}
      m.health=row.health;m.destination=new THREE.Vector3(row.x,row.y,row.z);m.yaw=row.yaw;
    }
  }
  renderRemote(dt){for(const m of this.entities){if(!m.destination)continue;m.position.lerp(m.destination,1-Math.exp(-dt*12));m.group.position.copy(m.position);m.group.position.y-=EYE_HEIGHT;m.group.rotation.y=m.yaw;}}
  hit(monster,damage=5,from=null){
    if(!this.entities.has(monster))return [];
    monster.health=Math.max(0,monster.health-damage);monster.flash=.2;
    if(from){const dx=monster.position.x-from.x,dz=monster.position.z-from.z,d=Math.hypot(dx,dz)||1;monster.physics.knockback(dx/d*7,dz/d*7);}
    if(monster.health)return [];
    this.scene.remove(monster.group);this.entities.delete(monster);
    return Array.from({length:1+Math.floor(Math.random()*3)},()=>({
      x:monster.position.x-.5,y:monster.position.y-EYE_HEIGHT,z:monster.position.z-.5,
      type:MONSTER_LOOT[Math.floor(Math.random()*MONSTER_LOOT.length)]
    }));
  }
  dispose(){this.clear();this.geometry.dispose();this.skin.dispose();this.eye.dispose();}
}
