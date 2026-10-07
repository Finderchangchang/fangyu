export function setupRanking(getAuth,pause){
  const panel=document.querySelector('#survivalRanking'),status=document.querySelector('#rankingStatus'),list=document.querySelector('#rankingRows');
  const clientId=globalThis.crypto?.randomUUID?.()||`player-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let active=false,lastPulse=0,busy=false,pending=false,page=1,pages=1,request=0,loading=false,controller=null,opener=null;
  const previous=document.querySelector('#rankingPrevious'),next=document.querySelector('#rankingNext'),refresh=document.querySelector('#refreshRanking');
  function buttons(){previous.disabled=loading||page<=1;next.disabled=loading||page>=pages;refresh.disabled=loading;panel.setAttribute('aria-busy',String(loading));}
  function errorMessage(response){return response.status===404?'排行榜服务尚未更新，请保存游戏后联系管理员重启服务。':response.status===401?'登录已失效，请返回游戏中心重新登录。':'暂时无法连接排行榜，请稍后重试。';}
  async function pulse(){
    if(busy){pending=true;return;}
    const auth=getAuth();if(!auth.name||!auth.token)return;
    busy=true;lastPulse=performance.now();
    const heartbeatController=new AbortController(),timeout=setTimeout(()=>heartbeatController.abort(),8000);
    try{
      const response=await fetch('/api/blockworld/ranking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...auth,action:'pulse',clientId,active}),keepalive:true,signal:heartbeatController.signal});
      if(!response.ok)throw Error('生存记录暂未同步');
    }catch{/* A background heartbeat must not overwrite the open leaderboard's status. */}
    finally{clearTimeout(timeout);busy=false;if(pending){pending=false;pulse();}}
  }
  function setActive(value){
    if(active!==value){active=value;pulse();}
    else if(active&&performance.now()-lastPulse>=10000)pulse();
  }
  async function load(){
    controller?.abort();controller=new AbortController();const currentController=controller;
    const timeout=setTimeout(()=>currentController.abort(),8000);
    const id=++request;loading=true;buttons();status.textContent='正在加载排行榜…';
    try{
      const response=await fetch('/api/blockworld/ranking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...getAuth(),page}),signal:currentController.signal});
      if(!response.ok)throw Error(errorMessage(response));
      const data=await response.json();if(id!==request)return;
      page=data.page;pages=data.pages;list.replaceChildren();
      status.textContent=data.me?`我的排名：第 ${data.me.rank} 名 · 累计生存 ${data.me.days} 天`:'开始生存后即可上榜';
      if(!data.rows.length)status.textContent='还没有生存记录，开始游戏来争夺第一名吧！';
      for(const row of data.rows){
        const tr=document.createElement('tr');
        if(row.name===getAuth().name)tr.className='ranking-me';
        if(row.rank<=3)tr.dataset.podium=String(row.rank);
        for(const value of [row.rank,row.name,`${row.days} 天`]){const td=document.createElement('td');td.textContent=String(value);tr.append(td);}
        list.append(tr);
      }
      document.querySelector('#rankingPage').textContent=`${page} / ${pages} 页 · ${data.total} 人`;
    }catch(error){if(id===request)status.textContent=error.name==='AbortError'?'连接超时，请点击“刷新排行”重试。':error.message;}
    finally{clearTimeout(timeout);if(id===request){loading=false;buttons();}}
  }
  document.querySelectorAll('[data-ranking]').forEach(button=>button.onclick=()=>{opener=button;pause();setActive(false);panel.classList.add('active');page=1;list.replaceChildren();document.querySelector('#rankingPage').textContent='';load();document.querySelector('#closeRanking').focus();});
  function close(){request++;controller?.abort();loading=false;buttons();panel.classList.remove('active');opener?.focus();}
  document.querySelector('#closeRanking').onclick=close;
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab'){
      const buttons=[...panel.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  document.querySelector('#refreshRanking').onclick=load;
  document.querySelector('#rankingPrevious').onclick=()=>{if(page>1){page--;load();}};
  document.querySelector('#rankingNext').onclick=()=>{if(page<pages){page++;load();}};
  addEventListener('pagehide',()=>setActive(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)setActive(false);});
  return {setActive};
}
