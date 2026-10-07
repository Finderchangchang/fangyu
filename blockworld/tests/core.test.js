import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain, movement, trace, chunkKey, indexOf, HEIGHT, MIN_Y, WORLD_LAYERS } from '../world-core.js';
import { Physics, EYE_HEIGHT, RADIUS } from '../physics.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const finish=g=>{let r;do{r=g.next();}while(!r.done);return r.value;};
test('knockback moves away then decays, without crossing walls or unloaded edges',()=>{
  const p={x:.5,y:1+EYE_HEIGHT,z:.5};
  const physics=new Physics(p,(x,y)=>y===0||x===2?3:0,x=>x<4);
  physics.knockback(7,0);for(let i=0;i<60;i++)physics.update(1/60,{x:0,z:0},0);
  assert.ok(p.x>.5&&p.x<2-RADIUS+.01);assert.ok(physics.pushX<.1);
  const q={x:3.6,y:1+EYE_HEIGHT,z:.5},edge=new Physics(q,(x,y)=>y===0?3:0,x=>x<4);
  edge.knockback(7,0);for(let i=0;i<30;i++)edge.update(1/60,{x:0,z:0},0);assert.ok(q.x<3.7);
});
test('100-layer sky restores tall buildings without changing underground depth',()=>{
  assert.equal(HEIGHT,100);assert.equal(MIN_Y,-256);
  const data=finish(new Terrain(123456).generate(0,0,{'1,99,1':'stone','1,32,1':'wood'}));
  assert.equal(data[indexOf(1,99,1)],3);assert.equal(data[indexOf(1,32,1)],4);
  const p={x:1.5,y:100+EYE_HEIGHT,z:1.5};const physics=new Physics(p,(x,y,z)=>y<HEIGHT&&y>=MIN_Y?data[indexOf(x,y,z)]:0,()=>true);
  physics.update(.05,{x:0,z:0},5);assert.ok(physics.grounded);near(p.y,100+EYE_HEIGHT);
});
test('256 new stone layers preserve surface and negative-height edits',()=>{
  const terrain=new Terrain(123456);
  const edits={'0,-200,0':null,'1,-201,1':'wood',[`0,${MIN_Y},0`]:null};
  const data=finish(terrain.generate(0,0,edits));
  assert.equal(data.length,16*16*WORLD_LAYERS);
  assert.equal(indexOf(0,MIN_Y,0),0);
  for(let y=MIN_Y;y<0;y++) assert.equal(data[indexOf(2,y,2)],3);
  assert.equal(data[indexOf(0,-200,0)],0);
  assert.equal(data[indexOf(1,-201,1)],4);
  assert.equal(data[indexOf(0,MIN_Y,0)],3);
  for(let y=0;y<HEIGHT;y++)assert.equal(data[indexOf(0,y,0)],terrain.legacy.get(`0,${y},0`)||0);
  assert.deepEqual(data,finish(terrain.generate(0,0,edits)));
});
test('deep underground ray targeting and bedrock collision work below zero',()=>{
  const block=(x,y,z)=>y===MIN_Y?3:0;
  const hit=trace({x:.5,y:MIN_Y+3,z:.5},{x:0,y:-1,z:0},block,()=>true);
  assert.equal(hit.y,MIN_Y);
  const p={x:.5,y:MIN_Y+8,z:.5},phys=new Physics(p,block,()=>true);
  for(let i=0;i<180;i++)phys.update(1/60,{x:0,z:0},5);
  near(p.y,MIN_Y+1+EYE_HEIGHT);assert.ok(phys.grounded);
});

test('front/back/strafe follow all four headings, diagonal and analog speeds',()=>{
  for(const dir of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]){
    const last={x:0,z:-1};
    for(const pitchScale of [1,.7,.01]){
      const d={x:dir.x*pitchScale,y:.9,z:dir.z*pitchScale};
      const f=movement(d,last,1,0), b=movement(d,last,-1,0), r=movement(d,last,0,1);
      near(f.x,dir.x);near(f.z,dir.z);near(b.x,-dir.x);near(b.z,-dir.z);
      near(r.x,-dir.z);near(r.z,dir.x);
      const diagonal=movement(d,last,1,1);near(Math.hypot(diagonal.x,diagonal.z),1);
      const gentle=movement(d,last,.25,0);near(Math.hypot(gentle.x,gentle.z),.25);
    }
    const vertical=movement({x:0,y:1,z:0},last,1,0);near(vertical.x,dir.x);near(vertical.z,dir.z);
  }
});
test('negative chunks and generation order, old island including overhanging leaves',()=>{
  assert.equal(chunkKey(-.1,-16),' -1,-1'.trim());
  const terrain=new Terrain(772731), cache=new Map();
  for(const [cx,cz] of [[0,0],[-1,0],[1,1],[-2,-2],[1,0],[0,-1],[-1,-1],[-2,0],[0,-2],[1,-1],[-1,1],[-2,1],[1,-2],[0,1],[-1,-2],[-2,-1]])
    cache.set(`${cx},${cz}`,finish(terrain.generate(cx,cz)));
  for(let x=-19;x<19;x++)for(let z=-19;z<19;z++)for(let y=0;y<HEIGHT;y++)
    assert.equal(cache.get(chunkKey(x,z))[indexOf(x,y,z)],terrain.legacy.get(`${x},${y},${z}`)||0);
  for(const [key,id] of terrain.legacy){const [x,y,z]=key.split(',').map(Number);assert.equal(cache.get(chunkKey(x,z))[indexOf(x,y,z)],id);}
  const far=finish(terrain.generate(-12,33));
  finish(terrain.generate(900,900)); assert.deepEqual(far,finish(terrain.generate(-12,33)));
  assert.ok(far.some(v=>v===1));
});
test('chunk edit overlay restores removals and remote construction',()=>{
  const terrain=new Terrain(123456), edits={'160,28,-160':'wood','160,0,-160':null};
  const data=finish(terrain.generate(10,-10,edits));
  assert.equal(data[indexOf(160,28,-160)],4);assert.equal(data[indexOf(160,0,-160)],0);
});
test('voxel targeting crosses negative boundaries and stops at unloaded terrain / reach',()=>{
  const blocks=(x,y,z)=>x===-17&&y===5&&z===0?4:0;
  const hit=trace({x:-14.5,y:5.5,z:.5},{x:-1,y:0,z:0},blocks,()=>true);
  assert.equal(hit.x,-17);assert.deepEqual(hit.normal,{x:1,y:0,z:0});
  assert.equal(trace({x:-14.5,y:5.5,z:.5},{x:-1,y:0,z:0},blocks,x=>x>=-16),null);
  assert.equal(trace({x:0,y:5.5,z:.5},{x:-1,y:0,z:0},blocks,()=>true),null);
});
test('standing height stays fixed; jumping, landing and ceiling collisions are stable',()=>{
  const p={x:.5,y:8,z:.5}, phys=new Physics(p,(x,y)=>y===0?3:0,()=>true);
  for(let i=0;i<180;i++)phys.update(1/60,{x:0,z:0},5);
  near(p.y,1+EYE_HEIGHT);const y=p.y;
  for(let i=0;i<600;i++)phys.update(i%2?.016:.033,{x:0,z:0},5);
  assert.equal(p.y,y);assert.ok(phys.grounded);
  phys.jump();phys.update(.05,{x:0,z:0},5);assert.ok(p.y>y);
  for(let i=0;i<180;i++)phys.update(1/60,{x:0,z:0},5);
  near(p.y,y);
  phys.block=(x,y)=>y===0||y===3?3:0;phys.jump();
  for(let i=0;i<60;i++){phys.update(1/60,{x:0,z:0},5);assert.ok(p.y<3.00002);}
  assert.ok(phys.grounded);
});
test('walking cannot enter unloaded chunks or pass a wall',()=>{
  const p={x:.5,y:1+EYE_HEIGHT,z:.5}, phys=new Physics(p,(x,y)=>y===0||x===2?3:0,x=>x<4);
  for(let i=0;i<200;i++)phys.update(.05,{x:1,z:0},7.6);
  assert.ok(p.x<1.7);phys.block=(x,y)=>y===0?3:0;
  for(let i=0;i<200;i++)phys.update(.05,{x:1,z:0},7.6);
  assert.ok(p.x<3.7);assert.ok(phys.waiting);near(p.y,1+EYE_HEIGHT);
});
