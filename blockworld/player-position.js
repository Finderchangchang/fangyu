import {MIN_Y,HEIGHT} from './world-core.js';
import {EYE_HEIGHT} from './physics.js';
export function validPosition(p){return !!p&&['x','y','z','yaw','pitch','savedAt'].every(k=>Number.isFinite(p[k]))&&Math.abs(p.x)<=100000&&Math.abs(p.z)<=100000&&p.y>MIN_Y+EYE_HEIGHT&&p.y<HEIGHT+100&&Math.abs(p.pitch)<=Math.PI/2;}
export function safeResumePosition(p,physics){
  if(!physics.areaLoaded(p))return undefined;
  if(!physics.collides(p))return {...p};
  // A newly placed block must not trap the returning player. Search upward
  // in the same column first, including underground builds.
  for(let y=Math.floor(p.y-EYE_HEIGHT)+1+EYE_HEIGHT;y<HEIGHT+EYE_HEIGHT+1;y++){
    const next={...p,y};if(!physics.collides(next)&&physics.collides({...next,y:y-.01}))return next;
  }
  return null;
}
