(()=>{
  let page=['fps','casual','extraction','blockworld'].find(p=>location.pathname.startsWith(`/${p}/`))||'lobby';
  document.documentElement.classList.add(`presence-${page}`);
  const clientId=globalThis.crypto?.randomUUID?.()||`tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let badge=document.createElement('button');badge.type='button';badge.className='online-presence offline';badge.setAttribute('aria-live','polite');badge.setAttribute('aria-expanded','false');badge.setAttribute('aria-controls','online-player-panel');badge.innerHTML='<i></i><span>在线人数</span><b>--</b>';document.body.append(badge);
  const panel=document.createElement('section');panel.id='online-player-panel';panel.className='online-player-panel';panel.hidden=true;
  panel.setAttribute('aria-label','在线玩家');panel.innerHTML='<header><strong>谁在线</strong><button type="button" aria-label="关闭在线名单">×</button></header><p>全站在线 · 同名账号只计一次</p><ul></ul><p class="presence-status" role="status">正在读取…</p>';document.body.append(panel);
  const list=panel.querySelector('ul'),status=panel.querySelector('.presence-status');
  const labels={lobby:'游戏选择中心',fps:'灰区协议 3D',casual:'晴空漫游 3D',extraction:'撤离行动',blockworld:'方屿 3D'};
  function identity(){try{
    if(page==='lobby'&&!localStorage.getItem('lastPlayerName'))return JSON.parse(sessionStorage.getItem('blockworld-player')||'{}');
    if(page==='blockworld'){if(document.querySelector('#loginScreen')?.classList.contains('active'))return {};return JSON.parse(sessionStorage.getItem('blockworld-player')||'{}')}
    const login=document.querySelector(page==='extraction'?'#loginScreen':'#gameLogin');if(login&&!login.classList.contains('hidden'))return {};
    const name=page==='lobby'?localStorage.getItem('lastPlayerName'):document.querySelector(page==='extraction'?'#playerNameInput':'#accountName')?.value.trim();return{name,token:name?localStorage.getItem(`playerToken:${name}`):''};
  }catch{return {}}}
  function render(data){number.textContent=data.online;badge.classList.remove('offline');list.replaceChildren();for(const player of data.players||[]){const row=document.createElement('li'),name=document.createElement('b'),game=document.createElement('small');name.textContent=player.name;game.textContent=(player.pages||[]).map(p=>labels[p]||'游戏中').join('、');row.append(name,game);list.append(row)}status.textContent=data.guests?`另有 ${data.guests} 个未登录访客页面（不显示姓名）`:'每 10 秒更新；离线后最迟约 35 秒移除'}
  function close(){panel.hidden=true;badge.setAttribute('aria-expanded','false')}
  badge.addEventListener('click',e=>{e.stopPropagation();panel.hidden=!panel.hidden;badge.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)ping()});
  panel.querySelector('button').onclick=()=>{close();badge.focus()};
  for(const el of [panel,badge])el.addEventListener('pointerdown',e=>e.stopPropagation());
  document.addEventListener('click',e=>{if(!panel.contains(e.target)&&!badge.contains(e.target))close()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
  let number=badge.querySelector('b'),pending=false;
  async function ping(){if(pending)return;pending=true;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7000);try{let auth=identity(),response=await fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,page,action:'ping',name:auth.name,token:auth.token}),cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Error();render(data)}catch{number.textContent='--';badge.classList.add('offline');list.replaceChildren();status.textContent='在线名单读取失败，请稍后重试'}finally{clearTimeout(timeout);pending=false}}
  ping();let timer=setInterval(ping,10000);
  addEventListener('pageshow',()=>{clearInterval(timer);ping();timer=setInterval(ping,10000)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)ping()});
  addEventListener('pagehide',()=>{clearInterval(timer);let payload=JSON.stringify({clientId,page,action:'leave'});try{navigator.sendBeacon('/api/presence',new Blob([payload],{type:'application/json'}))}catch{fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:true}).catch(()=>{})}});
})();
