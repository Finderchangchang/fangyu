import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldStore } from '../storage.js';

// Small asynchronous IDB-shaped fixture; production still uses browser IDB.
function fixture() {
  const local = new Map();
  globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)) };
  const tables = { worlds: new Map(), chunks: new Map(), profiles: new Map() };
  const store = new WorldStore();
  store.db = { transaction() {
    let pending = 0;
    const tx = { objectStore(name) {
      function request(operation) {
        const req = {}; pending++;
        setImmediate(() => {
          req.result = structuredClone(operation()); req.onsuccess?.(); pending--;
          setImmediate(() => { if (!pending) tx.oncomplete?.(); });
        });
        return req;
      }
      return {
        get: key => request(() => tables[name].get(key)),
        getAll: () => request(() => [...tables[name].values()]),
        put: (value, key = value.id) => request(() => { tables[name].set(key, structuredClone(value)); return key; })
      };
    } };
    return tx;
  } };
  return { store, local, tables };
}

test('two islands survive switching and relogin without mixing edits or inventories', async () => {
  const { store } = fixture();
  const first = await store.create('test-player', '第一个岛屿');
  await store.write(first.id, '0,0', { '1,2,3': null });
  await store.writeProfile(first.id, 'test-player', { inventory: { dirt: 10 }, hasWorkbench: true });
  const second = await store.create('test-player', '第二个岛屿');
  assert.deepEqual(await store.read(second.id, '0,0'), {});
  assert.deepEqual(await store.readProfile(second.id, 'test-player'), { inventory: {} });
  await store.selectFor('test-player', first);
  assert.equal((await store.activeFor('test-player')).id, first.id);
  assert.equal((await store.readProfile(first.id, 'test-player')).hasWorkbench, true);
  assert.deepEqual(await store.read(first.id, '0,0'), { '1,2,3': null });
  assert.equal((await store.listFor('test-player')).length, 2);
});

test('new islands belong to the logged-in player, not the first account', async () => {
  const { store, local } = fixture();
  local.set('block-isle-owner-v2', 'first');
  const first = await store.create('first');
  const second = await store.create('second');
  assert.deepEqual((await store.listFor('first')).map(w => w.id), [first.id]);
  assert.deepEqual((await store.listFor('second')).map(w => w.id), [second.id]);
  await assert.rejects(store.selectFor('second', first));
});

test('legacy active island missing from lobby index is recovered without deleting anything', async () => {
  const { store, tables, local } = fixture();
  tables.worlds.set('old', { id: 'old', seed: 123, created: 1 });
  local.set('block-isle-active-v2:test-player', 'old');
  assert.equal((await store.listFor('test-player'))[0].id, 'old');
  await store.activeFor('test-player');
  assert.deepEqual(JSON.parse(local.get('block-isle-world-list:test-player')), ['old']);
});

test('old undefined-key profile recovers only into original island and backup is retained', async () => {
  const { store, tables, local } = fixture();
  local.set('block-isle-owner-v2', 'test-player'); local.set('block-isle-owner-world-v2', 'old');
  tables.profiles.set('undefined/test-player', { inventory: { stone: 20 }, hasWorkbench: true });
  assert.equal((await store.readProfile('old', 'test-player')).inventory.stone, 20);
  assert.deepEqual(await store.readProfile('new', 'test-player'), { inventory: {} });
  assert.ok(tables.profiles.has('undefined/test-player'));
  await store.writeProfile('old', 'test-player', { inventory: {} });
  assert.deepEqual(await store.readProfile('old', 'test-player'), { inventory: {} });
});

test('missing selected world does not silently create a replacement', async () => {
  const { store, local, tables } = fixture();
  local.set('block-isle-active-v2:test-player', 'missing');
  await assert.rejects(store.activeFor('test-player'));
  assert.equal(tables.worlds.size, 0);
});
test('health, meat and animal damage persist per island and account', async () => {
  const { store } = fixture();
  const world=await store.create('hunter');
  const profile={inventory:{beef:2,mutton:1},health:45,animals:{'0,0:0':0,'0,0:1':15}};
  await store.writeProfile(world.id,'hunter',profile);
  assert.deepEqual(await store.readProfile(world.id,'hunter'),profile);
  assert.deepEqual(await store.readProfile(world.id,'other'),{inventory:{}});
});
