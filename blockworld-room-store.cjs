const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
class RoomArchive {
  constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true});}
  file(id){return path.join(this.directory,crypto.createHash('sha256').update(id).digest('hex')+'.jsonl');}
  load(id){
    let room=null;
    try{for(const line of fs.readFileSync(this.file(id),'utf8').split('\n')){
      if(!line.trim())continue;const e=JSON.parse(line);
      if(e.kind==='base')room=e.room;
      else if(e.kind==='edit'&&room){room.edits[e.key]=e.block;room.editRevision=e.revision;}
    }}catch(error){if(error.code!=='ENOENT')throw Error('房间存档读取失败，原文件已保留');}
    return room?{...room,players:new Map(),actions:[]}:null;
  }
  base(room){fs.appendFileSync(this.file(room.id),JSON.stringify({kind:'base',room:{id:room.id,world:room.world,edits:room.edits,editRevision:room.editRevision,editsInitialized:true,createdAt:room.createdAt,lifeStartTime:room.life?.time??room.lifeStartTime}})+'\n');}
  edit(room,key,block){fs.appendFileSync(this.file(room.id),JSON.stringify({kind:'edit',key,block,revision:(room.editRevision||0)+1})+'\n');}
}
module.exports={RoomArchive};
