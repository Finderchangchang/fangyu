export const DAY_SECONDS=24*60*60;
export const TIME_SPEED=60; // One real second advances one game minute.
export class WorldClock {
  constructor(seconds=8*3600){this.restore(seconds);}
  restore(seconds){this.seconds=Number.isFinite(seconds)&&seconds>=0?seconds:8*3600;}
  advance(realSeconds){if(Number.isFinite(realSeconds)&&realSeconds>0)this.seconds+=realSeconds*TIME_SPEED;}
  get hour(){return (this.seconds%DAY_SECONDS)/3600;}
  get night(){return this.hour>=18||this.hour<8;}
  get label(){const minutes=Math.floor(this.seconds/60)%1440;return `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
  get day(){return Math.floor(this.seconds/DAY_SECONDS)+1;}
}
