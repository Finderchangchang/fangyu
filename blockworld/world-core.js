export const SIZE = 16;
export const HEIGHT = 100; // Exclusive block coordinate; top surface reaches Y=100.
export const MIN_Y = -256;
export const WORLD_LAYERS = HEIGHT - MIN_Y;
export const WATER = 4;
export const TYPES = [null, 'grass', 'dirt', 'stone', 'wood', 'leaves', 'sand', 'cotton', 'bed'];
export const chunkKey = (x, z) => `${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`;
export const blockKey = (x, y, z) => `${x},${y},${z}`;
export const indexOf = (x, y, z) => (y - MIN_Y) * SIZE * SIZE + ((z % SIZE + SIZE) % SIZE) * SIZE + ((x % SIZE + SIZE) % SIZE);

// The horizontal basis comes from the camera's world direction, never Euler yaw.
export function movement(direction, lastForward, forward, side) {
  const horizontal = Math.hypot(direction.x, direction.z);
  if (horizontal > 0.0001) {
    lastForward.x = direction.x / horizontal;
    lastForward.z = direction.z / horizontal;
  }
  const length = Math.max(1, Math.hypot(forward, side));
  return { x: (lastForward.x * forward - lastForward.z * side) / length,
    z: (lastForward.z * forward + lastForward.x * side) / length };
}

export class Terrain {
  constructor(seed) {
    this.seed = seed;
    this.legacy = new Map();
    // Preserve even the original tree/terrain overwrite order, including air.
    for (let x = -19; x < 19; x++) for (let z = -19; z < 19; z++) {
      const h = this.oldHeight(x, z);
      for (let y = 0; y <= h; y++) this.legacy.set(blockKey(x, y, z), this.groundType(h, y));
      if (h > 5 && this.hash(x, z, 9) > .94 && Math.abs(x) > 3)
        this.tree(x, h + 1, z, (a, b, c, id) => this.legacy.set(blockKey(a, b, c), id));
    }
  }
  hash(x, z, salt = 0) {
    let n = Math.imul(x + this.seed + salt * 73, 374761393) + Math.imul(z - this.seed, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  noise(x, z, scale, salt) {
    const gx = Math.floor(x / scale), gz = Math.floor(z / scale);
    const smooth = v => v * v * (3 - 2 * v);
    const tx = smooth(x / scale - gx), tz = smooth(z / scale - gz);
    const a = this.hash(gx, gz, salt), b = this.hash(gx + 1, gz, salt);
    const c = this.hash(gx, gz + 1, salt), d = this.hash(gx + 1, gz + 1, salt);
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }
  oldHeight(x, z) {
    const island = Math.max(0, 1 - Math.pow(Math.hypot(x, z) / (19 * 1.05), 3.4));
    return Math.max(2, Math.floor(2.4 + island * 5.6 + (this.noise(x, z, 8, 1) * 3.3 + this.noise(x, z, 3, 2) * 1.25) * island));
  }
  height(x, z) {
    if (Math.max(Math.abs(x), Math.abs(z)) <= 21) return this.oldHeight(x, z);
    const t = Math.min(1, (Math.max(Math.abs(x), Math.abs(z)) - 21) / 22);
    const h = 1 + this.noise(x, z, 64, 40) * 11 + this.noise(x, z, 13, 41) * 6;
    return Math.max(2, Math.floor(2 + (h - 2) * t * t * (3 - 2 * t)));
  }
  groundType(h, y) { return y === h ? (h <= 5 ? 6 : 1) : y > h - 3 ? (h <= 5 ? 6 : 2) : 3; }
  tree(x, y, z, put) {
    const h = 3 + Math.floor(this.hash(x, z, 12) * 2);
    for (let i = 0; i < h; i++) put(x, y + i, z, 4);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) {
      if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy) < 4 && !(dx === 0 && dz === 0 && dy < 1)) put(x + dx, y + h - 1 + dy, z + dz, 5);
    }
    put(x, y + h + 1, z, 5);
  }
  *generate(cx, cz, edits = {}) {
    const data = new Uint8Array(SIZE * SIZE * WORLD_LAYERS);
    const ox = cx * SIZE, oz = cz * SIZE;
    const put = (x, y, z, id) => {
      if (x >= ox && x < ox + SIZE && z >= oz && z < oz + SIZE && y >= MIN_Y && y < HEIGHT) data[indexOf(x, y, z)] = id;
    };
    for (let x = ox; x < ox + SIZE; x++) {
      for (let z = oz; z < oz + SIZE; z++) {
        const h = this.height(x, z);
        for (let y = MIN_Y; y < 0; y++) put(x, y, z, 3);
        for (let y = 0; y <= h; y++) put(x, y, z, this.groundType(h, y));
        yield;
      }
      yield;
    }
    // Two-cell halo makes trees identical regardless of chunk generation order.
    for (let x = ox - 2; x < ox + SIZE + 2; x++) {
      for (let z = oz - 2; z < oz + SIZE + 2; z++) {
        const h = this.height(x, z);
        if (Math.max(Math.abs(x), Math.abs(z)) > 23 && h > 5 && this.hash(x, z, 9) > .96)
          this.tree(x, h + 1, z, put);
      }
      yield;
    }
    for (let x = Math.max(-21, ox); x < Math.min(21, ox + SIZE); x++) {
      for (let z = Math.max(-21, oz); z < Math.min(21, oz + SIZE); z++) {
        // Outside the original square, retain the new seabed plus old overhanging trees.
        for (let y = 0; y < HEIGHT; y++) {
          const old = this.legacy.get(blockKey(x, y, z));
          if ((x >= -19 && x < 19 && z >= -19 && z < 19) || old) put(x, y, z, old || 0);
        }
      }
      yield;
    }
    // New cotton grows only outside the preserved original island; edits win below.
    for(let x=ox;x<ox+SIZE;x++)for(let z=oz;z<oz+SIZE;z++){
      const h=this.height(x,z);
      if(Math.max(Math.abs(x),Math.abs(z))>23&&h>5&&this.hash(x,z,177)>.96&&data[indexOf(x,h+1,z)]===0)put(x,h+1,z,7);
    }
    for (const [key, type] of Object.entries(edits)) {
      const [x, y, z] = key.split(',').map(Number);
      if (y <= MIN_Y) continue;
      put(x, y, z, TYPES.indexOf(type) > 0 ? TYPES.indexOf(type) : 0);
    }
    return data;
  }
}

// Amanatides–Woo voxel traversal, bounded by interaction reach, not world size.
export function trace(origin, direction, getBlock, isLoaded, reach = 7) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const axes = ['x', 'y', 'z'];
  const cell = { x, y, z }, step = {}, delta = {}, next = {};
  for (const a of axes) {
    step[a] = Math.sign(direction[a]);
    delta[a] = direction[a] ? Math.abs(1 / direction[a]) : Infinity;
    next[a] = direction[a] ? ((step[a] > 0 ? cell[a] + 1 : cell[a]) - origin[a]) / direction[a] : Infinity;
  }
  let distance = 0, normal = { x: 0, y: 0, z: 0 };
  while (distance <= reach) {
    if (!isLoaded(cell.x, cell.z)) return null;
    const type = getBlock(cell.x, cell.y, cell.z);
    if (type) return { ...cell, type, normal, distance };
    const a = next.x <= next.y && next.x <= next.z ? 'x' : next.y <= next.z ? 'y' : 'z';
    distance = next[a]; next[a] += delta[a]; cell[a] += step[a];
    normal = { x: 0, y: 0, z: 0 }; normal[a] = -step[a];
  }
  return null;
}
