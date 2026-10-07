import test from 'node:test';
import assert from 'node:assert/strict';
import { RelaxingMusic } from '../music.js';
function fixture(){
  const timers=new Set(),saved=new Map(),oscillators=[];
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class AudioContext {
    constructor(){this.state='suspended';this.currentTime=0;this.destination={};}
    resume(){this.state='running';return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}
    createGain(){return {gain:param(),connect(){},disconnect(){}};}
    createOscillator(){const osc={frequency:param(),connect(){},disconnect(){},start(){this.started=true;},stop(){this.stops=(this.stops||0)+1;}};oscillators.push(osc);return osc;}
  }
  const host={AudioContext,localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:id=>timers.delete(id)};
  return {host,timers,saved,oscillators};
}
test('music waits for gesture and gameplay; pause stops notes and timer; resume has one timer',async()=>{
  const f=fixture(),music=new RelaxingMusic(f.host);
  music.setPlaying(true);assert.equal(f.timers.size,0);
  music.unlock();await Promise.resolve();assert.equal(f.timers.size,1);assert.equal(f.oscillators.length,5);
  music.setPlaying(true);assert.equal(f.timers.size,1);
  music.setPlaying(false);assert.equal(f.timers.size,0);assert.equal(music.notes.size,0);
  assert.ok(f.oscillators.every(o=>o.stops===2));
  music.setPlaying(true);assert.equal(f.timers.size,1);music.dispose();assert.equal(f.timers.size,0);
});
test('muting persists and late resume cannot restart paused music',async()=>{
  const f=fixture(),music=new RelaxingMusic(f.host);music.setPlaying(true);music.unlock();music.setPlaying(false);
  await Promise.resolve();assert.equal(f.timers.size,0);
  music.toggle();assert.equal(new RelaxingMusic(f.host).enabled,false);
  music.setPlaying(true);assert.equal(f.timers.size,0);music.toggle();await Promise.resolve();assert.equal(f.timers.size,1);
  music.dispose();
});
test('unavailable audio and denied storage do not block gameplay',()=>{
  const music=new RelaxingMusic({get localStorage(){throw Error('denied');}});
  assert.doesNotThrow(()=>{music.unlock();music.setPlaying(true);music.toggle();music.dispose();});
});
