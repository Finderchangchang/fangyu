import * as THREE from 'three';
import { SIZE, HEIGHT, MIN_Y, TYPES, Terrain, indexOf, chunkKey, blockKey } from './world-core.js';

// Corners are counter-clockwise as seen from outside each face.
const FACES = [
  [[1,0,0], [[1,0,1],[1,0,0],[1,1,0],[1,1,1]]],
  [[-1,0,0], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]]],
  [[0,1,0], [[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],
  [[0,-1,0], [[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],
  [[0,0,1], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]]],
  [[0,0,-1], [[1,0,0],[0,0,0],[0,1,0],[1,1,0]]]
];
const NEIGHBORS = [[1,0],[-1,0],[0,1],[0,-1]];

export class ChunkWorld {
  get id() { return this.info.id; }
  constructor(scene, store, info, blocks, notify) {
    this.scene = scene; this.store = store; this.info = info; this.notify = notify;
    this.terrain = new Terrain(info.seed);
    this.chunks = new Map(); this.center = null; this.disposed = false;
    this.colors = [null, ...blocks.map(b => new THREE.Color(b.color))];
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 });
    this.lastBudgetMs = 0;
  }
  loaded(x, z) { return !!this.chunks.get(chunkKey(x, z))?.ready; }
  block(x, y, z) {
    if (y < MIN_Y || y >= HEIGHT) return 0;
    return this.chunks.get(chunkKey(x, z))?.data?.[indexOf(x, y, z)] || 0;
  }
  near(cx, cz) { return Math.max(Math.abs(cx - this.center.x), Math.abs(cz - this.center.z)); }
  updateCenter(x, z) {
    const cx = Math.floor(x / SIZE), cz = Math.floor(z / SIZE);
    if (this.center?.x === cx && this.center?.z === cz) return;
    this.center = { x: cx, z: cz };
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) this.request(cx + dx, cz + dz);
    this.evict();
  }
  request(cx, cz) {
    const key = `${cx},${cz}`;
    if (this.chunks.has(key)) return;
    const chunk = { key, cx, cz, ready: false, dirty: false, revision: 0, saved: 0, edits: {}, data: null };
    this.chunks.set(key, chunk);
    this.store.read(this.info.id, key).then(edits => {
      if (this.disposed || this.chunks.get(key) !== chunk) return;
      chunk.edits = edits;
      chunk.generator = this.terrain.generate(cx, cz, edits);
    }).catch(error => { chunk.error = error; this.notify('地形存档读取失败，请刷新重试'); });
  }
  evict() {
    for (const chunk of this.chunks.values()) {
      if (this.near(chunk.cx, chunk.cz) <= 5 || chunk.revision !== chunk.saved || chunk.saving) continue;
      this.removeMesh(chunk); this.chunks.delete(chunk.key);
      this.invalidateNeighbors(chunk);
    }
  }
  removeMesh(chunk) {
    if (chunk.mesh) { this.scene.remove(chunk.mesh); chunk.mesh.geometry.dispose(); chunk.mesh = null; }
  }
  invalidate(chunk) { if (chunk?.data) { chunk.dirty = true; chunk.builder = null; } }
  invalidateNeighbors(chunk) {
    for (const [dx,dz] of NEIGHBORS) this.invalidate(this.chunks.get(`${chunk.cx + dx},${chunk.cz + dz}`));
  }
  tick(budget = 4) {
    const start = performance.now();
    // Reserve headroom for the final non-preemptible geometry/typed-array step.
    const workBudget = Math.max(.25, budget - .75);
    const jobs = [...this.chunks.values()].filter(c => c.generator || c.dirty)
      .sort((a,b) => this.near(a.cx,a.cz) - this.near(b.cx,b.cz) || Number(b.ready) - Number(a.ready));
    for (const chunk of jobs) {
      while (performance.now() - start < workBudget) {
        if (chunk.generator) {
          const step = chunk.generator.next();
          if (!step.done) continue;
          chunk.data = step.value; chunk.generator = null;
          this.invalidate(chunk); this.invalidateNeighbors(chunk);
        }
        if (chunk.dirty) {
          chunk.builder ||= this.build(chunk);
          if (!chunk.builder.next().done) continue;
          chunk.builder = null; chunk.dirty = false; chunk.ready = true;
        }
        break;
      }
      if (performance.now() - start >= workBudget) break;
    }
    this.lastBudgetMs = performance.now() - start;
  }
  *build(chunk) {
    const positions = [], normals = [], colors = [], indices = [];
    const ox = chunk.cx * SIZE, oz = chunk.cz * SIZE;
    for (let lx = 0; lx < SIZE; lx++) {
      for (let lz = 0; lz < SIZE; lz++) {
       for (let y = MIN_Y; y < HEIGHT; y++) {
        const x = ox + lx, z = oz + lz, id = chunk.data[indexOf(x, y, z)];
        if (!id) continue;
        if(id===8){
          // One-cell bed: wooden frame, red mattress and a white pillow.
          for(const [a,b,rgb] of [[[0,.05,0],[1,.25,1],[.40,.24,.12]],[[0,.25,0],[1,.48,1],[.73,.20,.24]],[[.08,.48,.68],[.92,.62,.95],[.96,.94,.86]]]){
            for(const [n,corners] of FACES){const base=positions.length/3;for(const p of corners){positions.push(lx+a[0]+p[0]*(b[0]-a[0]),y+a[1]+p[1]*(b[1]-a[1]),lz+a[2]+p[2]*(b[2]-a[2]));normals.push(...n);colors.push(...rgb);}indices.push(base,base+1,base+2,base,base+2,base+3);}
          }
          continue;
        }
        const shade = .88 + this.terrain.hash(x, z, y + 30) * .18, color = this.colors[id];
        for (const [n, corners] of FACES) {
          if (y === MIN_Y && n[1] === -1) continue;
          const nx = lx + n[0], ny = y + n[1], nz = lz + n[2];
          const neighbor = ny < MIN_Y || ny >= HEIGHT ? 0 :
            nx >= 0 && nx < SIZE && nz >= 0 && nz < SIZE ? chunk.data[indexOf(nx, ny, nz)] :
            (!this.chunks.get(chunkKey(x + n[0], z + n[2]))?.data && ny < 0) ? 3 : this.block(x + n[0], ny, z + n[2]);
          // A bed is a partial-height model, so it cannot hide a whole face.
          if (neighbor && neighbor !== TYPES.indexOf('bed')) continue;
          const base = positions.length / 3;
          for (const p of corners) {
            positions.push(lx + p[0], y + p[1], lz + p[2]); normals.push(...n);
            colors.push(color.r * shade, color.g * shade, color.b * shade);
          }
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
       }
       // Smaller work units keep even tree-heavy columns within the frame budget.
       yield;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(ox, 0, oz); mesh.receiveShadow = true; mesh.castShadow = true;
    this.removeMesh(chunk); chunk.mesh = mesh; this.scene.add(mesh);
  }
  edit(x, y, z, type) {
    const chunk = this.chunks.get(chunkKey(x, z));
    if (!chunk?.ready || y <= MIN_Y || y >= HEIGHT) return false;
    const id = TYPES.indexOf(type);
    chunk.data[indexOf(x, y, z)] = Math.max(0, id);
    chunk.edits[blockKey(x, y, z)] = type;
    chunk.revision++;
    this.invalidate(chunk);
    const lx = (x % SIZE + SIZE) % SIZE, lz = (z % SIZE + SIZE) % SIZE;
    for (const [dx,dz] of NEIGHBORS) {
      if ((dx === -1 && lx === 0) || (dx === 1 && lx === 15) || (dz === -1 && lz === 0) || (dz === 1 && lz === 15))
        this.invalidate(this.chunks.get(`${chunk.cx + dx},${chunk.cz + dz}`));
    }
    // Persist immediately; serialize snapshots so an older write cannot win a race.
    this.saveChunk(chunk).catch(() => this.notify('保存失败，改造仍保留在内存中，请点击保存世界重试'));
    return true;
  }
  async saveChunk(chunk) {
    if (chunk.saving) return chunk.saving;
    chunk.saving = (async () => {
      while (chunk.saved !== chunk.revision) {
        const revision = chunk.revision;
        await this.store.write(this.info.id, chunk.key, { ...chunk.edits });
        chunk.saved = revision;
      }
    })();
    try { await chunk.saving; } finally { chunk.saving = null; }
    this.evict();
  }
  async flush() { await Promise.all([...this.chunks.values()].map(c => this.saveChunk(c))); }
  dispose() {
    this.disposed = true;
    for (const chunk of this.chunks.values()) this.removeMesh(chunk);
    this.chunks.clear(); this.material.dispose();
  }
}
