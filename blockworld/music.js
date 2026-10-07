// Original, locally synthesized ambient loop: no downloads or third-party songs.
const MELODY=[72,null,76,79,74,null,72,null,69,null,72,76,79,null,76,null,77,null,76,72,69,null,72,null,67,null,71,74,79,74,71,null];
const CHORDS=[[48,55,60,64],[45,52,57,60],[41,48,53,57],[43,50,55,59]];
export class RelaxingMusic {
  constructor(host=globalThis){
    this.host=host;this.enabled=true;this.playing=false;this.context=null;this.timer=null;this.notes=new Set();this.step=0;
    try{this.enabled=host.localStorage?.getItem('block-isle-music')!=='off';}catch{}
  }
  unlock(){
    if(!this.enabled)return;
    try{
      if(!this.context){
        const Audio=this.host.AudioContext||this.host.webkitAudioContext;if(!Audio)return;
        this.context=new Audio();this.master=this.context.createGain();this.master.gain.value=.16;this.master.connect(this.context.destination);
      }
      Promise.resolve(this.context.resume()).then(()=>this.sync()).catch(()=>{});
    }catch{/* Unsupported/blocked audio must never prevent entering the game. */}
  }
  toggle(){
    this.enabled=!this.enabled;
    try{this.host.localStorage?.setItem('block-isle-music',this.enabled?'on':'off');}catch{}
    if(this.enabled)this.unlock();this.sync();return this.enabled;
  }
  setPlaying(value){if(this.playing===value)return;this.playing=value;this.sync();}
  sync(){
    const active=this.enabled&&this.playing&&this.context?.state==='running';
    if(!active){this.stop();return;}
    if(this.timer!==null)return;
    this.next=this.context.currentTime+.05;this.schedule();
    this.timer=this.host.setInterval(()=>this.schedule(),100);
  }
  tone(midi,time,duration,volume){
    const ctx=this.context,osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';osc.frequency.value=440*2**((midi-69)/12);
    gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+.08);
    gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    osc.connect(gain);gain.connect(this.master);this.notes.add(osc);
    osc.onended=()=>{this.notes.delete(osc);osc.disconnect();gain.disconnect();};
    osc.start(time);osc.stop(time+duration+.02);
  }
  schedule(){
    const ctx=this.context;
    if(!ctx||ctx.state!=='running')return;
    // Skip missed audio after a long frame instead of queuing a burst of notes.
    if(this.next<ctx.currentTime)this.next=ctx.currentTime+.05;
    while(this.next<ctx.currentTime+.25){
      const beat=this.step%32,note=MELODY[beat];
      if(beat%8===0)for(const pitch of CHORDS[Math.floor(beat/8)])this.tone(pitch,this.next,5.8,.12);
      if(note!==null)this.tone(note,this.next,2,.24);
      this.step++;this.next+=60/72;
    }
  }
  stop(){
    if(this.timer!==null){this.host.clearInterval(this.timer);this.timer=null;}
    for(const osc of this.notes){try{osc.stop();}catch{}}
    this.notes.clear();
  }
  dispose(){this.stop();this.playing=false;this.context?.close().catch(()=>{});this.context=null;}
}
