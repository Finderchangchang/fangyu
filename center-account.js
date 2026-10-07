(()=>{
  const key='game-center-session';
  let account=null;
  let restoreError='';
  async function request(url,payload){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){const error=Error(data.error||`服务器错误（${response.status}）`);error.status=response.status;throw error;}
      if(!data.name||!data.token)throw Error('服务器未返回有效的登录信息');
      return data;
    }catch(error){if(error.name==='AbortError')throw Error('连接超时，请检查网络和服务器是否已启动');if(error instanceof TypeError)throw Error('连接不到服务器，请检查网址和网络');throw error}
    finally{clearTimeout(timer)}
  }
  function remember(data){
    account=data;
    try{sessionStorage.setItem(key,JSON.stringify({name:data.name,token:data.token}));localStorage.setItem('lastPlayerName',data.name);localStorage.setItem(`playerToken:${data.name}`,data.token)}
    catch{throw Error('浏览器禁止保存登录状态，请允许此网站使用存储后重试')}
    return data;
  }
  const ready=(async()=>{
    let saved;try{saved=JSON.parse(sessionStorage.getItem(key)||'null')}catch{return null}
    if(!saved)return null;
    try{return remember(await request('/api/session',saved))}catch(error){restoreError=error.message;if(error.status===401){try{sessionStorage.removeItem(key)}catch{}}return null}
  })();
  let gate=null,gateTimer;
  function showError(message){if(!gate)return;clearTimeout(gateTimer);gate.hidden=false;gate.querySelector('p').textContent=message;}
  window.GameAccount={ready,login:async(name,password,mode='login')=>remember(await request('/api/login',{name,password,mode})),entered(){clearTimeout(gateTimer);if(gate)gate.hidden=true},showError,get current(){return account}};
  // Standalone Fangyu keeps its own visible login, using the same accounts
  // and cloud saves without redirecting through the multi-game center.
  if(location.pathname.startsWith('/blockworld/')){
    window.GameAccount.showError=message=>{const error=document.querySelector('#loginError');if(error)error.textContent=message;};
    ready.then(data=>{if(!data&&restoreError)window.GameAccount.showError(restoreError);});
    return;
  }
  if(location.pathname!=='/'&&location.pathname!=='/index.html'){
    // The game forms remain in the DOM for older game code, but the center is
    // now the only visible login entry point.
    const style=document.createElement('style');
    style.textContent='#loginScreen,#gameLogin{display:none!important}.center-game-gate{position:fixed;inset:0;z-index:99999;display:grid;place-content:center;gap:20px;text-align:center;background:#10261ff5;color:white;font:18px system-ui;padding:24px}.center-game-gate[hidden]{display:none}.center-game-gate a{color:#c9ff79}';document.head.append(style);
    gate=document.createElement('section');gate.className='center-game-gate';gate.innerHTML='<p role="status">正在读取游戏中心的登录信息…</p><a href="/">返回游戏选择中心</a>';document.body.append(gate);
    gateTimer=setTimeout(()=>showError('游戏加载较慢或失败，请检查网络后刷新。无需重新注册账号。'),20000);
    ready.then(data=>{if(!data){if(restoreError){showError(`${restoreError}。可刷新重试，或点击下面的按钮返回游戏中心。`);return}location.replace('/');return}if(gate&&!gate.hidden)gate.querySelector('p').textContent=`欢迎 ${data.name}，正在准备游戏…`;});
    addEventListener('error',event=>{if(event.filename&&event.filename.includes('/blockworld/'))showError(`游戏启动失败：${event.message}。请刷新重试，账号和存档未删除。`);});
    return;
  }
  document.addEventListener('DOMContentLoaded',async()=>{
    const shell=document.querySelector('main.shell');
    const panel=document.createElement('section');panel.className='center-login';
    panel.innerHTML='<form><h1>登录游戏中心</h1><p>登录后选择四款游戏，无需重复输入密码。</p><label>玩家名字<input name="name" autocomplete="username" maxlength="16" required placeholder="输入你的名字"></label><label>6 位数字密码<input name="password" type="password" autocomplete="current-password" inputmode="numeric" minlength="6" maxlength="6" pattern="[0-9]{6}" required placeholder="输入 6 位数字密码"></label><button type="submit">登录并开始</button><button type="button" class="register">注册新账号</button><p class="account-error" role="alert"></p><small>名字不能重复。已有账号请登录，新玩家请注册。</small></form>';
    panel.hidden=false;document.body.append(panel);
    const boot=document.querySelector('#centerBootStatus');if(boot)boot.hidden=true;
    const form=panel.querySelector('form'),error=panel.querySelector('.account-error');
    const show=data=>{panel.hidden=true;shell.hidden=false;const badge=document.createElement('p');badge.textContent=`已登录：${data.name}`;const logout=document.createElement('button');logout.textContent='切换账号';logout.onclick=()=>{sessionStorage.removeItem(key);location.reload()};badge.append(' ',logout);shell.prepend(badge)};
    let busy=false;
    async function submit(mode){
      if(busy||!form.reportValidity())return;
      busy=true;error.textContent='正在连接…';panel.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{show(await window.GameAccount.login(form.elements.name.value.trim(),form.elements.password.value,mode));form.elements.password.value=''}
      catch(e){error.textContent=e.message}
      finally{busy=false;panel.querySelectorAll('button').forEach(b=>b.disabled=false)}
    }
    form.onsubmit=e=>{e.preventDefault();submit('login')};panel.querySelector('.register').onclick=()=>submit('register');
    error.textContent='正在检查登录状态，请稍候…';
    panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    const restored=await ready;if(restored)show(restored);else {panel.hidden=false;error.textContent=restoreError||'';}
    panel.querySelectorAll('button').forEach(b=>b.disabled=false);
  });
})();
