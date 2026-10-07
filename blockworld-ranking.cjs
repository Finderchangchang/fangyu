const fs=require('node:fs');
const DAY_MS=24*60*1000; // One game day is 24 real minutes.
class SurvivalRanking {
  constructor(file,now=Date.now){
    this.file=file;this.now=now;this.totals=new Map();this.sessions=new Map();this.needsSeparator=false;this.damagedRecords=0;
    try{const source=fs.readFileSync(file,'utf8');this.needsSeparator=!!source&&!source.endsWith('\n');for(const line of source.split('\n')){
      if(!line.trim())continue;
      try{
        const {name,total}=JSON.parse(line);
        if(typeof name!=='string'||!Number.isSafeInteger(total)||total<0)throw Error('Invalid record');
        this.totals.set(name,Math.max(total,this.totals.get(name)||0));
      }catch{this.damagedRecords++;}
    }}
    catch(error){if(error.code!=='ENOENT')throw error;}
    if(this.damagedRecords)console.warn(`Survival ranking: ${this.damagedRecords} damaged records skipped; original journal retained.`);
  }
  pulse(name,client,active){
    const now=this.now(),previous=this.sessions.get(name);
    const session={at:previous?.at??now,clients:new Map(previous?.clients)};
    const elapsed=now-session.at;
    const wasActive=[...session.clients.values()].some(at=>now-at<=30000);
    let total=this.totals.get(name)||0;
    if(wasActive&&elapsed>0&&elapsed<=30000)total+=elapsed;
    for(const [id,at] of session.clients)if(now-at>30000)session.clients.delete(id);
    if(active){if(session.clients.size<8||session.clients.has(client))session.clients.set(client,now);}else session.clients.delete(client);
    session.at=Math.max(session.at,now);
    if(!this.totals.has(name)||total!==this.totals.get(name)){
      // Append-only journal avoids Windows replacement locks and retains history.
      fs.appendFileSync(this.file,(this.needsSeparator?'\n':'')+JSON.stringify({name,total})+'\n','utf8');
      this.needsSeparator=false;
      this.totals.set(name,total);
    }
    this.sessions.set(name,session);
    for(const [key,value] of this.sessions)if(now-value.at>30000)this.sessions.delete(key);
  }
  board(name,page=1){
    const sorted=[...this.totals].map(([name,ms])=>({name,days:Math.floor(ms/DAY_MS)})).sort((a,b)=>b.days-a.days||a.name.localeCompare(b.name,'zh-CN'));
    let rank=0,previous=-1;const rows=sorted.map((row,i)=>{if(row.days!==previous){rank=i+1;previous=row.days;}return {...row,rank};});
    const pages=Math.max(1,Math.ceil(rows.length/50));page=Math.max(1,Math.min(pages,Math.floor(Number(page))||1));
    return {rows:rows.slice((page-1)*50,page*50),page,pages,total:rows.length,me:rows.find(row=>row.name===name)||null};
  }
}
module.exports={SurvivalRanking,DAY_MS};
