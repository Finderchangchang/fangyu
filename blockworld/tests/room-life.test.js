import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as core from '../world-core.js';
import * as physics from '../physics.js';
const {RoomLife}=createRequire(import.meta.url)('../../blockworld-room-life.cjs');
function setup(){
  const position={x:1,y:6.72,z:0};
  const room={world:{seed:123},edits:{},players:new Map([['a',{position}],['b',{position}]])};
  const life=new RoomLife(core,physics,room,64800,1000);life.spawnAt=Infinity;life.block=(x,y,z)=>y===4?3:0;
  const send=(id,commands=[],now=1000)=>life.request(id,{active:true,position,commands},now);
  send('a');send('b');return {life,send};
}
test('all room clients share time, monster health and single death loot',()=>{
  const {life,send}=setup();const p={x:0,y:6.72,z:0};
  life.monsters.set('m',{id:'m',position:p,health:50,cooldown:99999,physics:new physics.Physics(p,(x,y,z)=>y===4?3:0,()=>true)});
  const one=send('a',[{id:'hit1',type:'hit',monster:'m',tool:'sword'}],1400);
  assert.equal(one.monsters[0].health,30);assert.equal(send('b',[],1400).time,one.time);
  assert.equal(send('a',[{id:'hit1',type:'hit',monster:'m',tool:'sword'}],1400).monsters[0].health,30);
  send('b',[{id:'hit2',type:'hit',monster:'m',tool:'sword'}],1500);
  const dead=send('a',[{id:'hit3',type:'hit',monster:'m',tool:'sword'}],1800);
  assert.equal(dead.monsters.length,0);assert.ok(dead.loot.length>=1&&dead.loot.length<=3);
  const drop=dead.loot[0].id;
  assert.equal(send('a',[{id:'pick1',type:'pickup',loot:drop}],1800).results.find(r=>r.id==='pick1').ok,true);
  assert.equal(send('b',[{id:'pick2',type:'pickup',loot:drop}],1800).results.find(r=>r.id==='pick2').ok,false);
  assert.equal(send('a',[{id:'pick1',type:'pickup',loot:drop}],1800).loot.some(d=>d.id===drop),false);
});
test('one sleeper cannot skip night; everyone must continuously sleep ten seconds',()=>{
  const {life,send}=setup();assert.equal(send('a',[{id:'bad',type:'sleep',bed:{x:0,y:5,z:0}}]).results[0].ok,false);
  life.block=(x,y,z)=>x===0&&y===5&&z===0?8:0;
  const bed={x:0,y:5,z:0},poll=(id,sleeping,now)=>life.request(id,{active:true,sleeping},now);
  for(let t=1000;t<=12000;t+=1000){poll('a',bed,t);assert.ok(poll('b',null,t).time<86400);}
  const start=poll('b',bed,12000);assert.equal(start.sleep.sleeping,2);assert.equal(start.sleep.remaining,10);
  for(let t=13000;t<22000;t+=1000){poll('a',bed,t);assert.ok(poll('b',bed,t).time<86400);}
  const result=poll('a',bed,22000);assert.equal(result.time,86400+28800);assert.equal(result.monsters.length,0);
});
test('four players require all four; standing up resets countdown',()=>{
  const {life}=setup(),bed={x:0,y:5,z:0};life.block=()=>8;
  for(const id of ['c','d'])life.room.players.set(id,{position:{x:1,y:6.72,z:0}});
  const poll=(id,sleeping,t)=>life.request(id,{active:true,sleeping},t);
  for(let t=1000;t<=12000;t+=1000)for(const id of ['a','b','c','d']){const result=poll(id,id==='d'?null:bed,t);assert.ok(result.time<86400);}
  poll('d',bed,12000);
  for(let t=13000;t<=16000;t+=1000)for(const id of ['a','b','c','d'])poll(id,bed,t);
  assert.equal(poll('d',null,16000).sleep.all,false);
  assert.equal(poll('d',bed,16000).sleep.remaining,10);
  for(let t=17000;t<26000;t+=1000)for(const id of ['a','b','c','d'])assert.ok(poll(id,bed,t).time<86400);
  assert.equal(poll('a',bed,26000).time,115200);
});
test('clock pauses when all clients paused; remote attacks cannot hit across the map',()=>{
  const {life,send}=setup();life.request('a',{active:false},1000);life.request('b',{active:false},1000);
  assert.equal(life.request('a',{active:false},100000).time,64800);
  assert.equal(send('a',[{id:'missing',type:'hit',monster:'missing'}],100000).results[0].ok,false);
});
test('PvP applies damage and knockback once; rejects self, walls, distant and outside-room targets',()=>{
  const {life}=setup();life.time=28800;
  const request=(id,commands=[],now=5000,x=id==='a'?0:2)=>life.request(id,{active:true,position:{x,y:6.72,z:0},commands},now);
  request('b');request('a');
  const hit={id:'pvp1',type:'hitPlayer',player:'b',tool:'sword'};
  assert.equal(request('a',[hit]).results.find(r=>r.id==='pvp1').ok,true);
  const victim=request('b');assert.equal(victim.damage,20);assert.ok(victim.knockback.x>0);
  request('a',[hit]);assert.equal(request('b').damage,20);
  assert.equal(request('a',[{...hit,id:'fast'}],5100).results.find(r=>r.id==='fast').ok,false);
  assert.equal(request('a',[{...hit,id:'self',player:'a'}],5500).results.find(r=>r.id==='self').ok,false);
  life.visible=()=>false;
  assert.equal(request('a',[{...hit,id:'wall'}],5500).results.find(r=>r.id==='wall').ok,false);
  life.visible=()=>true;request('b',[],5500,50);
  assert.equal(request('a',[{...hit,id:'far'}],5500).results.find(r=>r.id==='far').ok,false);
  request('b',[],6000);life.room.players.delete('b');
  assert.equal(request('a',[{...hit,id:'outside'}],6000).results.find(r=>r.id==='outside').ok,false);
});
