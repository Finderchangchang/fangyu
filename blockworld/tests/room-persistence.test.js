import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {CloudWorlds}=require('../../blockworld-cloud.cjs');
const {RoomArchive}=require('../../blockworld-room-store.cjs');
test('granted infinite tool survives stale shared saves and restart without restoring spent materials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'permanent-tool-'));
  try{
    let cloud=new CloudWorlds(dir),auth=cloud.handle('target',{op:'connect'}),world=cloud.handle('target',{...auth,op:'create'});
    cloud.commit(cloud.account('target'),{op:'recovery',scope:'shared',grant:'omni-test',profile:{inventory:{stone:500},tools:['omni'],toolDurability:{omni:100}}});
    cloud.handle('target',{...auth,op:'writePlayProfile',id:world.id,mode:'shared',profile:{inventory:{stone:420},tools:['axe'],toolDurability:{axe:75,omni:0}}});
    for(let i=0;i<2;i++){
      const p=cloud.handle('target',{...auth,op:'readPlayProfile',id:world.id,mode:'shared'});
      assert.ok(p.tools.includes('omni'));assert.equal(p.toolDurability.omni,100);assert.equal(p.toolDurability.axe,75);assert.equal(p.inventory.stone,420);
      assert.deepEqual(cloud.handle('target',{...auth,op:'readPlayProfile',id:world.id,mode:'private'}).inventory,{});
      cloud=new CloudWorlds(dir);
    }
    const other=cloud.handle('other',{op:'connect'}),otherWorld=cloud.handle('other',{...other,op:'create'});
    assert.ok(!cloud.handle('other',{...other,op:'readPlayProfile',id:otherWorld.id,mode:'shared'}).tools.includes('omni'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('shared grant adds 500 once without modifying independent inventory',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-grant-'));
  try{
    let cloud=new CloudWorlds(dir);const auth=cloud.handle('target',{op:'connect'}),world=cloud.handle('target',{...auth,op:'create'});
    cloud.handle('target',{...auth,op:'writePlayProfile',id:world.id,mode:'shared',profile:{inventory:{stone:9},tools:[]}});
    cloud.handle('target',{...auth,op:'writePlayProfile',id:world.id,mode:'private',profile:{inventory:{stone:3}}});
    fs.writeFileSync(path.join(dir,'recovery-grants.json'),JSON.stringify([{key:'shared-test',name:'target',scope:'shared',items:{stone:500,bed:500},tools:['axe','sword'],hasWorkbench:true}]));
    for(let i=0;i<2;i++){
      cloud=new CloudWorlds(dir);const state=cloud.account('target');
      assert.equal(state.sharedBag.inventory.stone,509);assert.equal(state.sharedBag.inventory.bed,500);assert.equal(state.sharedBag.toolDurability.sword,100);assert.equal(state.sharedBag.hasWorkbench,true);assert.equal(state.privateProfiles.get(world.id).inventory.stone,3);
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('room profiles survive restart and remain isolated by account',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'room-profile-'));
  try{let cloud=new CloudWorlds(dir);let session=cloud.handle('guest',{op:'connect'}).session;
    cloud.handle('guest',{op:'writeRoomProfile',session,id:'room-123456-instance',profile:{inventory:{stone:7}}});
    cloud=new CloudWorlds(dir);session=cloud.handle('guest',{op:'connect'}).session;
    assert.equal(cloud.handle('guest',{op:'readRoomProfile',session,id:'room-123456-instance'}).inventory.stone,7);
    session=cloud.handle('other',{op:'connect'}).session;
    assert.equal(cloud.handle('other',{op:'readRoomProfile',session,id:'room-123456-instance'}),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('room terrain and instance survive all players leaving and server restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'room-map-'));
  try{let archive=new RoomArchive(dir);const room={id:'123456',world:{seed:42,instanceId:'stable',owner:'host'},edits:{},editRevision:0};
    archive.base(room);archive.edit(room,'1,2,3',null);archive=new RoomArchive(dir);
    const restored=archive.load('123456');assert.equal(restored.world.instanceId,'stable');assert.equal(restored.edits['1,2,3'],null);assert.equal(restored.players.size,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('recovery adds materials once, preserves existing items and restores tools',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'room-grant-'));
  try{let cloud=new CloudWorlds(dir);const session=cloud.handle('target',{op:'connect'}).session;
    const world=cloud.handle('target',{op:'create',session,title:'old'});
    cloud.handle('target',{op:'writeProfile',session,id:world.id,profile:{inventory:{stone:6,cotton:4},health:76}});
    fs.writeFileSync(path.join(dir,'recovery-grants.json'),JSON.stringify([{key:'test',name:'target',worldId:world.id,items:{stone:100},tools:['axe']}]));
    cloud=new CloudWorlds(dir);let state=cloud.account('target');assert.equal(state.worlds.get(world.id).profile.inventory.stone,106);
    cloud=new CloudWorlds(dir);state=cloud.account('target');const p=state.worlds.get(world.id).profile;
    assert.equal(p.inventory.stone,106);assert.equal(p.inventory.cotton,4);assert.equal(p.health,76);assert.equal(p.toolDurability.axe,100);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
