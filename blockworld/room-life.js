export class RoomLifeClient {
  constructor(state,apply,notify){this.state=state;this.apply=apply;this.notify=notify;this.reset();}
  reset(){this.generation=(this.generation||0)+1;this.room='';this.busy=false;this.last=0;this.version=0;this.commands=[];this.ack=[];this.damage=0;this.knockback={x:0,z:0};this.received=false;}
  command(command){if(!this.received||this.commands.length)return false;this.commands.push({...command,id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`});this.last=0;return true;}
  tick(){
    const state=this.state();if(!state.room){if(this.room)this.reset();return;}
    const key=state.room+'/'+state.clientId;if(key!==this.room){this.reset();this.room=key;}
    if(this.busy||performance.now()-this.last<200)return;
    this.busy=true;this.last=performance.now();const generation=this.generation,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
    const commands=[...this.commands],ack=[...this.ack];
    fetch('/api/blockworld/room/life',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,commands,ack}),signal:controller.signal})
      .then(async response=>{if(!response.ok)throw Error(response.status===404?'房间同步服务未就绪，请重启服务后重新组队':'房间同步失败，请重新登录或检查网络');return response.json();})
      .then(async data=>{
        if(generation!==this.generation||data.version<this.version)return;
        this.version=data.version;this.received=true;
        const delta=Math.max(0,data.damage-this.damage);this.damage=data.damage;
        const push=data.knockback||{x:0,z:0};data.knockbackDelta={x:push.x-this.knockback.x,z:push.z-this.knockback.z};this.knockback=push;
        await this.apply(data,delta);
        if(generation!==this.generation)return;
        const results=new Set(data.results.map(r=>r.id));this.commands=this.commands.filter(c=>!results.has(c.id));this.ack=data.results.map(r=>r.id);
      }).catch(error=>{if(generation===this.generation&&performance.now()-(this.warned||-10000)>10000){this.warned=performance.now();this.notify(error.message||'联机同步暂时中断');}})
      .finally(()=>{clearTimeout(timer);if(generation===this.generation)this.busy=false;});
  }
}
