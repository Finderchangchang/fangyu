import test from 'node:test';
import assert from 'node:assert/strict';
import { fallDamage, FallTracker, eatFood, hitAnimal, FOODS } from '../survival.js';
import * as THREE from '../vendor/three/three.module.js';
import { Animals } from '../animals.js';
import { NightMonsters } from '../night-monsters.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('sword kills cow/sheep in one 20-damage hit and monster in three',()=>{
  const scene=new THREE.Scene(),world={loaded:()=>true,block:()=>0,terrain:{hash:()=>.5}};
  const herd=new Animals(scene,world);
  for(const type of ['cow','sheep']){
    const a=herd.create(type,type,0,7,0);
    assert.ok(herd.hit(a,20));assert.equal(a.health,0);assert.equal(herd.hit(a,20),null);
  }
  herd.dispose();const monsters=new NightMonsters(scene,world),m=monsters.create(0,0);
  for(let i=0;i<2;i++)assert.deepEqual(monsters.hit(m,20),[]);
  assert.equal(m.health,10);assert.ok(monsters.hit(m,20).length>=1);assert.equal(monsters.entities.size,0);monsters.dispose();
});

test('actual mining handler blocks sword digging and consumes durability only on hit',()=>{
  const source=readFileSync(new URL('../game.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function consumeSwordUse()'),source.indexOf('function tickMining(dt)'));
  let damage=0,saves=0;
  const context={merchantTarget:null,camera:{position:{x:0,y:0,z:0}},playerTarget:null,bedSleep:null,roomId:'',playing:true,target:null,miningTask:null,eating:null,selectedFood:null,equippedTool:'sword',
    ownedTools:new Set(['none','sword']),toolDurability:{sword:100},monsterTarget:null,animalTarget:null,
    updateTarget(){},toast(){},updateToolsUI(){},performance:{now:()=>1000},lastAnimalHit:0,
    monsters:{hit(m,n){damage=n;m.health-=n;}},saveWorld(){saves++;}};
  vm.createContext(context);vm.runInContext(code,context);
  vm.runInContext('startMining()',context);
  assert.equal(context.miningTask,null);assert.equal(context.toolDurability.sword,100);
  context.monsterTarget={health:300};vm.runInContext('startMining()',context);
  assert.equal(damage,20);assert.equal(context.toolDurability.sword,99);assert.equal(saves,1);
  context.toolDurability.sword=1;context.lastAnimalHit=0;vm.runInContext('startMining()',context);
  assert.equal(context.equippedTool,'none');assert.equal(context.ownedTools.has('sword'),false);
});

test('sword recipe costs exactly ten stone',()=>{
  const source=readFileSync(new URL('../game.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('const TOOL_RECIPES ='),source.indexOf('const keys ='));
  assert.equal(vm.runInNewContext(code+'JSON.stringify(TOOL_RECIPES.sword)'),'{"stone":10}');
});
test('owned omni tool mines every breakable material in 0.1 seconds',()=>{
  const source=readFileSync(new URL('../game.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function miningDuration('),source.indexOf('function startMining()'));
  const c={equippedTool:'omni',ownedTools:new Set(['omni']),TOOL_MINE_TIMES:{},MINE_TIMES:{stone:5,bed:5}};
  vm.createContext(c);vm.runInContext(code,c);
  for(const id of ['grass','dirt','stone','wood','leaves','sand','cotton','bed'])assert.equal(vm.runInContext(`miningDuration('${id}')`,c),.1);
  c.ownedTools.clear();assert.equal(vm.runInContext("miningDuration('stone')",c),5);assert.equal(c.equippedTool,'none');
});
test('omni survives repeated mining while ordinary tools lose durability',()=>{
  const source=readFileSync(new URL('../game.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function tickMining(dt)'),source.indexOf('function editTarget(place)'));
  const el={style:{},textContent:'',hidden:false};
  const c={miningTask:null,world:{block:()=>1,edit:()=>true},BLOCKS:[{id:'stone',name:'石头'}],equippedTool:'omni',toolDurability:{omni:100,pickaxe:100},ownedTools:new Set(['omni','pickaxe']),TOOL_NAMES:{omni:'万能工具',pickaxe:'镐子'},$:()=>el,updateToolsUI(){},spawnDrop(){},sendRoomEdit(){},toast(){},updateTarget(){}};
  vm.createContext(c);vm.runInContext(code,c);
  for(let i=0;i<200;i++){c.miningTask={type:'stone',x:0,y:1,z:0,elapsed:0,duration:.1};vm.runInContext('tickMining(.1)',c);}
  assert.equal(c.toolDurability.omni,100);assert.ok(c.ownedTools.has('omni'));
  for(const [id,n] of [['omni2',2],['omni50',50]]){
    c.equippedTool=id;c.ownedTools.add(id);c.toolDurability[id]=n;
    for(let i=0;i<n;i++){c.miningTask={type:'stone',x:0,y:1,z:0,elapsed:0,duration:.1};vm.runInContext('tickMining(.1)',c);}
    assert.equal(c.toolDurability[id],0);assert.equal(c.ownedTools.has(id),false);assert.equal(c.equippedTool,'none');
  }
  c.equippedTool='pickaxe';c.miningTask={type:'stone',x:0,y:1,z:0,elapsed:0,duration:.1};vm.runInContext('tickMining(.1)',c);assert.equal(c.toolDurability.pickaxe,99);
});
test('fall tiers: 3=1, 4/5=4, 6=5 and one per additional block',()=>{
  for(const [distance,damage] of [[0,0],[2.9,0],[3,1],[4,4],[5,4],[6,5],[7,6],[20,19],[256,100]])assert.equal(fallDamage(distance),damage);
});
test('falls damage only on landing, not while waiting or after respawn',()=>{
  const f=new FallTracker();f.reset();assert.equal(f.update(10,true),0);assert.equal(f.update(8,false),0);assert.equal(f.update(4,false,true),0);assert.equal(f.update(4,true),5);assert.equal(f.update(4,true),0);f.reset();assert.equal(f.update(20,true),0);
});
test('four 5-point hits kill a 20-health animal and health never goes negative',()=>{
  let hp=20;for(const expected of [15,10,5,0,0]){hp=hitAnimal(hp);assert.equal(hp,expected);}
});
test('eating requires two seconds and one meat, heals correct amount, caps at 100',()=>{
  const beef=FOODS.find(f=>f.id==='beef'),mutton=FOODS.find(f=>f.id==='mutton');
  assert.equal(eatFood(20,1,beef,1.99),null);assert.equal(eatFood(20,0,beef,2),null);assert.equal(eatFood(100,1,beef,2),null);
  assert.deepEqual(eatFood(20,2,beef,2),{health:50,count:1});assert.deepEqual(eatFood(20,1,mutton,2),{health:40,count:0});assert.deepEqual(eatFood(95,1,beef,2),{health:100,count:0});
});
test('cow and sheep have raycast targets, 20 health and exactly one matching drop',()=>{
  const world={loaded:()=>true,block:(x,y,z)=>y===6?1:0,terrain:{hash:()=>.5},chunks:new Map([['0,0',{cx:0,cz:0,ready:true}]])};
  const scene=new THREE.Scene(),herd=new Animals(scene,world);
  herd.populate({x:8,y:8,z:8});assert.equal(herd.entities.size,2);
  for(const a of [...herd.entities.values()]){
    assert.equal(a.health,20);assert.ok(a.group.children.length>=10);
    for(let i=0;i<3;i++)assert.equal(herd.hit(a),null);
    const drop=herd.hit(a);assert.equal(drop.type,a.type==='cow'?'beef':'mutton');assert.equal(herd.hit(a),null);
  }
  herd.populate({x:8,y:8,z:8});assert.equal(herd.entities.size,0);
  const saved=herd.snapshot();herd.dispose();assert.equal(scene.children.length,0);
  const restored=new Animals(scene,world);restored.load(saved);restored.populate({x:8,y:8,z:8});assert.equal(restored.entities.size,0);
  const a=restored.create('ray','cow',0,7,0),camera=new THREE.PerspectiveCamera();camera.position.set(0,8,-3);camera.lookAt(0,8,0);
  assert.equal(restored.target(camera),a);assert.equal(restored.target(camera,.1),null);restored.dispose();
});
