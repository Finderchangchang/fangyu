import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';
import {nextMorning} from '../bag.js';
const source=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function sleepInBed()'),source.indexOf('function consumeSwordUse()'));
function setup(roomId=''){
  const camera=new THREE.PerspectiveCamera();camera.position.set(2,4,2);
  const c={THREE,camera,bedSleep:null,playing:true,ready:true,miningTask:null,eating:null,target:{type:8,x:2,y:1,z:2},animalTarget:null,monsterTarget:null,roomId,worldClock:{night:true,seconds:72000,restore(n){this.seconds=n;}},world:{block:()=>8},roomLifeClient:{received:true,commands:[],command(value){this.commands.push(value);return true;}},resetInput(){},targetOutline:{visible:true},toast(){},physics:{velocity:0},fallTracker:{reset(){}},darkness:1,saveWorld(){},updateTarget(){},nextMorning,scene:{},renderer:{render(){}}};
  c.$=()=>({textContent:''});vm.createContext(c);vm.runInContext(code,c);return c;
}
test('sleep lies down for ten seconds before morning, restores standing camera',()=>{
  const c=setup(),position=c.camera.position.clone(),rotation=c.camera.quaternion.clone();
  vm.runInContext('sleepInBed();tickBedSleep(1)',c);assert.ok(c.bedSleep);assert.equal(c.worldClock.seconds,72000);
  let lying=false;c.renderer.render=()=>{lying=c.camera.position.y<position.y&&c.camera.rotation.x>1;};
  vm.runInContext('renderBedSleep()',c);assert.ok(lying);assert.deepEqual(c.camera.position,position);assert.ok(c.camera.quaternion.equals(rotation));
  vm.runInContext('tickBedSleep(8)',c);assert.ok(c.bedSleep);assert.equal(c.worldClock.seconds,72000);
  vm.runInContext('tickBedSleep(1)',c);assert.equal(c.bedSleep,null);assert.equal(c.worldClock.seconds,115200);
});
test('room sleep waits for server instead of skipping locally; interruption cancels',()=>{
  const c=setup('123456');vm.runInContext('sleepInBed();tickBedSleep(1)',c);assert.equal(c.roomLifeClient.commands.length,0);
  vm.runInContext('tickBedSleep(20)',c);assert.equal(c.roomLifeClient.commands.length,0);assert.ok(c.bedSleep);assert.equal(c.worldClock.seconds,72000);
  const p=setup();vm.runInContext('sleepInBed();playing=false;tickBedSleep(2)',p);assert.equal(p.bedSleep,null);assert.equal(p.worldClock.seconds,72000);
});
