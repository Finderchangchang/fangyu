import { chunkKey, HEIGHT, MIN_Y, TYPES } from './world-core.js';

// A room join should never be able to ask IndexedDB for an unbounded amount of
// data.  Keep the default reasonably small for a mobile device, while allowing
// callers to opt into a larger (but still bounded) snapshot when needed.
const DEFAULT_EDIT_LIMIT = 5000;
const MAX_EDIT_LIMIT = 50000;

const editLimit = value => {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_EDIT_LIMIT;
  return Math.max(0, Math.min(MAX_EDIT_LIMIT, Math.floor(number)));
};

const editBlock = value => {
  // `null` is the persisted representation for a mined/removed block.
  if (value == null) return null;
  if (typeof value === 'string' && TYPES.includes(value)) return value;
  // Be liberal with old snapshots that may have persisted a numeric block id.
  if (Number.isSafeInteger(value) && value >= 0 && value < TYPES.length) return TYPES[value] || null;
  return undefined;
};

const complete = tx => new Promise((resolve, reject) => {
  tx.oncomplete = resolve;
  tx.onerror = tx.onabort = () => reject(tx.error || Error('存档事务失败'));
});
const result = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export class WorldStore {
  async open() {
    const request = indexedDB.open('block-isle-worlds', 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('chunks')) request.result.createObjectStore('chunks');
      if (!request.result.objectStoreNames.contains('worlds')) request.result.createObjectStore('worlds', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('profiles')) request.result.createObjectStore('profiles');
    };
    this.db = await result(request);
    return this;
  }
  async active() {
    const active = localStorage.getItem('block-isle-active-v2');
    if (active) {
      const tx = this.db.transaction('worlds');
      const world = await result(tx.objectStore('worlds').get(active));
      if (world) return world;
      throw Error('找不到当前世界存档');
    }
    const seed = Number(localStorage.getItem('block-isle-seed')) || Math.floor(Math.random() * 900000 + 100000);
    const id = `legacy-${seed}`;
    const previous = await result(this.db.transaction('worlds').objectStore('worlds').get(id));
    if (previous) { localStorage.setItem('block-isle-active-v2', id); return previous; }
    const raw = localStorage.getItem('block-isle-edits') || '{}';
    const edits = JSON.parse(raw);
    const grouped = new Map();
    for (const [key, type] of Object.entries(edits)) {
      const [x, , z] = key.split(',').map(Number), chunk = chunkKey(x, z);
      if (!grouped.has(chunk)) grouped.set(chunk, {});
      grouped.get(chunk)[key] = type;
    }
    const world = { id, seed, version: 2, created: Date.now(), legacyBackup: raw };
    const tx = this.db.transaction(['worlds', 'chunks'], 'readwrite');
    const done = complete(tx);
    tx.objectStore('worlds').put(world);
    for (const [key, values] of grouped) tx.objectStore('chunks').put(values, `${id}/${key}`);
    await done; // Migration marker and all chunks commit atomically; leave legacy keys intact.
    localStorage.setItem('block-isle-active-v2', id);
    return world;
  }
  async activeFor(playerName) {
    const safe = String(playerName || '').trim().slice(0, 16);
    if (!safe) return this.active();
    const key = `block-isle-active-v2:${safe}`;
    const assigned = localStorage.getItem(key);
    const owner = localStorage.getItem('block-isle-owner-v2');
    const ownerWorldId = localStorage.getItem('block-isle-owner-world-v2');
    if (assigned && !(owner && owner !== safe && ownerWorldId && assigned === ownerWorldId)) {
      const world = await result(this.db.transaction('worlds').objectStore('worlds').get(assigned));
      if (world && (!world.owner || world.owner === safe)) { this.rememberWorld(safe, world.id); return world; }
      if (!world) throw Error('上次选择的岛屿无法读取，未创建替代地图');
    }
    // Preserve the pre-login world for the first account, then isolate every later account.
    let world;
    if (!owner) {
      world = await this.active();
      localStorage.setItem('block-isle-owner-v2', safe);
      localStorage.setItem('block-isle-owner-world-v2', world.id);
    } else if (owner === safe && ownerWorldId) {
      world = await result(this.db.transaction('worlds').objectStore('worlds').get(ownerWorldId));
      if (!world) world = await this.create(safe);
    } else {
      world = await this.create(safe);
    }
    localStorage.setItem(key, world.id);
    this.rememberWorld(safe, world.id);
    return world;
  }
  rememberWorld(playerName, id) {
    const key = `block-isle-world-list:${playerName}`;
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    if (!list.includes(id)) { list.push(id); localStorage.setItem(key, JSON.stringify(list)); }
  }
  async listFor(playerName) {
    const safe = String(playerName || '').trim().slice(0, 16);
    if (!safe) return [];
    const ids = new Set(JSON.parse(localStorage.getItem(`block-isle-world-list:${safe}`) || '[]'));
    ids.add(localStorage.getItem(`block-isle-active-v2:${safe}`));
    if (localStorage.getItem('block-isle-owner-v2') === safe) ids.add(localStorage.getItem('block-isle-owner-world-v2'));
    const all = await result(this.db.transaction('worlds').objectStore('worlds').getAll());
    return all.filter(world => !world.sharedRoom && (world.owner === safe || (!world.owner && ids.has(world.id))))
      .sort((a, b) => a.created - b.created);
  }
  async selectFor(playerName, world) {
    const safe = String(playerName || '').trim().slice(0, 16);
    if (!safe || (world.owner && world.owner !== safe) || world.sharedRoom) throw Error('不能选择其他玩家的岛屿');
    const updated = { ...world, owner: safe, lastPlayed: Date.now() };
    const tx = this.db.transaction('worlds', 'readwrite'), done = complete(tx);
    tx.objectStore('worlds').put(updated);
    await done;
    this.rememberWorld(safe, world.id);
    localStorage.setItem(`block-isle-active-v2:${safe}`, world.id);
    return updated;
  }
  async rename(id, name) {
    const tx = this.db.transaction('worlds', 'readwrite'), done = complete(tx);
    const world = await result(tx.objectStore('worlds').get(id));
    if (!world) return false;
    world.name = String(name || '').trim().slice(0, 24) || '未命名地图'; tx.objectStore('worlds').put(world); await done; return world;
  }
  async create(playerName, name = '') {
    const owner = String(playerName || '').trim().slice(0, 16);
    if (!owner) throw Error('请先登录再新建岛屿');
    const id = globalThis.crypto?.randomUUID ? crypto.randomUUID() : `world-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const world = { id, owner, name: String(name).trim().slice(0, 24) || '新的岛屿', seed: Math.floor(Math.random() * 900000 + 100000), version: 2, created: Date.now() };
    const tx = this.db.transaction('worlds', 'readwrite'), done = complete(tx);
    tx.objectStore('worlds').put(world);
    await done;
    localStorage.setItem(`block-isle-active-v2:${owner}`, world.id);
    this.rememberWorld(owner, world.id);
    return world;
  }
  async read(id, key) {
    return await result(this.db.transaction('chunks').objectStore('chunks').get(`${id}/${key}`)) || {};
  }
  /**
   * Read a bounded, flattened snapshot of all edits belonging to a world.
   *
   * Chunk records are stored under `${worldId}/${chunkKey}` and contain an
   * object keyed by `x,y,z`.  A cursor keeps the operation incremental, so a
   * large world does not have to be materialised with `getAll()` before the
   * caller's limit can be applied.  Invalid records are ignored rather than
   * allowing corrupt/legacy data to enter a room snapshot.
   */
  async readAllEdits(id, limit = DEFAULT_EDIT_LIMIT) {
    if (!this.db) throw Error('存档尚未打开');
    const worldId = String(id ?? '').trim();
    const max = editLimit(limit);
    // World ids are part of the key prefix.  Reject separators so a caller
    // cannot accidentally read another world's records.
    if (!worldId || worldId.includes('/') || max === 0) return [];

    const prefix = `${worldId}/`;
    const tx = this.db.transaction('chunks', 'readonly');
    const objectStore = tx.objectStore('chunks');
    // IDBKeyRange is available in browsers, but keeping a cursor fallback
    // makes the method usable with small IndexedDB test shims as well.
    const range = globalThis.IDBKeyRange?.bound(prefix, `${prefix}\uffff`);

    return await new Promise((resolve, reject) => {
      const edits = [];
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error || Error('读取改造记录失败'));
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(edits);
      };
      const stopAtLimit = () => {
        if (settled) return;
        settled = true;
        resolve(edits);
        // Abort the read transaction once enough records have been copied;
        // this prevents scanning the rest of a potentially very large world.
        try { tx.abort(); } catch { /* transaction may already be complete */ }
      };

      tx.onerror = () => fail(tx.error || Error('读取改造记录失败'));
      tx.onabort = () => { if (!settled) fail(tx.error || Error('读取改造记录失败')); };
      let request;
      try {
        request = range ? objectStore.openCursor(range) : objectStore.openCursor();
      } catch (error) {
        fail(error);
        return;
      }
      request.onerror = () => fail(request.error || Error('读取改造记录失败'));
      request.onsuccess = () => {
        if (settled) return;
        try {
          const cursor = request.result;
          if (!cursor) { finish(); return; }
          const recordKey = String(cursor.key ?? '');
          if (recordKey.startsWith(prefix)) {
            const values = cursor.value;
            if (values && typeof values === 'object' && !Array.isArray(values)) {
              // `for…in` avoids allocating another array for a chunk that has
              // more edits than the caller's limit; only own keys are data.
              for (const coordinate in values) {
                if (!Object.prototype.hasOwnProperty.call(values, coordinate)) continue;
                if (edits.length >= max) { stopAtLimit(); return; }
                const parts = String(coordinate).split(',');
                if (parts.length !== 3) continue;
                if (!parts.every(part => /^[-+]?\d+$/.test(part.trim()))) continue;
                const [x, y, z] = parts.map(Number);
                if (![x, y, z].every(Number.isSafeInteger) || y <= MIN_Y || y >= HEIGHT) continue;
                const block = editBlock(values[coordinate]);
                if (block === undefined) continue;
                edits.push({ x, y, z, block });
                if (edits.length >= max) { stopAtLimit(); return; }
              }
            }
          }
          cursor.continue();
        } catch (error) {
          fail(error);
        }
      };
    });
  }
  async write(id, key, edits) {
    const tx = this.db.transaction('chunks', 'readwrite'), done = complete(tx);
    tx.objectStore('chunks').put(edits, `${id}/${key}`);
    await done;
  }
  async readProfile(id, playerName) {
    const key = `${id}/${playerName}`;
    const saved = await result(this.db.transaction('profiles').objectStore('profiles').get(key));
    if (saved) return saved;
    // Older clients wrote all profiles under an undefined world id. Preserve
    // that backup and recover only into the original owner's original island.
    if (localStorage.getItem('block-isle-owner-v2') === playerName && localStorage.getItem('block-isle-owner-world-v2') === id) {
      const legacy = await result(this.db.transaction('profiles').objectStore('profiles').get(`undefined/${playerName}`));
      if (legacy) { await this.writeProfile(id, playerName, legacy); return legacy; }
    }
    return { inventory: {} };
  }
  async writeProfile(id, playerName, profile) {
    const tx = this.db.transaction('profiles', 'readwrite'), done = complete(tx);
    tx.objectStore('profiles').put(profile, `${id}/${playerName}`);
    await done;
  }
}
