import test from 'node:test';
import assert from 'node:assert/strict';
import {validPosition,safeResumePosition} from '../player-position.js';
import {Physics,EYE_HEIGHT} from '../physics.js';
const point={x:120.5,y:8+EYE_HEIGHT,z:-200.5,yaw:1.2,pitch:-.4,savedAt:123};
test('saved position validates coordinates and view, rejects invalid saves',()=>{
  assert.ok(validPosition(point));
  for(const p of [null,{}, {...point,x:NaN},{...point,y:-300},{...point,pitch:10},{...point,x:1e9}])assert.equal(validPosition(p),false);
});
test('resume waits for terrain and preserves exact position and orientation',()=>{
  let loaded=false;
  const physics=new Physics({},(x,y,z)=>y===7?1:0,()=>loaded);
  assert.equal(safeResumePosition(point,physics),undefined);
  loaded=true;assert.deepEqual(safeResumePosition(point,physics),point);
});
test('blocked old position moves to supported free space without trapping player',()=>{
  const physics=new Physics({},(x,y,z)=>y<=10?1:0,()=>true);
  const next=safeResumePosition(point,physics);
  assert.equal(next.x,point.x);assert.equal(next.z,point.z);assert.equal(next.y,11+EYE_HEIGHT);assert.equal(physics.collides(next),false);
});
