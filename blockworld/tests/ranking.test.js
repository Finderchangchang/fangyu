import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const {SurvivalRanking,DAY_MS}=createRequire(import.meta.url)('../../blockworld-ranking.cjs');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'isle-ranking-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'ranking.json');let now=0;
  const ranking=new SurvivalRanking(file,()=>now);
  return {ranking,file,advance:ms=>now+=ms};
}
test('ranking sorts days descending, ties share rank and persistence survives restart',t=>{
  const {ranking,file,advance}=fixture(t);
  ranking.pulse('小甲','a',true);ranking.pulse('小乙','b',true);
  for(let i=0;i<DAY_MS/10000;i++){advance(10000);ranking.pulse('小甲','a',true);ranking.pulse('小乙','b',true);}
  ranking.pulse('小乙','b',false);
  for(let i=0;i<DAY_MS/10000;i++){advance(10000);ranking.pulse('小甲','a',true);}
  ranking.pulse('小丙','c',true);
  ranking.pulse('小丁','d',true);
  const board=ranking.board('小甲');
  assert.deepEqual(board.rows.map(r=>r.days),[2,1,0,0]);assert.deepEqual(board.rows.map(r=>r.rank),[1,2,3,3]);
  assert.equal(board.me.name,'小甲');assert.deepEqual(new SurvivalRanking(file).board('小甲'),board);
});
test('pause/offline do not accumulate; concurrent clients do not multiply time',t=>{
  const {ranking,advance}=fixture(t);
  ranking.pulse('玩家','a',true);ranking.pulse('玩家','b',true);
  advance(10000);ranking.pulse('玩家','a',true);ranking.pulse('玩家','b',true);
  assert.equal(ranking.totals.get('玩家'),10000);
  ranking.pulse('玩家','a',false);ranking.pulse('玩家','b',false);
  advance(DAY_MS);ranking.pulse('玩家','a',true);assert.equal(ranking.totals.get('玩家'),10000);
  advance(DAY_MS);ranking.pulse('玩家','a',true);assert.equal(ranking.totals.get('玩家'),10000);
});
test('pagination retains global ranks and own position',t=>{
  const {ranking}=fixture(t);for(let i=0;i<105;i++)ranking.pulse(`玩家${i}`,'client',false);
  const result=ranking.board('玩家104',3);assert.equal(result.rows.length,5);assert.equal(result.total,105);assert.equal(result.me.rank,1);
});
test('damaged journal records are retained without losing valid scores or future writes',t=>{
  const {file}=fixture(t);
  const original='{"name":"玩家","total":1440000}\n{"name":"玩家","total":10}\n{"name":';
  fs.writeFileSync(file,original);
  const ranking=new SurvivalRanking(file,()=>0);
  assert.equal(ranking.damagedRecords,1);assert.equal(ranking.board('玩家').me.days,1);
  ranking.pulse('新人','a',true);
  assert.ok(fs.readFileSync(file,'utf8').startsWith(original));
  const restored=new SurvivalRanking(file);assert.equal(restored.board('新人').total,2);assert.equal(restored.board('玩家').me.days,1);
});
test('failed persistence does not advance the live session or discard accrued time',t=>{
  const {ranking,file,advance}=fixture(t);
  ranking.pulse('玩家','a',true);advance(10000);
  ranking.file=path.dirname(file);assert.throws(()=>ranking.pulse('玩家','a',false));
  assert.equal(ranking.sessions.get('玩家').at,0);assert.equal(ranking.totals.get('玩家'),0);
  ranking.file=file;ranking.pulse('玩家','a',false);assert.equal(ranking.totals.get('玩家'),10000);
});
