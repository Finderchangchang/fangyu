import * as THREE from './vendor/three/three.module.js';
import {HEIGHT,WATER} from './world-core.js';
export const TRADES={omni50:{stone:100},omni2:{stone:5},goldenApple:{stone:100,wood:100}};
export function exchange(inventory,id,owned=[]){
  const cost=TRADES[id];if(!cost||id!=='goldenApple'&&owned.includes(id))return null;
  if(Object.entries(cost).some(([k,n])=>!(inventory[k]>=n)))return null;
  const next={...inventory};for(const [k,n] of Object.entries(cost))next[k]-=n;
  if(id==='goldenApple')next.goldenApple=(next.goldenApple||0)+1;
  return next;
}
export class Merchants{
  constructor(scene,world){this.scene=scene;this.world=world;this.entities=new Map();this.checked=new Set();this.ray=new THREE.Raycaster();this.clock=0;this.geometry=new THREE.BoxGeometry(1,1,1);this.cloth=new THREE.MeshStandardMaterial({color:0x7144aa});this.skin=new THREE.MeshStandardMaterial({color:0xdfb887});this.gold=new THREE.MeshStandardMaterial({color:0xffcf50});}
  update(dt,p){this.clock+=dt;if(this.clock<1)return;this.clock=0;
    for(const [key,g] of this.entities)if(g.position.distanceTo(p)>90){this.scene.remove(g);this.entities.delete(key);this.checked.delete(key);}
    for(const key of this.checked)if(!this.world.chunks.has(key))this.checked.delete(key);
    for(const c of this.world.chunks.values()){
      if(!c.ready||this.checked.has(c.key))continue;this.checked.add(c.key);
      if(this.world.terrain.hash(c.cx,c.cz,9182)>=.01)continue;
      const x=c.cx*16+8,z=c.cz*16+8;let y=null;
      for(let h=HEIGHT-3;h>WATER;h--)if(this.world.block(x,h,z)&&!this.world.block(x,h+1,z)&&!this.world.block(x,h+2,z)){y=h+1;break;}
      if(y==null)continue;
      const g=new THREE.Group();const part=(m,w,h,d,x,y,z)=>{const mesh=new THREE.Mesh(this.geometry,m);mesh.scale.set(w,h,d);mesh.position.set(x,y,z);g.add(mesh);};
      part(this.cloth,.65,1,.4,0,.85,0);part(this.skin,.5,.5,.5,0,1.6,0);part(this.cloth,.65,.18,.6,0,1.94,0);part(this.gold,.7,.15,.42,0,.65,0);
      for(const a of [-1,1]){part(this.cloth,.2,.6,.25,a*.18,.3,0);part(this.skin,.18,.7,.22,a*.43,.95,0);}
      g.position.set(x+.5,y,z+.5);g.userData.merchant=true;this.scene.add(g);this.entities.set(c.key,g);
    }
  }
  target(camera,distance=4.5){camera.updateMatrixWorld();this.scene.updateMatrixWorld(true);this.ray.setFromCamera(new THREE.Vector2(),camera);this.ray.far=Math.min(4.5,distance);const hit=this.ray.intersectObjects([...this.entities.values()],true)[0];if(!hit)return null;let g=hit.object;while(g&&!g.userData.merchant)g=g.parent;return g;}
  dispose(){for(const g of this.entities.values())this.scene.remove(g);this.entities.clear();this.geometry.dispose();this.cloth.dispose();this.skin.dispose();this.gold.dispose();}
}
