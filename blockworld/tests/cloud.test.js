import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {CloudWorlds}=createRequire(import.meta.url)('../../blockworld-cloud.cjs');
function setup(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isle-cloud-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,cloud:new CloudWorlds(dir)};}
test('phone and computer share account worlds, terrain, inventory and tool durability',t=>{
  const {dir,cloud}=setup(t);let session=cloud.handle('玩家',{op:'connect'}).session;
  const call=b=>cloud.handle('玩家',{session,...b});
  const world=call({op:'create',title:'我的岛'});
  call({op:'write',id:world.id,key:'0,0',edits:{'1,5,1':null,'2,5,2':'stone','3,5,3':'cotton','4,5,4':'bed'}});
  call({op:'writeProfile',id:world.id,profile:{inventory:{stone:10},tools:['sword'],toolDurability:{sword:80},health:70}});
  const old=session;session=cloud.handle('玩家',{op:'connect'}).session;
  assert.equal(call({op:'active'}).id,world.id);assert.equal(call({op:'list'}).length,1);
  assert.equal(call({op:'read',id:world.id,key:'0,0'})['1,5,1'],null);
  assert.equal(call({op:'read',id:world.id,key:'0,0'})['4,5,4'],'bed');
  assert.equal(call({op:'readProfile',id:world.id}).toolDurability.sword,80);
  assert.throws(()=>cloud.handle('玩家',{op:'writeProfile',session:old,id:world.id,profile:{inventory:{}}}),/另一设备/);
  const restored=new CloudWorlds(dir),auth=restored.handle('玩家',{op:'connect'});
  assert.equal(restored.handle('玩家',{...auth,op:'readProfile',id:world.id}).inventory.stone,10);
});
test('accounts are isolated; import stays hidden until complete and cannot overwrite existing map',t=>{
  const {cloud}=setup(t),a=cloud.handle('甲',{op:'connect'}),b=cloud.handle('乙',{op:'connect'});
  const first=cloud.handle('甲',{...a,op:'create'}),copy=cloud.handle('甲',{...a,op:'create',seed:123,importing:true});
  assert.equal(cloud.handle('甲',{...a,op:'list'}).length,1);
  assert.throws(()=>cloud.handle('乙',{...b,op:'readProfile',id:first.id}),/找不到/);
  cloud.handle('甲',{...a,op:'finish',id:copy.id});assert.equal(cloud.handle('甲',{...a,op:'list'}).length,2);
  assert.notEqual(first.id,copy.id);
  assert.throws(()=>cloud.handle('甲',{...a,op:'write',id:first.id,key:'0,0',edits:{'17,3,1':'stone'}}),/无效/);
});
test('night cycle advances hostile monsters and clears them at dawn',()=>{
  const source=fs.readFileSync(new URL('../game.js',import.meta.url),'utf8');
  assert.ok(source.includes('Number(worldClock.night)-darkness'));assert.ok(source.includes('monsters?.update('));assert.ok(source.includes('if(!worldClock.night&&monsters?.entities.size)monsters.clear()'));
});
test('restart preserves session, but a later device still rejects stale writes',t=>{
  const {dir,cloud}=setup(t),auth=cloud.handle('restart',{op:'connect'}),w=cloud.handle('restart',{...auth,op:'create'});
  const next=new CloudWorlds(dir);
  next.handle('restart',{...auth,op:'write',id:w.id,key:'0,0',edits:{'1,3,1':'stone'}});
  next.handle('restart',{op:'connect'});
  const again=new CloudWorlds(dir);
  assert.throws(()=>again.handle('restart',{...auth,op:'write',id:w.id,key:'0,0',edits:{}}),/另一设备/);
});
test('legacy authenticated session upgrades once, cannot be replaced by stale UUID',t=>{
  const {dir,cloud}=setup(t);const auth=cloud.handle('legacy',{op:'connect'}),w=cloud.handle('legacy',{...auth,op:'create'}),file=cloud.account('legacy').file;
  const records=fs.readFileSync(file,'utf8').trim().split('\n').filter(line=>JSON.parse(line).op!=='session');fs.writeFileSync(file,records.join('\n')+'\n');
  const next=new CloudWorlds(dir);assert.equal(next.handle('legacy',{...auth,op:'readProfile',id:w.id}).inventory.constructor,Object);
  assert.throws(()=>next.handle('legacy',{session:'00000000-0000-4000-8000-000000000000',op:'readProfile',id:w.id}),/另一设备/);
});
test('cloud accepts the 100th layer, persists it and rejects above ceiling',t=>{
  const {dir,cloud}=setup(t),auth=cloud.handle('高塔',{op:'connect'}),world=cloud.handle('高塔',{...auth,op:'create'});
  cloud.handle('高塔',{...auth,op:'write',id:world.id,key:'0,0',edits:{'1,99,1':'stone','1,32,1':'wood'}});
  const restored=new CloudWorlds(dir),session=restored.handle('高塔',{op:'connect'});
  assert.equal(restored.handle('高塔',{...session,op:'read',id:world.id,key:'0,0'})['1,99,1'],'stone');
  assert.throws(()=>restored.handle('高塔',{...session,op:'write',id:world.id,key:'0,0',edits:{'1,100,1':'stone'}}),/无效方块/);
});
test('shared materials cross maps and rooms; private run stays separate across restart',t=>{
  const {dir,cloud}=setup(t);const session=cloud.handle('甲',{op:'connect'}).session;
  const call=b=>cloud.handle('甲',{session,...b});
  const a=call({op:'create'}),b=call({op:'create'});
  call({op:'writeProfile',id:a.id,profile:{inventory:{stone:100},tools:['axe'],toolDurability:{axe:100},health:60}});
  call({op:'writeProfile',id:b.id,profile:{inventory:{wood:4},health:90}});
  assert.equal(call({op:'readPlayProfile',id:b.id,mode:'shared'}).inventory.stone,100);
  assert.equal(call({op:'readPlayProfile',id:b.id,mode:'shared'}).health,90);
  assert.deepEqual(call({op:'readPlayProfile',id:b.id,mode:'private'}).inventory,{});
  call({op:'writePlayProfile',id:b.id,mode:'private',profile:{inventory:{dirt:3}}});
  const p=structuredClone(call({op:'readPlayProfile',id:'room-123456-test',mode:'shared'}));p.inventory.stone=99;
  call({op:'writePlayProfile',id:'room-123456-test',mode:'shared',profile:p});
  assert.equal(call({op:'readPlayProfile',id:a.id,mode:'shared'}).inventory.stone,99);
  const next=new CloudWorlds(dir),auth=next.handle('甲',{op:'connect'});
  assert.equal(next.handle('甲',{...auth,op:'readPlayProfile',id:a.id,mode:'shared'}).inventory.stone,99);
  assert.equal(next.handle('甲',{...auth,op:'readPlayProfile',id:b.id,mode:'private'}).inventory.dirt,3);
  const other=next.handle('乙',{op:'connect'});
  assert.deepEqual(next.handle('乙',{...other,op:'readPlayProfile',id:'room-123456-test',mode:'shared'}).inventory,{});
});
