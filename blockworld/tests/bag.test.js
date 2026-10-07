import test from 'node:test';
import assert from 'node:assert/strict';
import {bagLayout,bagSlotCount,canCollect,nextMorning} from '../bag.js';
import {Terrain,TYPES,indexOf} from '../world-core.js';
test('hotbar keeps 100, overflow stacks have no bag slot cap',()=>{
  assert.deepEqual(bagLayout({stone:201},['stone']),[{id:'stone',count:100},{id:'stone',count:1}]);
  assert.equal(canCollect({stone:2099},['stone'],'stone'),true);
  assert.equal(canCollect({stone:2100},['stone'],'stone'),true);
  assert.equal(bagLayout({stone:2101},['stone']).length,21); // Preserve legacy overflow.
});
test('new items, food and tools remain collectable beyond old capacity',()=>{
  const bar=['grass','dirt','stone','wood','leaves','sand'];
  assert.deepEqual(bagLayout({cotton:3,bed:1},bar),[{id:'cotton',count:3},{id:'bed',count:1}]);
  assert.equal(canCollect({beef:1900},[], 'mutton',['sword']),true);
  assert.equal(canCollect({beef:1899},[], 'beef',['sword']),true);
});
test('large inventories render bounded pages without dropping items',()=>{
  const inventory={stone:1000001,wood:253},tools=['sword'];
  assert.equal(bagSlotCount(inventory,['stone'],tools),10004);
  assert.equal(bagLayout(inventory,['stone'],tools,{offset:0,limit:80}).length,80);
  assert.deepEqual(bagLayout(inventory,['stone'],tools,{offset:10000,limit:80}),[{id:'stone',count:1},{id:'wood',count:100},{id:'wood',count:100},{id:'wood',count:53}]);
  assert.equal(canCollect(inventory,[],'stone'),true);
  assert.deepEqual(bagLayout({stone:Infinity},[]),[]);
});
test('sleep at 18:00 or 23:00 skips to next morning; after midnight stays in that morning',()=>{
  for(const [input,expected] of [[18*3600,86400+8*3600],[23*3600,86400+8*3600],[86400+2*3600,86400+8*3600]])assert.equal(nextMorning(input),expected);
});
test('cotton is deterministic on grass away from preserved island, and mined cotton stays removed',()=>{
  const terrain=new Terrain(12345);let found;
  for(let x=24;x<150&&!found;x++)for(let z=24;z<150&&!found;z++)if(terrain.height(x,z)>5&&terrain.hash(x,z,177)>.96){
    const cx=Math.floor(x/16),cz=Math.floor(z/16),gen=terrain.generate(cx,cz);let result;do{result=gen.next();}while(!result.done);
    const y=terrain.height(x,z)+1;if(result.value[indexOf(x,y,z)]===7)found={x,y,z,cx,cz};
  }
  assert.ok(found);const {x,y,z,cx,cz}=found;let result;const gen=terrain.generate(cx,cz,{[`${x},${y},${z}`]:null});do{result=gen.next();}while(!result.done);assert.equal(result.value[indexOf(x,y,z)],0);
  assert.equal(TYPES[7],'cotton');assert.equal(TYPES[8],'bed');assert.equal(TYPES[3],'stone');
});
