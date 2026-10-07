export const MAX_HEALTH = 100;
export const FOODS = [
  {id:'beef',name:'牛肉',color:0xa83c30,heal:30},
  {id:'mutton',name:'羊肉',color:0xd67b7e,heal:20},
  {id:'goldenApple',name:'金苹果',color:0xffcf40,heal:1000}
];
export function fallDamage(distance) {
  const blocks = Math.max(0, Math.floor(distance + .001));
  if (blocks < 3) return 0;
  if (blocks === 3) return 1;
  if (blocks <= 5) return 4;
  return Math.min(MAX_HEALTH, blocks - 1);
}
export class FallTracker {
  reset() { this.peak = null; }
  update(y, grounded, waiting = false) {
    if (waiting) return 0;
    if (this.peak == null) this.peak = y;
    this.peak = Math.max(this.peak, y);
    if (!grounded) return 0;
    const damage = fallDamage(this.peak - y);
    this.peak = y;
    return damage;
  }
}
export function eatFood(health, count, food, elapsed,maximum=MAX_HEALTH) {
  if (!food || count < 1 || elapsed < 2 || health >= maximum) return null;
  return {health:Math.min(maximum,health+food.heal), count:count-1};
}
export function hitAnimal(health,damage=5) { return Math.max(0, health - damage); }
