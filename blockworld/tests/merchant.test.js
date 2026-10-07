import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';
import {exchange,Merchants} from '../merchant.js';
test('merchant exchanges exact costs, preserves originals and rejects insufficient or duplicate tools',()=>{
  const inv={stone:105,wood:100};
  assert.deepEqual(exchange(inv,'omni50'),{stone:5,wood:100});assert.deepEqual(exchange(inv,'omni2'),{stone:100,wood:100});
  assert.deepEqual(exchange(inv,'goldenApple'),{stone:5,wood:0,goldenApple:1});assert.equal(inv.stone,105);
  assert.equal(exchange({stone:4},'omni2'),null);assert.equal(exchange(inv,'omni50',['omni50']),null);assert.equal(exchange(inv,'unknown'),null);
});
test('rare merchant needs eligible chunk and dry floor, disposes meshes',()=>{
  const scene=new THREE.Scene(),world={chunks:new Map([['0,0',{ready:true,key:'0,0',cx:0,cz:0}]]),terrain:{hash:()=>.5},block:(x,y,z)=>y===6?1:0};
  let m=new Merchants(scene,world);m.update(1,new THREE.Vector3());assert.equal(m.entities.size,0);m.dispose();
  world.terrain.hash=()=>.005;m=new Merchants(scene,world);m.update(1,new THREE.Vector3());assert.equal(m.entities.size,1);m.update(1,new THREE.Vector3());assert.equal(m.entities.size,1);m.dispose();assert.equal(scene.children.length,0);
});
test('golden apple consumed once, raises health to 1000, expires at 100 and cannot reactivate itself',()=>{
  const source=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function tickEating(dt)'),source.indexOf('function spawnDrop('));
  const c={eating:{id:'goldenApple',elapsed:0},playing:true,selectedFood:'goldenApple',inventory:{goldenApple:1},goldenHealth:false,health:100,respawnGrace:0,$:()=>({style:{setProperty(){}},textContent:''}),cancelEating(){this.eating=null;},updateHealth(){},updateInventoryUI(){},saveWorld(){},toast(){}};
  c.cancelEating=()=>{c.eating=null;};vm.createContext(c);vm.runInContext(code,c);vm.runInContext('tickEating(2)',c);
  assert.equal(c.health,1000);assert.equal(c.inventory.goldenApple,0);assert.equal(c.goldenHealth,true);
  vm.runInContext("damagePlayer(899,'test')",c);assert.equal(c.health,101);assert.equal(c.goldenHealth,true);
  vm.runInContext("damagePlayer(1,'test')",c);assert.equal(c.health,100);assert.equal(c.goldenHealth,false);
  vm.runInContext("damagePlayer(5,'test')",c);assert.equal(c.health,95);assert.equal(c.goldenHealth,false);
});
