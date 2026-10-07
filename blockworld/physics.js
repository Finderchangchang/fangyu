export const EYE_HEIGHT = 1.72;
export const RADIUS = .31;
const EPS = .00001;
export class Physics {
  constructor(position, block, loaded) {
    this.position = position; this.block = block; this.loaded = loaded;
    this.velocity = 0; this.grounded = false; this.waiting = false;
    this.pushX=0;this.pushZ=0;
  }
  knockback(x,z){this.pushX=Math.max(-10,Math.min(10,this.pushX+x));this.pushZ=Math.max(-10,Math.min(10,this.pushZ+z));}
  areaLoaded(p) {
    for (const x of [p.x - RADIUS, p.x + RADIUS]) for (const z of [p.z - RADIUS, p.z + RADIUS])
      if (!this.loaded(Math.floor(x), Math.floor(z))) return false;
    return true;
  }
  collides(p) {
    for (let x = Math.floor(p.x - RADIUS + EPS); x <= Math.floor(p.x + RADIUS - EPS); x++)
      for (let z = Math.floor(p.z - RADIUS + EPS); z <= Math.floor(p.z + RADIUS - EPS); z++)
        for (let y = Math.floor(p.y - EYE_HEIGHT + EPS); y <= Math.floor(p.y - EPS); y++)
          if (this.block(x, y, z)) return true;
    return false;
  }
  jump() { if (this.grounded) { this.velocity = 7.5; this.grounded = false; } }
  axis(axis, amount) {
    if (!amount) return;
    const p = this.position, previous = p[axis]; p[axis] += amount;
    if (!this.areaLoaded(p)) { p[axis] = previous; this.waiting = true; return; }
    if (this.collides(p)) p[axis] = previous;
  }
  update(dt, move, speed) {
    this.waiting = false;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120))), step = dt / steps;
    for (let i = 0; i < steps; i++) {
      const p = this.position;
      if (!this.areaLoaded(p)) { this.waiting = true; this.velocity = 0; return; }
      this.axis('x', move.x * speed * step); this.axis('z', move.z * speed * step);
      this.axis('x',this.pushX*step);this.axis('z',this.pushZ*step);
      this.pushX*=Math.exp(-6*step);this.pushZ*=Math.exp(-6*step);
      // Contact probe keeps resting height fixed instead of reapplying gravity.
      this.grounded = this.velocity <= 0 && this.collides({ x: p.x, y: p.y - .001, z: p.z });
      if (this.grounded) { this.velocity = 0; continue; }
      this.velocity = Math.max(-30, this.velocity - 19 * step);
      const oldY = p.y, distance = this.velocity * step; p.y += distance;
      if (!this.collides(p)) continue;
      let free = 0, blocked = 1;
      for (let j = 0; j < 16; j++) {
        const t = (free + blocked) / 2; p.y = oldY + distance * t;
        if (this.collides(p)) blocked = t; else free = t;
      }
      p.y = oldY + distance * free; this.grounded = distance < 0; this.velocity = 0;
    }
  }
}
