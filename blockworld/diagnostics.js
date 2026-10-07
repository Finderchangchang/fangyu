(()=>{
  const key='fangyu-diagnostics-v1';let entries=[];
  try{const saved=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(saved))entries=saved.slice(-200);}catch{}
  function record(data){
    const entry={time:new Date().toISOString(),version:'20261007-diagnostics',online:navigator.onLine};
    for(const k of ['operation','status','reason','requestId','durationMs'])if(data[k]!==undefined)entry[k]=String(data[k]).replace(/[^a-zA-Z0-9_.:-]/g,'_').slice(0,100);
    entries.push(entry);entries=entries.slice(-200);try{localStorage.setItem(key,JSON.stringify(entries));}catch{}
  }
  function download(){const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),entries},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fangyu-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  window.FangyuDiagnostics={record,download};
  addEventListener('error',()=>record({reason:'SCRIPT_OR_RESOURCE_ERROR'}));
  addEventListener('unhandledrejection',()=>record({reason:'UNHANDLED_PROMISE_REJECTION'}));
  addEventListener('offline',()=>record({reason:'BROWSER_OFFLINE'}));
  addEventListener('online',()=>record({reason:'BROWSER_ONLINE'}));
})();
