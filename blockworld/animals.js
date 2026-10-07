import * as THREE from './vendor/three/three.module.js';
import { HEIGHT, MIN_Y, WATER } from './world-core.js';
import { hitAnimal } from './survival.js';
import {Physics,EYE_HEIGHT} from './physics.js';

export class Animals {
  constructor(scene, world) {
    this.scene=scene; this.world=world; this.entities=new Map(); this.states={}; this.clock=0;
    this.geometry=new THREE.BoxGeometry(1,1,1);
    this.materials={};
    for(const [name,color] of Object.entries({wool:0xf3eee0,skin:0xbba080,brown:0x71503b,cream:0xfff4db,dark:0x302820,pink:0xdc9b91}))
      this.materials[name]=new THREE.MeshStandardMaterial({color,roughness:1});
    this.ray=new THREE.Raycaster();
  }
  load(states={}) { this.states={...states}; }
  snapshot() { return {...this.states}; }
  floor(x,z,top=HEIGHT-1) {
    if(!this.world.loaded(x,z))return null;
    for(let y=Math.min(HEIGHT-1,Math.floor(top));y>=MIN_Y;y--)if(this.world.block(Math.floor(x),y,Math.floor(z)))return y+1;
    return null;
  }
  create(id,type,x,y,z) {
    const group=new THREE.Group(),legs=[];
    const part=(material,sx,sy,sz,px,py,pz)=>{const mesh=new THREE.Mesh(this.geometry,this.materials[material]);mesh.scale.set(sx,sy,sz);mesh.position.set(px,py,pz);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);return mesh;};
    const sheep=type==='sheep';
    part(sheep?'wool':'brown',.85,.7,1.25,0,.85,0);
    part(sheep?'skin':'cream',.48,.48,.5,0,1.05,-.72);
    part('pink',.42,.19,.14,0,.91,-1.02);
    for(const x of [-.16,.16])part('dark',.07,.08,.04,x,1.12,-.99);
    for(const x of [-.3,.3])for(const z of [-.42,.42])legs.push(part(sheep?'skin':'dark',.17,.5,.17,x,.25,z));
    for(const x of [-.35,.35])part(sheep?'wool':'brown',.23,.12,.2,x,1.15,-.73);
    if(!sheep){part('cream',.05,.4,.45,.44,.88,.18);for(const x of [-.19,.19])part('cream',.1,.22,.1,x,1.4,-.68);}
    group.position.set(x,y,z);this.scene.add(group);
    const entity={id,type,group,legs,health:this.states[id]??20,angle:this.world.terrain.hash(Math.floor(x),Math.floor(z),81)*Math.PI*2,phase:0,flash:0};
    group.userData.animal=entity;this.entities.set(id,entity);return entity;
  }
  populate(p) {
    for(const entity of this.entities.values())if(Math.hypot(entity.group.position.x-p.x,entity.group.position.z-p.z)>58){this.scene.remove(entity.group);this.entities.delete(entity.id);}
    const chunks=[...this.world.chunks.values()].filter(c=>c.ready).sort((a,b)=>Math.hypot(a.cx*16-p.x,a.cz*16-p.z)-Math.hypot(b.cx*16-p.x,b.cz*16-p.z));
    for(const chunk of chunks){
      for(let slot=0;slot<2;slot++){
        if(this.entities.size>=12)return;
        const id=`${chunk.cx},${chunk.cz}:${slot}`;
        if(this.entities.has(id)||this.states[id]===0)continue;
        const x=chunk.cx*16+3+Math.floor(this.world.terrain.hash(chunk.cx,chunk.cz,90+slot)*10),z=chunk.cz*16+3+Math.floor(this.world.terrain.hash(chunk.cx,chunk.cz,94+slot)*10);
        const y=this.floor(x,z),type=this.world.block(x,(y??0)-1,z);
        if(y==null||y<=WATER+1||![1,2].includes(type)||Math.hypot(x-p.x,z-p.z)>42)continue;
        this.create(id,slot?'sheep':'cow',x+.5,y,z+.5);
      }
    }
  }
  update(dt,p) {
    this.clock+=dt;if(this.clock>.75){this.populate(p);this.clock=0;}
    for(const a of this.entities.values()){
      const p=a.group.position;if(!this.world.loaded(p.x,p.z))continue;
      if(a.pushTime>0){a.pushTime-=dt;a.pushPhysics.update(dt,{x:0,z:0},0);p.set(a.pushPhysics.position.x,a.pushPhysics.position.y-EYE_HEIGHT,a.pushPhysics.position.z);continue;}
      a.phase+=dt;const x=p.x+Math.sin(a.angle)*dt*.55,z=p.z+Math.cos(a.angle)*dt*.55;
      const next=this.floor(x,z,p.y+.9);
      if(next!=null&&Math.abs(next-p.y)<1.1&&next>WATER&&!this.world.block(Math.floor(x),Math.floor(next+1),Math.floor(z))){p.set(x,next,z);a.group.rotation.y=-a.angle+Math.PI;}
      else a.angle+=dt*2;
      const floor=this.floor(p.x,p.z,p.y-.01);if(floor!=null&&floor<p.y-.1)p.y=Math.max(floor,p.y-dt*8);
      if(Math.floor(a.phase*2)%9===0)a.angle+=dt*.8;
      a.legs.forEach((leg,i)=>leg.rotation.x=Math.sin(a.phase*5+(i%2)*Math.PI)*.22);
      a.flash=Math.max(0,a.flash-dt);a.group.scale.setScalar(a.flash>0?1.06:1);
    }
  }
  target(camera,blockDistance=Infinity) {
    camera.updateMatrixWorld();this.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(new THREE.Vector2(0,0),camera);this.ray.far=Math.min(4.5,blockDistance);
    const hit=this.ray.intersectObjects([...this.entities.values()].map(a=>a.group),true)[0];
    if(!hit)return null;let obj=hit.object;while(obj&&!obj.userData.animal)obj=obj.parent;
    return obj?.userData.animal||null;
  }
  hit(animal,damage=5,from=null) {
    if(!this.entities.has(animal.id)||animal.health<=0)return null;
    animal.health=hitAnimal(animal.health,damage);this.states[animal.id]=animal.health;animal.flash=.2;
    if(from){const p=animal.group.position,dx=p.x-from.x,dz=p.z-from.z,d=Math.hypot(dx,dz)||1;
      animal.pushPhysics=new Physics({x:p.x,y:p.y+EYE_HEIGHT,z:p.z},(x,y,z)=>this.world.block(x,y,z),(x,z)=>this.world.loaded(x,z));animal.pushPhysics.knockback(dx/d*7,dz/d*7);animal.pushTime=.6;}
    if(animal.health>0)return null;
    const drop={x:animal.group.position.x,y:animal.group.position.y,z:animal.group.position.z,type:animal.type==='cow'?'beef':'mutton'};
    this.scene.remove(animal.group);this.entities.delete(animal.id);return drop;
  }
  dispose(){for(const a of this.entities.values())this.scene.remove(a.group);this.entities.clear();this.geometry.dispose();Object.values(this.materials).forEach(m=>m.dispose());}
}
