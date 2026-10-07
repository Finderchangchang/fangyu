const fs=require('node:fs'),path=require('node:path');
function reason(error){const m=String(error?.message||'');return /无效方块/.test(m)?'INVALID_BLOCK':/另一设备|重启/.test(m)?'SESSION_EXPIRED':/未知云存档/.test(m)?'UNSUPPORTED_OPERATION':/存档读取/.test(m)?'SAVE_READ_FAILED':/背包/.test(m)?'INVALID_PROFILE':/找不到/.test(m)?'NOT_FOUND':error?.code==='ENOSPC'?'DISK_FULL':error?.code==='EACCES'?'DISK_ACCESS_DENIED':'SERVER_ERROR';}
class Diagnostics{
  constructor(directory){this.directory=directory;this.file=path.join(directory,'errors.jsonl');}
  record(row){try{
    fs.mkdirSync(this.directory,{recursive:true});
    if(fs.existsSync(this.file)&&fs.statSync(this.file).size>1024*1024){fs.copyFileSync(this.file,this.file+'.previous');fs.truncateSync(this.file,0);}
    // Accept only safe metadata, never account names, bodies or auth headers.
    const entry={time:new Date().toISOString()};
    for(const key of ['requestId','status','operation','reason','durationMs'])if(row[key]!==undefined)entry[key]=String(row[key]).replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,100);
    fs.appendFileSync(this.file,JSON.stringify(entry)+'\n');
  }catch{console.error('diagnostic log write failed');}}
}
module.exports={Diagnostics,reason};
