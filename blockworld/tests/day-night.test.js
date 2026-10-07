import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldClock, DAY_SECONDS } from '../day-night.js';
import * as THREE from '../vendor/three/three.module.js';
import { NightMonsters, MONSTER_LIMIT } from '../night-monsters.js';
import { EYE_HEIGHT } from '../physics.js';

test('random spawn follows player on land and in deep caves, never inside blocks',()=>{
  for(const [x,z,feet] of [[0,0,12],[500,-400,12],[-300,600,-100]]){
    const world={loaded:()=>true,block:(x,y,z)=>y<feet?3:0};
    const monsters=new NightMonsters(new THREE.Scene(),world),player=new THREE.Vector3(x,feet+EYE_HEIGHT,z);
    monsters.spawnNear(player);assert.equal(monsters.entities.size,1);
    const m=[...monsters.entities][0],distance=Math.hypot(m.position.x-x,m.position.z-z);
    assert.ok(distance>=15&&distance<=37);assert.equal(m.group.position.y,feet);
    assert.equal(m.physics.collides(m.position),false);monsters.dispose();
  }
});
test('spawn rejects voids, solid columns and low ceilings',()=>{
  for(const block of [()=>0,()=>3,(x,y,z)=>y===9||y===11?3:0]){
    const monsters=new NightMonsters(new THREE.Scene(),{loaded:()=>true,block});
    // Only a low ceiling exists within the valid range when higher ground is blocked too.
    if(block(0,9,0)&&!block(0,10,0))monsters.world.block=(x,y,z)=>y===9||y>=11?3:0;
    assert.equal(monsters.spawnFloor(0,0,10+EYE_HEIGHT),null);monsters.dispose();
  }
});

test('one real second equals one game minute; 24 real minutes equals one day',()=>{
  const clock=new WorldClock();
  clock.advance(1);assert.equal(clock.label,'08:01');
  clock.advance(59);assert.equal(clock.label,'09:00');
  clock.advance(1380);assert.equal(clock.label,'08:00');assert.equal(clock.day,2);
});
test('day starts at 08:00 and night at 18:00, including midnight',()=>{
  for(const [seconds,label,night] of [[8*3600-60,'07:59',true],[8*3600,'08:00',false],[18*3600-60,'17:59',false],[18*3600,'18:00',true],[DAY_SECONDS,'00:00',true]]){
    const clock=new WorldClock(seconds);assert.equal(clock.label,label);assert.equal(clock.night,night);
  }
});
test('saved clock restores; invalid values and negative elapsed time are safe',()=>{
  const clock=new WorldClock(19*3600);clock.advance(.5);
  assert.equal(new WorldClock(clock.seconds).label,'19:00');
  for(const bad of [undefined,NaN,Infinity,-1]){clock.restore(bad);assert.equal(clock.label,'08:00');}
  for(const bad of [NaN,Infinity,-1])clock.advance(bad);
  assert.equal(clock.label,'08:00');
});
const seaWorld={loaded:()=>true,block:(x,y,z)=>y===4?3:0};
test('monsters have 50 health, take 5 per hit and disappear at sunrise',()=>{
  const scene=new THREE.Scene(),monsters=new NightMonsters(scene,seaWorld);
  const monster=monsters.create(0,0);assert.equal(monster.health,50);
  for(let i=0;i<9;i++)assert.deepEqual(monsters.hit(monster),[]);
  assert.equal(monster.health,5);const loot=monsters.hit(monster);assert.equal(monsters.entities.size,0);
  assert.ok(loot.length>=1&&loot.length<=3);assert.ok(loot.every(item=>['dirt','stone','wood','leaves','sand','cotton'].includes(item.type)));
  assert.deepEqual(monsters.hit(monster),[]);
  monsters.create(0,0);monsters.update(.01,new THREE.Vector3(),false,()=>assert.fail());
  assert.equal(scene.children.length,0);monsters.dispose();
});
test('spawn requires loaded ground and respects population cap',()=>{
  const scene=new THREE.Scene(),monsters=new NightMonsters(scene,{loaded:()=>false,block:()=>0});
  monsters.spawnNear(new THREE.Vector3());assert.equal(monsters.entities.size,0);
  monsters.world={loaded:()=>true,block:()=>3};monsters.spawnNear(new THREE.Vector3());assert.equal(monsters.entities.size,0);
  monsters.world=seaWorld;
  for(let i=0;i<MONSTER_LIMIT;i++)monsters.create(i*5,0);
  monsters.spawnNear(new THREE.Vector3());assert.equal(monsters.entities.size,MONSTER_LIMIT);monsters.dispose();
});
test('nearby monster deals 20 damage with a one-second cooldown',()=>{
  const monsters=new NightMonsters(new THREE.Scene(),seaWorld),monster=monsters.create(0,0);
  monsters.spawnClock=0;const player=monster.position.clone();player.x+=1;
  const hits=[];
  for(let i=0;i<41;i++)monsters.update(.05,player,true,amount=>hits.push(amount));
  assert.deepEqual(hits,[20,20]);monsters.dispose();
});
