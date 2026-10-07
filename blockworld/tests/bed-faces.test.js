import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three/three.module.js';
import * as core from '../world-core.js';
const source=fs.readFileSync(new URL('../chunks.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export class ChunkWorld','class ChunkWorld')+'\nthis.ChunkWorld=ChunkWorld;';
const context={THREE,...core};vm.createContext(context);vm.runInContext(source,context);
const {ChunkWorld}=context;
function buildWithNeighbor(x,neighbor){
  const world=new ChunkWorld(new THREE.Scene(),{}, {seed:123},core.TYPES.slice(1).map(()=>({color:0xaaaaaa})),()=>{});
  const data=new Uint8Array(core.SIZE*core.SIZE*core.WORLD_LAYERS);data[core.indexOf(x,3,5)]=3;
  const chunk={key:'0,0',cx:0,cz:0,data};world.chunks.set('0,0',chunk);
  if(x===15){const other=new Uint8Array(data.length);other[core.indexOf(16,3,5)]=neighbor;world.chunks.set('1,0',{data:other});}
  else data[core.indexOf(x+1,3,5)]=neighbor;
  for(const step of world.build(chunk)){}
  const geometry=chunk.mesh.geometry,p=geometry.attributes.position,n=geometry.attributes.normal;let faceVertices=0;
  for(let i=0;i<p.count;i++)if(p.getX(i)===x+1&&n.getX(i)===1&&p.getY(i)>=3&&p.getY(i)<=4&&p.getZ(i)>=5&&p.getZ(i)<=6)faceVertices++;
  world.dispose();return faceVertices;
}
test('bed does not hide adjacent stone face, within chunk or across boundary',()=>{
  for(const x of [4,15]){assert.equal(buildWithNeighbor(x,8),4);assert.equal(buildWithNeighbor(x,3),0);assert.equal(buildWithNeighbor(x,0),4);}
});
