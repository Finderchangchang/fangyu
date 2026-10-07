import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const {Diagnostics,reason}=createRequire(import.meta.url)('../../blockworld-diagnostics.cjs');
test('diagnostics only retain safe metadata, classify save rejection and rotate',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fangyu-log-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const log=new Diagnostics(dir);log.record({requestId:'test',status:500,operation:'write',reason:'INVALID_BLOCK',password:'secret',token:'secret-token',name:'person',body:{token:'secret'}});
  const entry=JSON.parse(fs.readFileSync(log.file,'utf8'));assert.equal(entry.reason,'INVALID_BLOCK');assert.equal(entry.password,undefined);assert.equal(entry.name,undefined);assert.equal(entry.body,undefined);assert.equal(entry.token,undefined);
  assert.equal(reason(Error('无效方块')),'INVALID_BLOCK');assert.equal(reason(Error('未知云存档操作')),'UNSUPPORTED_OPERATION');
  fs.writeFileSync(log.file,'x'.repeat(1024*1024+1));log.record({reason:'SERVER_ERROR'});assert.ok(fs.existsSync(log.file+'.previous'));assert.ok(fs.statSync(log.file).size<1024);
});
