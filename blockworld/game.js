import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { movement, trace, WATER, HEIGHT, MIN_Y } from './world-core.js';
import { CloudWorldStore } from './cloud-storage.js';
import { bagLayout, bagSlotCount, canCollect, nextMorning } from './bag.js';
import { RoomLifeClient } from './room-life.js';
import { ChunkWorld } from './chunks.js';
import { Physics, EYE_HEIGHT, RADIUS } from './physics.js';
import {validPosition,safeResumePosition} from './player-position.js';
import { MAX_HEALTH, FOODS, FallTracker, eatFood } from './survival.js';
import { Animals } from './animals.js';
import {Merchants,exchange} from './merchant.js';
import { WorldClock } from './day-night.js';
import { NightMonsters, MONSTER_HEALTH } from './night-monsters.js';
import { RelaxingMusic } from './music.js';
import { setupRanking } from './ranking.js?v=20261002-2';

const $ = selector => document.querySelector(selector);
let bagPage=0;
const BAG_PAGE_SIZE=80;
const music=new RelaxingMusic();
function updateMusicButtons(){document.querySelectorAll('[data-music]').forEach(button=>{button.textContent=music.enabled?'音乐：开（M）':'音乐：关（M）';button.setAttribute('aria-pressed',String(music.enabled));});}
document.querySelectorAll('[data-music]').forEach(button=>button.onclick=()=>{music.toggle();updateMusicButtons();});
updateMusicButtons();
document.addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('input,textarea,[contenteditable]')){music.toggle();updateMusicButtons();}});
addEventListener('pagehide',()=>music.setPlaying(false));
const startScreen = $('#startScreen'), pauseScreen = $('#pauseScreen'), hud = $('#hud');
const streamState = $('#streamState');
const BLOCKS = [
  { id:'grass', name:'草方块', color:0x62ad4c }, { id:'dirt', name:'泥土', color:0x8d5c39 },
  { id:'stone', name:'石头', color:0x89959a }, { id:'wood', name:'原木', color:0x9a6439 },
  { id:'leaves', name:'树叶', color:0x3e944d }, { id:'sand', name:'沙子', color:0xe5ce7a },
  { id:'cotton', name:'棉花', color:0xf5f2e8 }, { id:'bed', name:'床', color:0xc66362 }
];
const MINE_TIMES = { grass:3, dirt:3, stone:5, wood:5, leaves:3, sand:3, bed:5 };
const TOOL_MINE_TIMES = { pickaxe:{stone:2}, axe:{wood:2,leaves:1}, shovel:{grass:1,dirt:1,sand:1} };
const WORKBENCH_RECIPE = { stone:5, wood:5 };
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x78c8ff);
scene.fog = new THREE.Fog(0xa9ddf5, 30, 49);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .08, 130);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer:coarse)').matches ? 1.25 : 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('#world').appendChild(renderer.domElement);
const controls = new PointerLockControls(camera, document.body);
scene.add(camera);
const outlineBox = new THREE.BoxGeometry(1.006, 1.006, 1.006);
const targetOutline = new THREE.LineSegments(new THREE.EdgesGeometry(outlineBox),
  new THREE.LineBasicMaterial({color:0xffec8a}));
outlineBox.dispose(); targetOutline.visible=false; scene.add(targetOutline);
const ambientLight=new THREE.HemisphereLight(0xdaf3ff, 0x567a48, 2.2);scene.add(ambientLight);
const sun = new THREE.DirectionalLight(0xfff3c2, 2.8);
sun.castShadow = true; sun.shadow.mapSize.set(1024,1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -24;
sun.shadow.camera.right = sun.shadow.camera.top = 24;
sun.shadow.camera.far = 130; sun.shadow.normalBias = .035;
scene.add(sun, sun.target);
const water = new THREE.Mesh(new THREE.PlaneGeometry(260,260),
  new THREE.MeshStandardMaterial({ color:0x3da8dc, transparent:true, opacity:.72, roughness:.35, side:THREE.DoubleSide }));
water.rotation.x = -Math.PI / 2; water.position.y = WATER + .38; scene.add(water);
const cloudGeometry = new THREE.BoxGeometry(1,1,1);
const cloudMaterial = new THREE.MeshLambertMaterial({color:0xffffff});
const clouds = [[-24,25,-18,1.2],[12,28,-28,.9],[28,24,8,1.35]].map(([x,y,z,s]) => {
  const group = new THREE.Group();
  for (const [cx,cy,scale] of [[0,0,2.8],[2,0,2],[-2,0,1.8],[.7,.7,1.8]]) {
    const cube = new THREE.Mesh(cloudGeometry,cloudMaterial);
    cube.position.set(cx,cy,0); cube.scale.set(scale,scale*.55,scale*.8); group.add(cube);
  }
  group.position.set(x,y,z); group.scale.setScalar(s); scene.add(group); return group;
});

let world, info, selected = 0, playing = false, ready = false, spawning = true, target = null;
let pendingPosition=null,lastSavedPosition=null;
let bedSleep=null;
const positionKey=id=>`fangyu-position:${playerName}:${id}`;
function snapshotPosition(){
  if(ready&&!spawning){lastSavedPosition={x:camera.position.x,y:camera.position.y,z:camera.position.z,yaw:camera.rotation.y,pitch:camera.rotation.x,savedAt:Date.now()};}
  if(lastSavedPosition&&world&&loadedPlayer){try{localStorage.setItem(positionKey(world.id),JSON.stringify(lastSavedPosition));}catch{}}
  return lastSavedPosition;
}
const store = new CloudWorldStore();
store.onCloudError=error=>{
  const suffix=error.requestId?`（编号 ${error.requestId.slice(0,8)}）`:'';
  if(error.status===401||error.status===409){playing=false;resetInput();controls.unlock();pauseScreen.classList.add('active');toast(`账号连接已失效：${error.message}。请刷新重新登录，本地备份已保留。${suffix}`);}
  else if(error.status>=400)toast(`服务器拒绝保存：${error.message}。不一定是断网，请勿清除存档。${suffix}`);
  else if(error.reason==='TIMEOUT')toast('服务器响应超时，已记录日志，下次保存会重试。');
  else if(error.reason==='INVALID_RESPONSE')toast(`服务器返回了无法读取的数据，已记录日志。${suffix}`);
  else toast('暂时连接不到游戏服务器，请检查游戏地址或服务是否运行。已记录日志。');
};
const inventory = Object.fromEntries(BLOCKS.map(block => [block.id, 0]));
let quickbar=Array(6).fill(null),quickSlot=0;
const bagTools=()=>[...ownedTools].filter(id=>id!=='none').concat(hasWorkbench?['workbench']:[]);
const drops = [];
let health=MAX_HEALTH,selectedFood=null,eating=null,animals=null,animalTarget=null,lastAnimalHit=0;
let goldenHealth=false,merchants=null,merchantTarget=null;
const healthMaximum=()=>goldenHealth?1000:MAX_HEALTH;
const fallTracker=new FallTracker();
const worldClock=new WorldClock();
let monsters=null,monsterTarget=null,darkness=0,clockWasActive=false,clockSaveElapsed=0,respawnGrace=0;
const daySky=new THREE.Color(0x78c8ff),nightSky=new THREE.Color(0x101b38),dayFog=new THREE.Color(0xa9ddf5),nightFog=new THREE.Color(0x172340);
let playerName = '', playerToken = '';
const ranking=setupRanking(()=>({name:playerName,token:playerToken}),pause);
let loadedPlayer = '';
let switchingWorld = false;
let roomId = '', roomClientId = '', roomSyncClock = 0, roomActionCursor = 0, roomSyncPending = false, roomSyncGeneration = 0, roomJoinPending = false, roomEditRevision = 0;
const remotePlayers = new Map();
let playerTarget=null;
const playerRay=new THREE.Raycaster();
let pendingRoomEdits = [], roomEdits = new Map();
const lifeReceipts=new Set();
const roomLifeClient=new RoomLifeClient(()=>({room:roomId,clientId:roomClientId,name:playerName,token:playerToken,position:localRoomPosition(),sleeping:bedSleep?.bed||null,active:playing&&ready&&!document.hidden,time:worldClock.seconds}),async(data,damage)=>{
  worldClock.restore(data.time);monsters?.syncRemote(data.monsters);
  if(bedSleep&&data.sleep){if(!worldClock.night){bedSleep=null;resetInput();darkness=0;saveWorld();toast('大家睡醒了，现在是早上 08:00');}else $('#targetHint').textContent=data.sleep.all?`大家都躺下了 · ${Math.ceil(data.sleep.remaining)} 秒后天亮`:`已躺下 ${data.sleep.sleeping}/${data.sleep.total} 人 · 等待其他玩家`;}
  if(damage){bedSleep=null;damagePlayer(damage,'受到攻击');}
  if(data.knockbackDelta)physics.knockback(data.knockbackDelta.x,data.knockbackDelta.z);
  const visible=new Set(data.loot.map(d=>d.id));
  for(let i=drops.length-1;i>=0;i--)if(drops[i].roomLoot&&!visible.has(drops[i].roomLoot)){const d=drops.splice(i,1)[0];scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();}
  for(const item of data.loot)if(!drops.some(d=>d.roomLoot===item.id)){const drop=spawnDrop(item.x-.5,item.y-.55,item.z-.5,item.type);if(drop)drop.roomLoot=item.id;}
  let newReceipts=false;
  for(const result of data.results){
    if(lifeReceipts.has(result.id))continue;lifeReceipts.add(result.id);
    newReceipts=true;
    if(result.ok&&result.type==='pickup'){inventory[result.item]=(inventory[result.item]||0)+1;updateInventoryUI();toast('已拾取共享物资');}
    if(result.ok&&result.type==='hit'&&result.tool==='sword'){const previous=equippedTool;equippedTool='sword';consumeSwordUse();if(previous!=='sword')equippedTool=previous;updateToolsUI();}
    if(result.ok&&result.type==='sleep')toast('全房间已到早上 08:00');
    if(!result.ok)toast('操作未生效：目标已变化或距离太远');
  }
  if(newReceipts)await saveWorld();
},toast);
function avatarColor(name) {
  let hash = 0; for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL(Math.abs(hash % 360) / 360, .68, .58);
}
function makeNameTag(name) {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#17384ddd';
  // Older embedded WebViews do not expose roundRect; keep the name tag
  // readable there instead of letting avatar creation throw and leaving a
  // single broken rectangle in the world.
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(4, 8, 248, 48, 14); }
  else { ctx.beginPath(); ctx.rect(4, 8, 248, 48); }
  ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(name || '玩家').slice(0, 12), 128, 33);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:texture, transparent:true, depthTest:false})); sprite.scale.set(1.65, .42, 1); sprite.position.y = 2.55; sprite.userData.texture = texture; return sprite;
}
function makeRemoteAvatar(name) {
  // A compact, clearly humanoid block avatar.  The group origin is at the
  // soles of the feet (not at the camera), so a synced eye position can never
  // make the other player look like a tall floating cuboid.
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({color:0xf1b58b, roughness:.78});
  const shirt = new THREE.MeshStandardMaterial({color:avatarColor(name), roughness:.86});
  const pants = new THREE.MeshStandardMaterial({color:0x3b4c72, roughness:.9});
  const hair = new THREE.MeshStandardMaterial({color:0x3a2924, roughness:.95});
  const shoe = new THREE.MeshStandardMaterial({color:0x202936, roughness:1});
  const eye = new THREE.MeshBasicMaterial({color:0x16222c});
  const part = (geometry, material, x, y, z, key) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true; if (key) group.userData[key] = mesh;
    group.add(mesh); return mesh;
  };
  // Shoes and legs leave only a tiny .02-unit clearance above the ground.
  part(new THREE.BoxGeometry(.25, .12, .38), shoe, -.19, .06, -.035, 'leftShoe');
  part(new THREE.BoxGeometry(.25, .12, .38), shoe,  .19, .06, -.035, 'rightShoe');
  part(new THREE.BoxGeometry(.22, .72, .25), pants, -.19, .47, 0, 'leftLeg');
  part(new THREE.BoxGeometry(.22, .72, .25), pants,  .19, .47, 0, 'rightLeg');
  part(new THREE.BoxGeometry(.68, .76, .38), shirt, 0, 1.18, 0, 'torso');
  // Neck, head, hair and two small eyes make the facing direction obvious.
  part(new THREE.BoxGeometry(.18, .16, .18), skin, 0, 1.66, 0, 'neck');
  part(new THREE.BoxGeometry(.46, .46, .46), skin, 0, 1.93, 0, 'head');
  part(new THREE.BoxGeometry(.48, .13, .48), hair, 0, 2.17, 0, 'hair');
  part(new THREE.BoxGeometry(.09, .09, .025), eye, -.105, 1.97, -.232, 'leftEye');
  part(new THREE.BoxGeometry(.09, .09, .025), eye,  .105, 1.97, -.232, 'rightEye');
  part(new THREE.BoxGeometry(.17, .66, .2), skin, -.46, 1.18, 0, 'leftArm');
  part(new THREE.BoxGeometry(.17, .66, .2), skin,  .46, 1.18, 0, 'rightArm');
  const tag = makeNameTag(name); group.add(tag);
  group.userData.playerName = name;
  group.userData.target = new THREE.Vector3();
  group.userData.targetYaw = 0;
  group.userData.phase = Math.random() * Math.PI * 2;
  group.userData.moving = false;
  return group;
}
function disposeRemoteAvatar(avatar) {
  avatar.traverse(node => { if (node.geometry) node.geometry.dispose(); if (node.material) { if (node.material.map) node.material.map.dispose(); node.material.dispose(); } });
}
function remoteGroundY(x, z, aroundY = null) {
  if (!world || !world.loaded(x, z)) return null;
  const ix = Math.floor(x), iz = Math.floor(z);
  // Search close to the reported feet height.  Looking for the absolute
  // highest block would put a player underneath a tree canopy on top of the
  // leaves instead of on the floor.
  const top = Number.isFinite(aroundY) ? Math.min(HEIGHT - 1, Math.floor(aroundY) + 2) : HEIGHT - 1;
  for (let y = top; y >= MIN_Y; y--) if (world.block(ix, y, iz)) return y + 1;
  return null;
}
function updateRemoteAvatars(dt) {
  for (const avatar of remotePlayers.values()) {
    const target = avatar.userData.target; if (!target) continue;
    const alpha = 1 - Math.exp(-Math.min(.25, dt) * 11);
    avatar.position.lerp(target, alpha);
    const yawDelta = Math.atan2(Math.sin(avatar.userData.targetYaw - avatar.rotation.y), Math.cos(avatar.userData.targetYaw - avatar.rotation.y));
    avatar.rotation.y += yawDelta * alpha;
    avatar.userData.phase += dt * (avatar.userData.moving ? 10 : 2.2);
    const swing = avatar.userData.moving ? Math.sin(avatar.userData.phase) * .42 : 0;
    if (avatar.userData.leftArm) avatar.userData.leftArm.rotation.x = swing;
    if (avatar.userData.rightArm) avatar.userData.rightArm.rotation.x = -swing;
    if (avatar.userData.leftLeg) avatar.userData.leftLeg.rotation.x = -swing * .72;
    if (avatar.userData.rightLeg) avatar.userData.rightLeg.rotation.x = swing * .72;
    if (avatar.userData.torso) avatar.userData.torso.position.y = 1.18 + (avatar.userData.moving ? Math.abs(Math.sin(avatar.userData.phase * 2)) * .025 : 0);
  }
}
function clearRemotePlayers() {
  for (const avatar of remotePlayers.values()) { scene.remove(avatar); disposeRemoteAvatar(avatar); }
  remotePlayers.clear();
}
function resetRoomState() {
  roomLifeClient.reset();monsters?.clear();
  for(let i=drops.length-1;i>=0;i--)if(drops[i].roomLoot){const d=drops.splice(i,1)[0];scene.remove(d.mesh);d.mesh.geometry.dispose();d.mesh.material.dispose();}
  roomSyncGeneration++; roomId = ''; roomClientId = ''; roomSyncClock = 0; roomActionCursor = 0; roomEditRevision = 0; roomSyncPending = false;
  roomEdits = new Map(); pendingRoomEdits = []; clearRemotePlayers();
}
function leaveRoom() {
  const payload = roomId && roomClientId ? { room:roomId, clientId:roomClientId, name:playerName, token:playerToken } : null;
  resetRoomState();
  if (!payload) return;
  const body = JSON.stringify(payload), headers = {'Content-Type':'application/json'};
  // keepalive lets a tab close release the slot promptly; the server TTL is
  // still the fallback when the browser cancels the request.
  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon('/api/blockworld/room/leave', new Blob([body], {type:'application/json'}));
      if (sent) return;
    }
  } catch { /* use fetch fallback */ }
  fetch('/api/blockworld/room/leave', {method:'POST', headers, body, keepalive:true}).catch(() => {});
}
let equippedTool = 'none', miningTask = null, hasWorkbench = false;
const ownedTools = new Set(['none']);
const toolDurability = { axe:0, pickaxe:0, shovel:0, sword:0, omni:0,omni50:0,omni2:0 };
const TOOL_NAMES = {none:'空手',axe:'斧头',pickaxe:'镐子',shovel:'铲子',sword:'石剑',omni:'万能工具',omni50:'万能工具（50耐久）',omni2:'万能工具（2耐久）'};
const TOOL_MAX_DURABILITY = 100;
const TOOL_RECIPES = {
  axe: { wood:5, stone:5 },
  pickaxe: { wood:5, stone:5 },
  shovel: { wood:5, stone:5 },
  sword: { stone:10 }
};
const keys = Object.create(null), mobileMove = {x:0,y:0}, direction = new THREE.Vector3();
const lastForward = {x:0,z:-1};
const physics = new Physics(camera.position, (x,y,z) => world?.block(x,y,z), (x,z) => world?.loaded(x,z));
const joystick = $('#moveJoystick'), knob = joystick.querySelector('i');
let joystickPointer = null, lookPointer = null, lookX = 0, lookY = 0;
const touchMode = () => matchMedia('(pointer:coarse)').matches;
function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(el.timer); el.timer = setTimeout(() => el.classList.remove('show'),3000);
}
let lastLoadingMessage = null;
function loading(message) {
  if (message === lastLoadingMessage) return;
  lastLoadingMessage = message;
  $('#loadingStatus').textContent = message;
  $('#loadingStatus').hidden = !message;
}
function resetInput() {
  clockWasActive=false;
  cancelEating();
  for (const key of Object.keys(keys)) delete keys[key];
  mobileMove.x = mobileMove.y = 0;
  if (joystickPointer !== null && joystick.hasPointerCapture(joystickPointer)) joystick.releasePointerCapture(joystickPointer);
  if (lookPointer !== null && renderer.domElement.hasPointerCapture(lookPointer)) renderer.domElement.releasePointerCapture(lookPointer);
  joystickPointer = lookPointer = null; knob.style.transform = 'translate(-50%,-50%)';
}
function inventoryPanelOpen(){return !$('#backpackPanel').hidden||!$('#craftPanel').hidden||!$('#merchantPanel').hidden;}
function pause() {
  bedSleep=null;
  ranking.setActive(false);
  music.setPlaying(false);
  playing = false; targetOutline.visible=false; miningTask=null; $('#mineProgress').hidden=true; resetInput(); controls.unlock();
  if (!startScreen.classList.contains('active')&&!inventoryPanelOpen()) pauseScreen.classList.add('active');
  saveWorld();
}
function enterWorld() {
  if (!ready) return;
  music.unlock();
  resetInput(); startScreen.classList.remove('active'); pauseScreen.classList.remove('active'); hud.classList.remove('hidden');
  if (touchMode()) playing = true;
  else { try { controls.lock(); } catch { pause(); toast('请点击返回世界以启用鼠标视角'); } }
}
controls.addEventListener('lock', () => { resetInput(); playing = true; pauseScreen.classList.remove('active'); });
controls.addEventListener('unlock', () => { playing = false; music.setPlaying(false); targetOutline.visible=false; resetInput(); if (!startScreen.classList.contains('active')&&!inventoryPanelOpen()) pauseScreen.classList.add('active'); });
document.addEventListener('pointerlockerror', () => { pause(); toast('鼠标视角未启用，请再次点击返回世界'); });
let lastSaveFailure=0;
async function saveWorld(show = false) {
  const savingWorld = world, savingPlayer = loadedPlayer;
  const profile = { goldenHealth,position:snapshotPosition(), inventory: {...inventory}, quickbar:[...quickbar], roomLifeReceipts:[...lifeReceipts].slice(-500), tools:[...ownedTools], toolDurability:{...toolDurability}, hasWorkbench, health, animals:animals?.snapshot()||{}, worldTimeSeconds:worldClock.seconds };
  try {
    // Keep the latest inventory even when terrain upload fails first.
    if(savingWorld&&savingPlayer)await store.backupProfile(savingWorld.id,savingPlayer,profile);
    if (savingWorld) await savingWorld.flush();
    if (savingWorld && savingPlayer) await store.writeProfile(savingWorld.id, savingPlayer, profile);
    if (show) toast(store.local(savingWorld?.id)?'世界与背包已保存到本机':'世界与背包已同步到账号，可以换设备继续玩');
    return true;
  }
  catch { if(show||Date.now()-lastSaveFailure>10000){lastSaveFailure=Date.now();toast('尚未同步成功，请保留当前页面，稍后点击保存世界重试');} return false; }
}
function restoreProfile(saved) {
  let position=saved.position;
  try{const local=JSON.parse(localStorage.getItem(positionKey(world.id))||'null');if(validPosition(local)&&(!validPosition(position)||local.savedAt>position.savedAt))position=local;}catch{}
  if(validPosition(position)){
    pendingPosition={...position};lastSavedPosition={...position};ready=false;spawning=true;
    camera.position.set(position.x,position.y,position.z);camera.rotation.set(position.pitch,position.yaw,0,'YXZ');
    world.updateCenter(position.x,position.z);loading('正在恢复上次离开的位置…');
  }
  lifeReceipts.clear();for(const id of saved.roomLifeReceipts||[])lifeReceipts.add(id);
  quickbar=Array.from({length:6},(_,i)=>BLOCKS.some(b=>b.id===saved.quickbar?.[i])?saved.quickbar[i]:null);
  quickbar=quickbar.map((id,i)=>id&&quickbar.indexOf(id)===i?id:null);
  worldClock.restore(saved.worldTimeSeconds);clockWasActive=false;
  goldenHealth=saved.goldenHealth===true&&Number(saved.health)>100;
  health=Number.isFinite(saved.health)?Math.max(1,Math.min(healthMaximum(),saved.health)):MAX_HEALTH;
  for(const food of FOODS)inventory[food.id]=Math.max(0,Math.floor(Number(saved.inventory?.[food.id])||0));
  animals?.load(saved.animals);selectedFood=null;cancelEating();fallTracker.reset();updateHealth();
  for (const block of BLOCKS) inventory[block.id] = Number(saved.inventory?.[block.id]) || 0;
  ownedTools.clear(); for (const tool of (saved.tools || [])) ownedTools.add(tool); ownedTools.add('none');
  for (const tool of Object.keys(toolDurability)) {
    const cap=tool==='omni50'?50:tool==='omni2'?2:TOOL_MAX_DURABILITY;
    const remaining = Number(saved.toolDurability?.[tool] ?? cap);
    toolDurability[tool] = ownedTools.has(tool) ? Math.max(0, Math.min(cap, Number.isFinite(remaining) ? Math.floor(remaining) : cap)) : 0;
    if(tool==='omni'&&ownedTools.has(tool))toolDurability[tool]=TOOL_MAX_DURABILITY;
    if (toolDurability[tool] === 0) ownedTools.delete(tool);
  }
  hasWorkbench = !!saved.hasWorkbench; equippedTool = 'none';
  updateToolsUI(); updateInventoryUI();
}
function chooseBagMode(id){
  const shared=confirm('使用账号共享物资进入地图吗？\n\n确定：使用已有物资，所有地图同步数量。\n取消：使用本地图独立背包，首次从零开始；已有独立进度会保留。');
  store.bagModes.set(id,shared?'shared':'private');
}
async function switchIsland(next) {
  chooseBagMode(next.id);
  const saved = await store.readProfile(next.id, playerName);
  const selectedWorld = await store.selectFor(playerName, next);
  if (roomId) leaveRoom();
  resetInput(); miningTask = null; $('#mineProgress').hidden = true;
  beginWorld(selectedWorld); restoreProfile(saved);
  $('#mapLobby').classList.remove('active'); startScreen.classList.add('active');
  pauseScreen.classList.remove('active'); hud.classList.add('hidden');
  toast('岛屿已选好，地形准备好后点击“进入方屿”');
}
function beginWorld(next) {
  merchants?.dispose();merchants=null;merchantTarget=null;goldenHealth=false;$('#merchantPanel').hidden=true;
  physics.pushX=physics.pushZ=0;playerTarget=null;
  bedSleep=null;
  pendingPosition=null;lastSavedPosition=null;
  monsters?.dispose();monsterTarget=null;worldClock.restore();clockWasActive=false;clockSaveElapsed=0;respawnGrace=3;
  cancelEating();fallTracker.reset();health=MAX_HEALTH;selectedFood=null;updateHealth();
  animals?.dispose();animalTarget=null;
  for (const drop of drops.splice(0)) {scene.remove(drop.mesh);drop.mesh.geometry.dispose();drop.mesh.material.dispose();}
  world?.dispose(); info = next; world = new ChunkWorld(scene,store,info,BLOCKS,toast);
  animals=new Animals(scene,world);
  merchants=new Merchants(scene,world);
  monsters=new NightMonsters(scene,world);
  ready = false; spawning = true; playing = false; target = null;
  targetOutline.visible=false;
  camera.position.set(.5,25,.5); physics.velocity = 0; physics.grounded = false;
  world.updateCenter(.5,.5); $('#seedLabel').textContent = info.seed;
  $('#worldName').textContent = info.name || ['晨风群岛','青岚平原','晴屿湾','远帆之地'][info.seed % 4];
  $('#startButton').disabled = true; loading('正在准备附近地形…');
}
function updateInventoryUI() {
  quickbar=quickbar.map(id=>inventory[id]>0?id:null);
  for(const block of BLOCKS)if(inventory[block.id]>0&&!quickbar.includes(block.id)&&quickbar.includes(null))quickbar[quickbar.indexOf(null)]=block.id;
  [...$('#hotbar').children].forEach((el,i)=>{
    const block=BLOCKS.find(b=>b.id===quickbar[i]),count=block?Math.max(0,Math.floor(Number(inventory[block.id])||0)):0;
    el.innerHTML=block?`<i style="background:#${block.color.toString(16)}"></i><span>${block.name}</span><em class="item-total">${count}</em>`:'';
    const label=block?`${block.name}，共 ${count} 个（含背包）`:'空物品格';
    el.setAttribute('aria-label',label);el.title=label;el.classList.toggle('active',i===quickSlot);
  });
  selected=BLOCKS.findIndex(b=>b.id===quickbar[quickSlot]);
  const total = Object.values(inventory).reduce((sum, count) => sum + count, 0);
  $('#playerBadge').textContent = `${playerName || '游客'} · 背包 ${total}`;
  const items = $('#backpackItems');
  const totalSlots=bagSlotCount(inventory,quickbar,bagTools()),pages=Math.max(1,Math.ceil(totalSlots/BAG_PAGE_SIZE));
  bagPage=Math.min(bagPage,pages-1);
  const slots=bagLayout(inventory,quickbar,bagTools(),{offset:bagPage*BAG_PAGE_SIZE,limit:BAG_PAGE_SIZE});
  $('#bagPageLabel').textContent=`第 ${bagPage+1} / ${pages} 页`;
  $('#bagPrevious').disabled=bagPage===0;$('#bagNext').disabled=bagPage>=pages-1;
  if(items){items.replaceChildren();for(let i=0;i<Math.max(20,slots.length);i++){
    const slot=slots[i],el=document.createElement('button');el.type='button';el.className='backpack-item';
    const block=slot&&[...BLOCKS,...FOODS].find(b=>b.id===slot.id);
    el.textContent=slot?`${block?.name||TOOL_NAMES[slot.id]||(slot.id==='workbench'?'工作台':slot.id)} ×${slot.count}`:'空格';
    if(slot){const icon=document.createElement('i');icon.className='bag-item-icon';icon.setAttribute('aria-hidden','true');
      if(BLOCKS.some(b=>b.id===slot.id)){icon.style.backgroundColor=`#${block.color.toString(16).padStart(6,'0')}`;icon.classList.add('bag-block-icon');}
      else {icon.textContent=({axe:'🪓',pickaxe:'⛏',shovel:'♠',sword:'⚔',omni:'⚒',omni50:'⚒',omni2:'⚒',goldenApple:'🍎',workbench:'🛠',beef:'🥩',mutton:'🍖'})[slot.id]||'◆';if(slot.id==='goldenApple')icon.style.filter='sepia(1) saturate(5)';}
      el.prepend(icon);
    }
    el.disabled=!slot;el.onclick=()=>{if(slot.tool){if(slot.id==='workbench')$('#openWorkbench').click();else{equippedTool=slot.id;selectedFood=null;cancelEating();updateToolsUI();}}else if(BLOCKS.some(b=>b.id===slot.id)){selectBlock(BLOCKS.findIndex(b=>b.id===slot.id));toast('已拿到快捷栏');}else chooseFood(slot.id);};items.append(el);
  }}
  if ($('#backpackSummary')) $('#backpackSummary').textContent = `背包不限格数 · 已用 ${totalSlots} 格 · 每格最多 100 个。点击方块可拿到快捷栏，更多物品请翻页。`;
  $('#blockStorage').textContent=BLOCKS.filter(b=>inventory[b.id]>0).map(b=>`${b.name}：${inventory[b.id]}（快捷栏 ${quickbar.includes(b.id)?Math.min(100,inventory[b.id]):0}，背包 ${Math.max(0,inventory[b.id]-(quickbar.includes(b.id)?100:0))}）`).join('　')||'还没有方块';
  for(const food of FOODS){const button=$(`[data-food="${food.id}"]`);button.hidden=!(inventory[food.id]>0);button.textContent=food.name;button.classList.toggle('active',selectedFood===food.id);}
}
function updateHealth(){ $('#healthLabel').textContent=`生命 ${health} / ${healthMaximum()}`;$('#healthFill').style.width=`${health/healthMaximum()*100}%`;$('#healthBar').classList.toggle('low-health',health<=25); }
function cancelEating(){eating=null;const ring=$('#eatProgress');if(ring)ring.hidden=true;}
function chooseFood(id){cancelEating();miningTask=null;$('#mineProgress').hidden=true;selectedFood=selectedFood===id?null:id;updateInventoryUI();toast(selectedFood?'已拿出食物，按挖掘吃肉（2 秒）':'已收起食物');}
for(const food of FOODS)$(`[data-food="${food.id}"]`).onclick=()=>chooseFood(food.id);
function openMerchant(){
  $('#merchantPanel').hidden=false;pause();pauseScreen.classList.remove('active');
  $('#merchantStock').textContent=`你有石头 ${inventory.stone||0} 个、原木 ${inventory.wood||0} 个`;
}
$('#closeMerchant').onclick=()=>closeInventoryPanels();
let trading=false;
document.querySelectorAll('[data-trade]').forEach(button=>button.onclick=async()=>{
  if(trading||$('#merchantPanel').hidden)return;
  const id=button.dataset.trade,next=exchange(inventory,id,[...ownedTools]);
  if(!next)return toast('材料不足，或你已持有同款工具（用完后可再兑换）');
  trading=true;document.querySelectorAll('[data-trade]').forEach(b=>b.disabled=true);
  try{
    Object.assign(inventory,next);
    if(id!=='goldenApple'){ownedTools.add(id);toolDurability[id]=id==='omni50'?50:2;}
    updateInventoryUI();updateToolsUI();$('#merchantStock').textContent=`你有石头 ${inventory.stone||0} 个、原木 ${inventory.wood||0} 个`;
    const saved=await saveWorld();toast(saved?'兑换成功，物品已放进背包':'兑换已记入当前背包，但同步未完成，请保留页面并重试保存');
  }finally{trading=false;document.querySelectorAll('[data-trade]').forEach(b=>b.disabled=false);}
});
function tickEating(dt){
  if(!eating)return;
  if(!playing||eating.id!==selectedFood){cancelEating();return;}
  eating.elapsed+=dt;$('#eatProgress').style.setProperty('--eat-progress',`${Math.min(1,eating.elapsed/2)*360}deg`);
  $('#eatProgress span').textContent=`食用中 ${Math.min(100,Math.floor(eating.elapsed/2*100))}%`;
  if(eating.elapsed<2)return;
  if(eating.id==='goldenApple'){
    if((inventory.goldenApple||0)>0&&!goldenHealth){inventory.goldenApple--;goldenHealth=true;health=1000;updateHealth();updateInventoryUI();saveWorld();toast('金苹果生效：生命 1000，降至 100 或以下时效果消失');}cancelEating();return;
  }
  const food=FOODS.find(f=>f.id===eating.id),result=eatFood(health,inventory[eating.id]||0,food,eating.elapsed,healthMaximum());
  if(result){const gained=result.health-health;health=result.health;inventory[food.id]=result.count;updateHealth();updateInventoryUI();saveWorld();toast(`吃完${food.name}，恢复 ${gained} 点血`);}
  cancelEating();
}
function damagePlayer(amount,source='摔落受伤'){
  if(amount<=0||(source==='怪物攻击'&&respawnGrace>0))return;cancelEating();health=Math.max(0,health-amount);if(goldenHealth&&health<=100)goldenHealth=false;updateHealth();toast(`${source}：-${amount} 点血`);
  if(health===0){health=MAX_HEALTH;respawnGrace=3;fallTracker.reset();miningTask=null;$('#mineProgress').hidden=true;spawning=true;ready=false;camera.position.set(.5,25,.5);physics.velocity=0;physics.grounded=false;world.updateCenter(.5,.5);updateHealth();toast('生命耗尽，返回出生点，背包保留');}
  saveWorld();
}
updateHealth();
function spawnDrop(x, y, z, blockId) {
  const block = [...BLOCKS,...FOODS].find(item => item.id === blockId); if (!block) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.34,.34,.34), new THREE.MeshStandardMaterial({ color:block.color, roughness:.72 }));
  mesh.castShadow = true; mesh.position.set(x + .5, y + .55, z + .5); scene.add(mesh);
  const drop={ mesh, type:blockId, baseY: y + .55, phase: Math.random() * Math.PI * 2, vy: 0 };drops.push(drop);return drop;
}
function updateDrops(dt) {
  if (!world) return;
  const p = camera.position;
  for (let i = drops.length - 1; i >= 0; i--) {
    const drop = drops[i], m = drop.mesh;
    drop.phase += dt * 3.2; m.rotation.y += dt * 2.8; m.rotation.x += dt * 1.4;
    if(!world.loaded(m.position.x,m.position.z))continue;
    drop.vy=drop.roomLoot?0:Math.max(-20,drop.vy-dt*9.8);
    const nextY=m.position.y+drop.vy*dt;
    for(let y=Math.floor(m.position.y-.17);y>=Math.floor(nextY-.17);y--){if(world.block(Math.floor(m.position.x),y,Math.floor(m.position.z))){m.position.y=y+1.18;drop.vy=0;break;}}
    if(drop.vy)m.position.y=nextY;
    if (playing && ready && Math.hypot(m.position.x - p.x, m.position.z - p.z) < 1.45 && Math.abs(m.position.y - p.y) < 2.3) {
      const candidate=[...quickbar];if(BLOCKS.some(b=>b.id===drop.type)&&!candidate.includes(drop.type)&&candidate.includes(null))candidate[candidate.indexOf(null)]=drop.type;
      if(!canCollect(inventory,candidate,drop.type,bagTools())){if(!drop.fullNotice){toast('此物品数量已超出安全计数范围，掉落物会留在地上');drop.fullNotice=true;}continue;}
      if(drop.roomLoot){roomLifeClient.command({type:'pickup',loot:drop.roomLoot});continue;}
      inventory[drop.type] = (inventory[drop.type] || 0) + 1;
      scene.remove(m);m.geometry.dispose();m.material.dispose();drops.splice(i, 1); updateInventoryUI(); saveWorld(); toast(`拾取了：${[...BLOCKS,...FOODS].find(b => b.id === drop.type).name}`);
    }
  }
}
function spawn() {
  if(pendingPosition){
    const next=safeResumePosition(pendingPosition,physics);
    if(next===undefined)return;
    if(next){camera.position.set(next.x,next.y,next.z);camera.rotation.set(next.pitch,next.yaw,0,'YXZ');pendingPosition=null;physics.velocity=0;physics.grounded=physics.collides({...next,y:next.y-.001});fallTracker.reset();respawnGrace=3;spawning=false;ready=true;$('#startButton').disabled=false;loading('');return;}
    pendingPosition=null;lastSavedPosition=null;camera.position.set(.5,25,.5);world.updateCenter(.5,.5);toast('上次位置已被堵住，已返回安全出生点');
  }
  if (!world.loaded(0,0)) return;
  for (let x = 0; x < 16; x++) for (let y = HEIGHT - 3; y >= MIN_Y; y--) {
    if (world.block(x,y,0) && !world.block(x,y+1,0) && !world.block(x,y+2,0)) {
      camera.position.set(x+.5,y+1+EYE_HEIGHT,.5); physics.velocity=0; spawning=false; ready=true;
      physics.grounded=true;fallTracker.reset();
      $('#startButton').disabled=false; loading(''); return;
    }
  }
  loading('出生区没有安全落脚处，请生成新世界');
}
function updateTarget() {
  camera.getWorldDirection(direction);
  target = trace(camera.position,direction,(x,y,z)=>world.block(x,y,z),(x,z)=>world.loaded(x,z));
  animalTarget=animals?.target(camera,target?.distance??Infinity);
  monsterTarget=monsters?.target(camera,target?.distance??Infinity);
  merchantTarget=merchants?.target(camera,target?.distance??Infinity);
  playerTarget=null;
  if(roomId&&remotePlayers.size){
    camera.updateMatrixWorld();scene.updateMatrixWorld(true);playerRay.setFromCamera(new THREE.Vector2(),camera);playerRay.far=Math.min(4.5,target?.distance??Infinity);
    const groups=[...remotePlayers.values(),...(animalTarget?[animalTarget.group]:[]),...(monsterTarget?[monsterTarget.group]:[])];
    const hit=playerRay.intersectObjects(groups,true).find(h=>h.object.isMesh);
    if(hit){let object=hit.object;while(object&&!object.userData.remoteClientId)object=object.parent;if(object){playerTarget={id:object.userData.remoteClientId,name:object.userData.playerName};animalTarget=monsterTarget=null;}}
  }
  if(monsterTarget&&animalTarget){if(monsterTarget.group.position.distanceToSquared(camera.position)<animalTarget.group.position.distanceToSquared(camera.position))animalTarget=null;else monsterTarget=null;}
  targetOutline.visible=!!target;
  if(target) targetOutline.position.set(target.x+.5,target.y+.5,target.z+.5);
  if (!miningTask) $('#targetHint').textContent = target ? BLOCKS[target.type-1].name : '';
  if(animalTarget&&!miningTask){targetOutline.visible=false;$('#targetHint').textContent=`${animalTarget.type==='cow'?'牛':'羊'} ${animalTarget.health}/20 · 攻击 -${equippedTool==='sword'?20:5}`;}else if(selectedFood&&!miningTask)$('#targetHint').textContent='按挖掘吃肉 · 2 秒';
  if(monsterTarget&&!miningTask&&!selectedFood){targetOutline.visible=false;$('#targetHint').textContent=`怪物 ${monsterTarget.health}/${MONSTER_HEALTH} · 攻击 -${equippedTool==='sword'?20:5}`;}
  if(target?.type===8&&!animalTarget&&!monsterTarget&&!miningTask&&!selectedFood)$('#targetHint').textContent='床 · 挖掘 5 秒收起 · 放置方块键睡觉';
  if(playerTarget){targetOutline.visible=false;$('#targetHint').textContent=`${playerTarget.name} · 攻击 -${equippedTool==='sword'?20:5} · 击退`;}
  if(merchantTarget&&!playerTarget&&!animalTarget&&!monsterTarget){targetOutline.visible=false;$('#targetHint').textContent='稀有商人 · 点挖掘打开商店';}
}
function sleepInBed(){
  if(!playing||!ready||miningTask||eating||bedSleep)return;
  updateTarget();
  if(target?.type!==8||animalTarget||monsterTarget)return toast('请靠近并对准床');
  if(!worldClock.night)return toast('时钟到晚上才能睡觉');
  if(roomId&&(!roomLifeClient.received||roomLifeClient.commands.length))return toast('正在同步房间，请稍后再睡');
  bedSleep={elapsed:0,bed:{x:target.x,y:target.y,z:target.z},yaw:camera.rotation.y};
  resetInput();targetOutline.visible=false;toast('躺下休息…');
}
function tickBedSleep(dt){
  if(!bedSleep)return;
  if(!playing||!ready||world.block(bedSleep.bed.x,bedSleep.bed.y,bedSleep.bed.z)!==8){bedSleep=null;resetInput();return;}
  bedSleep.elapsed+=dt;
  if(roomId)return; // The server alone completes multiplayer sleep.
  $('#targetHint').textContent=`正在睡觉 · ${Math.max(0,Math.ceil(10-bedSleep.elapsed))} 秒后天亮`;
  if(bedSleep.elapsed<10)return;
  const bed=bedSleep.bed;bedSleep=null;resetInput();physics.velocity=0;fallTracker.reset();
  worldClock.restore(nextMorning(worldClock.seconds));darkness=0;saveWorld();toast('睡了个好觉，已起身，现在是早上 08:00');
}
function renderBedSleep(){
  // Move only the rendered camera. Physics, network coordinates and saves
  // retain the player's standing position, including if the tab is closed.
  if(!bedSleep){renderer.render(scene,camera);return;}
  const position=camera.position.clone(),quaternion=camera.quaternion.clone();
  const blend=Math.min(1,bedSleep.elapsed/.35);
  camera.position.lerp(new THREE.Vector3(bedSleep.bed.x+.5,bedSleep.bed.y+.9,bedSleep.bed.z+.5),blend);
  camera.rotation.set(1.15*blend,bedSleep.yaw,.18*blend,'YXZ');
  try{renderer.render(scene,camera);}finally{camera.position.copy(position);camera.quaternion.copy(quaternion);}
}
function consumeSwordUse() {
  if(equippedTool!=='sword')return;
  toolDurability.sword=Math.max(0,toolDurability.sword-1);
  if(!toolDurability.sword){ownedTools.delete('sword');equippedTool='none';toast('石剑耐久耗尽，已切换为空手');}
  updateToolsUI();
}
function miningDuration(blockId) {
  if (equippedTool !== 'none' && !ownedTools.has(equippedTool)) equippedTool = 'none';
  if(['omni','omni50','omni2'].includes(equippedTool))return .1;
  return TOOL_MINE_TIMES[equippedTool]?.[blockId] ?? MINE_TIMES[blockId] ?? 3;
}
function startMining() {
  if(bedSleep)return;
  if (!playing || miningTask || eating) return;
  updateTarget();if(merchantTarget&&!playerTarget&&!animalTarget&&!monsterTarget){openMerchant();return;}
  if(selectedFood){if(selectedFood==='goldenApple'?goldenHealth:health>=healthMaximum())return toast('当前不需要食用');if(!(inventory[selectedFood]>0))return toast('没有这种食物');eating={id:selectedFood,elapsed:0};$('#eatProgress').hidden=false;$('#eatProgress').style.setProperty('--eat-progress','0deg');return;}
  updateTarget();
  if(roomId&&playerTarget){roomLifeClient.command({type:'hitPlayer',player:playerTarget.id,tool:equippedTool});return;}
  if(roomId&&monsterTarget){roomLifeClient.command({type:'hit',monster:monsterTarget.id,tool:equippedTool});return;}
  if(monsterTarget){if(performance.now()-lastAnimalHit<350)return;lastAnimalHit=performance.now();const loot=monsters.hit(monsterTarget,equippedTool==='sword'?20:5,camera.position)||[];for(const item of loot)spawnDrop(item.x,item.y,item.z,item.type);toast(monsterTarget.health?`怪物剩余 ${monsterTarget.health} 点血`:'已击败怪物，靠近拾取掉落物资');consumeSwordUse();saveWorld();return;}
  if(animalTarget){if(performance.now()-lastAnimalHit<350)return;lastAnimalHit=performance.now();const animal=animalTarget,drop=animals.hit(animal,equippedTool==='sword'?20:5,camera.position);if(drop)spawnDrop(drop.x-.5,drop.y,drop.z-.5,drop.type);toast(drop?'已击败，靠近掉落的肉即可拾取':`${animal.type==='cow'?'牛':'羊'}剩余 ${animal.health} 点血`);consumeSwordUse();saveWorld();return;}
  if(equippedTool==='sword')return toast('石剑只能攻击生物，不能挖掘方块；请切换为空手或其他工具');
  updateTarget(); if (!target) return toast('请瞄准要挖掘的方块');
  const block = BLOCKS[target.type - 1]; if (!block || target.y <= MIN_Y) return toast('已经到达地下最底层，基岩无法挖掘');
  miningTask = { x:target.x, y:target.y, z:target.z, type:block.id, elapsed:0, duration:miningDuration(block.id) };
  $('#targetHint').textContent = `挖掘 ${block.name} · 0%`;
  $('#mineProgress').hidden = false; $('#mineProgress i').style.width = '0%'; $('#mineProgress span').textContent = `挖掘中 0% · ${miningTask.duration}秒`;
}
function tickMining(dt) {
  if (!miningTask || !world) return;
  const task = miningTask; task.elapsed += dt;
  const percent = Math.min(100, Math.floor(task.elapsed / task.duration * 100));
  $('#targetHint').textContent = `挖掘 ${BLOCKS.find(block => block.id === task.type)?.name || ''} · ${percent}%`;
  $('#mineProgress i').style.width = `${percent}%`; $('#mineProgress span').textContent = `挖掘中 ${percent}% · ${Math.max(0, task.duration - task.elapsed).toFixed(1)}秒`;
  if (task.elapsed < task.duration) return;
  miningTask = null;
  $('#mineProgress').hidden = true;
  if (world.block(task.x, task.y, task.z) === BLOCKS.findIndex(block => block.id === task.type) + 1 && world.edit(task.x, task.y, task.z, null)) {
    if (equippedTool !== 'none' && equippedTool !== 'omni') {
      toolDurability[equippedTool] = Math.max(0, (toolDurability[equippedTool] || 0) - 1);
      if (toolDurability[equippedTool] === 0) { ownedTools.delete(equippedTool); toast(`${TOOL_NAMES[equippedTool]}耐久耗尽，工具损坏了`); equippedTool = 'none'; updateToolsUI(); }
      else updateToolsUI();
    }
    spawnDrop(task.x, task.y, task.z, task.type);
    sendRoomEdit(task.x, task.y, task.z, null);
    toast(`已挖掘：${BLOCKS.find(block => block.id === task.type).name}，靠近掉落方块即可拾取`);
  }
  updateTarget();
}
function editTarget(place) {
  if(bedSleep)return;
  if (!playing || !world) return;
  if (!place) return startMining();
  updateTarget();
  if(target?.type===8&&!animalTarget&&!monsterTarget)return sleepInBed();
  if(selected<0)return toast('请先从背包或快捷栏选择方块');
  if(selectedFood)return toast('肉不能放置，按挖掘吃肉，或先选择方块');
  updateTarget(); if (!target) return toast('请靠近方块，并用屏幕中央的准星瞄准它');
  let {x,y,z} = target;
  if (place) {
    const selectedBlock = BLOCKS[selected];
    if ((inventory[selectedBlock.id] || 0) < 1) return toast(`背包里没有${selectedBlock.name}，先挖一个吧`);
    x += target.normal.x; y += target.normal.y; z += target.normal.z;
    if (!world.loaded(x,z)) return toast('附近地形正在加载');
    const p = camera.position;
    if (p.x+RADIUS>x && p.x-RADIUS<x+1 && p.z+RADIUS>z && p.z-RADIUS<z+1 && p.y>y && p.y-EYE_HEIGHT<y+1)
      return toast('这里不能放置方块');
    if (y>=HEIGHT) return toast('已达到 100 格建造高度上限');
    if (y<=MIN_Y || world.block(x,y,z)) return toast('这里不能放置方块');
    if(BLOCKS[selected].id==='bed'&&!world.block(x,y-1,z))return toast('床需要放在有支撑的地面上');
  }
  const removed = BLOCKS[target.type - 1];
  if(world.edit(x,y,z,place ? BLOCKS[selected].id : null)) {
    if (place) { inventory[BLOCKS[selected].id]--; sendRoomEdit(x, y, z, BLOCKS[selected].id); toast(`已放置：${BLOCKS[selected].name}`); updateInventoryUI(); saveWorld(); }
  }
  updateTarget();
}
function selectBlock(index) {
  selectedFood=null;cancelEating();
  const nextSelected = (index + BLOCKS.length) % BLOCKS.length;
  const id=BLOCKS[nextSelected].id;if(!(inventory[id]>0))return;
  if(quickbar.includes(id))quickSlot=quickbar.indexOf(id);else {
    const next=[...quickbar];next[quickSlot]=id;
    quickbar=next;
  }
  selected=nextSelected;
  updateInventoryUI();
  for(const button of document.querySelectorAll('[data-food]'))button.classList.remove('active');
}
Array.from({length:6}).forEach((_,i)=>{
  const button=document.createElement('button'); button.className='slot'; button.type='button';
  button.onclick=()=>{quickSlot=i;const index=BLOCKS.findIndex(b=>b.id===quickbar[i]);if(index>=0)selectBlock(index);else updateInventoryUI();}; $('#hotbar').appendChild(button);
});
selectBlock(0);
updateInventoryUI();
function updateToolsUI() {
  document.querySelectorAll('#toolbelt [data-tool]').forEach(button => {
    const tool = button.dataset.tool; button.hidden = tool !== 'none' && !ownedTools.has(tool);
    button.classList.toggle('active', tool === equippedTool);
    if (tool !== 'none') button.textContent = tool==='omni'?`${TOOL_NAMES[tool]} ∞`:`${TOOL_NAMES[tool]} ${toolDurability[tool] || 0}/${tool==='omni50'?50:tool==='omni2'?2:TOOL_MAX_DURABILITY}`;
  });
  document.querySelectorAll('#craftPanel [data-craft]').forEach(button => {
    const craft = button.dataset.craft;
    const recipe = TOOL_RECIPES[craft];
    button.disabled = craft === 'workbench' ? hasWorkbench || Object.entries(WORKBENCH_RECIPE).some(([id, count]) => (inventory[id] || 0) < count) : !hasWorkbench || ownedTools.has(craft) || Object.entries(recipe || {}).some(([id, count]) => (inventory[id] || 0) < count);
    if (craft !== 'workbench') { const recipe = TOOL_RECIPES[craft] || {}; const materials = Object.entries(recipe).map(([id,count]) => `${id === 'dirt' ? '泥土' : id === 'wood' ? '原木' : id === 'leaves' ? '树叶' : '石头'}×${count}`).join(' + '); button.textContent = `制作${TOOL_NAMES[craft]}（${materials}）`; }
  });
  $('#workbenchButton').classList.toggle('active', hasWorkbench);
}
document.querySelectorAll('#toolbelt [data-tool]').forEach(button => button.onclick = () => { if (!ownedTools.has(button.dataset.tool)) return toast('请先在工作台制作这个工具'); miningTask=null;$('#mineProgress').hidden=true;selectedFood=null;cancelEating();equippedTool = button.dataset.tool; updateInventoryUI();updateToolsUI(); toast(equippedTool === 'none' ? '已切换为空手' : `已装备${button.textContent}`); });
function openInventoryPanel(panel){$('#merchantPanel').hidden=true;$('#backpackPanel').hidden=panel!=='backpack';$('#craftPanel').hidden=panel!=='craft';pause();pauseScreen.classList.remove('active');updateInventoryUI();updateToolsUI();}
function closeInventoryPanels(){$('#backpackPanel').hidden=true;$('#craftPanel').hidden=true;$('#merchantPanel').hidden=true;pauseScreen.classList.remove('active');enterWorld();}
const openWorkbenchPanel = () => { if(!$('#craftPanel').hidden)closeInventoryPanels();else openInventoryPanel('craft'); };
$('#workbenchButton').onclick = openWorkbenchPanel;
$('#openWorkbench').onclick = () => openInventoryPanel('craft');
$('#backpackButton').onclick=()=>openInventoryPanel('backpack');
$('#closeBackpack').onclick = closeInventoryPanels;
$('#bagPrevious').onclick=()=>{bagPage=Math.max(0,bagPage-1);updateInventoryUI();};
$('#bagNext').onclick=()=>{bagPage++;updateInventoryUI();};
$('#closeCraft').onclick=closeInventoryPanels;
$('#craftBed').onclick=()=>{
  if(!hasWorkbench)return toast('请先制作工作台');
  if((inventory.cotton||0)<3||(inventory.wood||0)<3)return toast('需要 3 个棉花和 3 个原木');
  const next={...inventory,cotton:inventory.cotton-3,wood:inventory.wood-3,bed:(inventory.bed||0)+1};
  Object.assign(inventory,next);updateInventoryUI();saveWorld();toast('制作完成：床。拿到快捷栏后放到地上，晚上挖掘床即可睡觉');
};
document.querySelectorAll('#craftPanel [data-craft]').forEach(button => button.onclick = () => {
  const craft = button.dataset.craft;
  if (craft === 'workbench') {
    const materials = WORKBENCH_RECIPE;
    if (hasWorkbench) return toast('你已经有工作台了');
    if (Object.entries(materials).some(([id, count]) => (inventory[id] || 0) < count)) return toast('材料不足：需要 5 个石头和 5 个原木');
    const after={...inventory};for(const [id,count] of Object.entries(materials))after[id]-=count;
    for (const [id, count] of Object.entries(materials)) inventory[id] -= count;
    hasWorkbench = true; toast('工作台制作完成，材料已消耗');
  }
  else if (!hasWorkbench) return toast('先制作工作台');
  else {
    const recipe = TOOL_RECIPES[craft];
    if(ownedTools.has(craft))return toast('已经拥有这个工具');
    if (!recipe || Object.entries(recipe).some(([id, count]) => (inventory[id] || 0) < count)) return toast('材料不足，无法制作这个工具');
    const after={...inventory};for(const [id,count] of Object.entries(recipe))after[id]-=count;
    for (const [id, count] of Object.entries(recipe)) inventory[id] -= count;
    ownedTools.add(craft); toolDurability[craft] = TOOL_MAX_DURABILITY;
    toast(`制作完成：${TOOL_NAMES[craft]}（${TOOL_MAX_DURABILITY}耐久）`);
  }
  updateInventoryUI(); updateToolsUI(); saveWorld();
});
updateToolsUI();
document.addEventListener('keydown', e => {
  if (!playing) return;
  if (['Space','KeyW','KeyA','KeyS','KeyD'].includes(e.code)) e.preventDefault();
  keys[e.code]=true;
  if (e.code==='Space' && !e.repeat) physics.jump();
  if ((e.code==='KeyQ' || e.code==='KeyE') && !e.repeat) { e.preventDefault(); editTarget(e.code==='KeyE'); }
  if (e.code==='Escape') pause();
  if (/^Digit[1-6]$/.test(e.code)) $('#hotbar').children[Number(e.code.slice(5))-1].click();
  if(!e.repeat&&e.code==='Digit7')chooseFood('beef');
  if(!e.repeat&&e.code==='Digit8')chooseFood('mutton');
});
document.addEventListener('keyup',e=>{delete keys[e.code];});
document.addEventListener('pointercancel',resetInput);
renderer.domElement.addEventListener('pointerdown',e=>{
  if (!playing) return;
  if (e.pointerType==='mouse') { if (controls.isLocked && (e.button===0 || e.button===2)) editTarget(e.button===2); return; }
  if (lookPointer!==null || e.clientX<innerWidth*.38) return;
  e.preventDefault(); lookPointer=e.pointerId; lookX=e.clientX; lookY=e.clientY;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove',e=>{
  if (!playing || e.pointerId!==lookPointer) return;
  camera.rotation.y-=(e.clientX-lookX)*.0045;
  camera.rotation.x=THREE.MathUtils.clamp(camera.rotation.x-(e.clientY-lookY)*.0038,-1.45,1.45);
  lookX=e.clientX; lookY=e.clientY;
});
const releaseLook=e=>{if(e.pointerId===lookPointer) lookPointer=null;};
for (const name of ['pointerup','pointercancel','lostpointercapture']) renderer.domElement.addEventListener(name,releaseLook);
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
renderer.domElement.addEventListener('wheel',e=>{if(playing){e.preventDefault();$('#hotbar').children[(quickSlot+Math.sign(e.deltaY)+6)%6].click();}}, {passive:false});
function updateJoystick(e) {
  const r=joystick.getBoundingClientRect(), limit=r.width*.32;
  let x=e.clientX-r.left-r.width/2, y=e.clientY-r.top-r.height/2;
  const length=Math.hypot(x,y); if(length>limit){x=x/length*limit;y=y/length*limit;}
  const magnitude=Math.hypot(x,y)/limit;
  mobileMove.x=magnitude<.08?0:x/limit; mobileMove.y=magnitude<.08?0:y/limit;
  knob.style.transform=`translate(calc(-50% + ${x}px),calc(-50% + ${y}px))`;
}
joystick.addEventListener('pointerdown',e=>{
  e.preventDefault(); if(!playing || joystickPointer!==null) return;
  joystickPointer=e.pointerId; joystick.setPointerCapture(e.pointerId); updateJoystick(e);
});
joystick.addEventListener('pointermove',e=>{if(playing && e.pointerId===joystickPointer) updateJoystick(e);});
function releaseJoystick(e){if(e.pointerId!==joystickPointer)return;joystickPointer=null;mobileMove.x=mobileMove.y=0;knob.style.transform='translate(-50%,-50%)';}
for (const name of ['pointerup','pointercancel','lostpointercapture']) joystick.addEventListener(name,releaseJoystick);
$('#mobileJump').addEventListener('pointerdown',e=>{e.preventDefault();if(playing)physics.jump();});
$('#mobileBreak').addEventListener('pointerdown',e=>{e.preventDefault();editTarget(false);});
$('#mobilePlace').addEventListener('pointerdown',e=>{e.preventDefault();editTarget(true);});
// Keyboard/screen-reader activation has no pointerdown; avoid duplicating touch clicks.
$('#mobileBreak').addEventListener('click',e=>{if(e.detail===0)editTarget(false);});
$('#mobilePlace').addEventListener('click',e=>{if(e.detail===0)editTarget(true);});
$('#startButton').onclick=enterWorld; $('#resumeButton').onclick=enterWorld; $('#pauseButton').onclick=pause;
$('#saveButton').onclick=()=>saveWorld(true);
let lobbyWorlds = [], mapPage = 0, mapListRequest = 0;
const MAP_PAGE_SIZE = 30;
function renderMapList() {
  const list = $('#mapList'), query = $('#mapSearchInput').value.trim().toLocaleLowerCase();
  const matches = lobbyWorlds.map((item, index) => ({item,index})).filter(({item}) => (item.name || '我的岛屿').toLocaleLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(matches.length / MAP_PAGE_SIZE));
  mapPage = Math.max(0, Math.min(mapPage, pages - 1));
  $('#mapResultCount').textContent = `共 ${lobbyWorlds.length} 个地图${query ? ` · 找到 ${matches.length} 个` : ''}`;
  $('#mapPageLabel').textContent = `${mapPage + 1} / ${pages} 页`;
  $('#previousMapPage').disabled = mapPage === 0;
  $('#nextMapPage').disabled = mapPage >= pages - 1;
  list.replaceChildren();
  if (!matches.length) list.textContent = query ? '没有找到这个名字的地图，试试部分名称或清空搜索。' : '还没有保存的岛屿，请新建一个';
  matches.slice(mapPage * MAP_PAGE_SIZE, (mapPage + 1) * MAP_PAGE_SIZE).forEach(({item,index}) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `map-entry ${item.id === info?.id ? 'active' : ''}`;
    const title = document.createElement('b'), detail = document.createElement('small');
    title.textContent = `${index + 1}. ${item.name || '我的岛屿'}`;
    detail.textContent = `${item.id === info?.id ? '当前岛屿 · 继续玩' : '选择此岛屿'} · 种子 ${item.seed}`;
    button.append(title, detail); list.append(button);
    button.onclick = async () => {
      if (switchingWorld) return;
      switchingWorld = true; button.disabled = true;
      try { if (await saveWorld()) await switchIsland(item); }
      catch (error) { toast(`岛屿读取失败：${error.message}，原地图未删除`); }
      finally { switchingWorld = false; button.disabled = false; }
    };
  });
}
function searchMaps() { mapPage = 0; renderMapList(); }
$('#mapSearchForm').onsubmit = e => { e.preventDefault(); searchMaps(); };
$('#mapSearchInput').oninput = searchMaps;
$('#clearMapSearch').onclick = () => { $('#mapSearchInput').value = ''; searchMaps(); $('#mapSearchInput').focus(); };
for (const [id, delta] of [['previousMapPage', -1], ['nextMapPage', 1]]) $( `#${id}`).onclick = () => { mapPage += delta; renderMapList(); $('.map-lobby-body').scrollTop = 0; };
async function refreshMapList() {
  const list = $('#mapList'); if (!playerName) { list.innerHTML = '<small>请先登录后查看你的地图</small>'; return; }
  try {
    const request = ++mapListRequest;
    $('#mapResultCount').textContent = '正在读取地图…';
    const worlds = await store.listFor(playerName);
    if (request !== mapListRequest) return;
    lobbyWorlds = worlds; renderMapList();
  } catch { list.innerHTML = '<small>地图列表读取失败</small>'; }
}
$('#lobbyButton').onclick = () => { pause(); $('#mapLobby').classList.add('active'); $('#mapNameInput').value = info?.name || ''; refreshMapList(); };
$('#closeLobby').onclick = () => $('#mapLobby').classList.remove('active');
$('#uploadLocalWorlds').onclick=async()=>{
  const button=$('#uploadLocalWorlds');button.disabled=true;
  try{if(!store.cloud)throw Error('请先登录');const count=await store.importLocal();await refreshMapList();toast(count?`已上传 ${count} 个旧地图，请在地图大厅选择`:'此网址没有尚未上传的旧地图；旧 IP 的地图需要从原网址读取');}
  catch(error){toast(`上传未完成：${error.message}，原本机存档未删除`);}finally{button.disabled=false;}
};
async function collectWorldEdits(limit = 8000) {
  const max = Math.max(1, Math.min(8000, Math.floor(Number(limit) || 8000))), merged = new Map();
  const add = edit => {
    const x = Number(edit?.x), y = Number(edit?.y), z = Number(edit?.z);
    if (![x, y, z].every(Number.isFinite) || !Number.isSafeInteger(Math.floor(x)) || !Number.isSafeInteger(Math.floor(y)) || !Number.isSafeInteger(Math.floor(z))) return;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    if (iy <= MIN_Y || iy >= HEIGHT) return;
    const block = edit?.block == null ? null : BLOCKS.some(item => item.id === edit.block) ? edit.block : null;
    if (edit?.block != null && block == null) return;
    const key = `${ix},${iy},${iz}`;
    // Loaded chunks are overlaid after the IndexedDB snapshot, so unsaved
    // in-memory changes always win if a write is still in flight.
    if (merged.has(key) || merged.size < max) merged.set(key, block);
  };
  if (!world) return [];
  try { await world.flush(); } catch { /* the in-memory overlay is still usable */ }
  if (typeof store.readAllEdits === 'function') {
    try { for (const edit of await store.readAllEdits(world.id, max)) add(edit); } catch { /* private/local preview may have no IDB */ }
  }
  for (const chunk of world.chunks.values()) for (const [key, block] of Object.entries(chunk.edits || {})) {
    const [x, y, z] = key.split(',').map(Number); add({x, y, z, block});
  }
  return [...merged.entries()].map(([key, block]) => { const [x,y,z] = key.split(',').map(Number); return {x,y,z,block}; });
}
function roomWorldStorageId(id, worldMeta) {
  const room = String(id || 'room').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'room';
  const instance = String(worldMeta?.instanceId || worldMeta?.id || worldMeta?.seed || 'shared').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'shared';
  return `room-${room}-${instance}`.slice(0, 96);
}
function queueRoomEdits(edits, revision = null) {
  if (!Array.isArray(edits)) return;
  const incomingRevision = Number(revision);
  if (Number.isFinite(incomingRevision) && incomingRevision < roomEditRevision) return;
  if (Number.isFinite(incomingRevision)) roomEditRevision = incomingRevision;
  for (const edit of edits) {
    const x = Number(edit?.x), y = Number(edit?.y), z = Number(edit?.z);
    if (![x, y, z].every(Number.isFinite)) continue;
    const block = edit?.block == null ? null : BLOCKS.some(item => item.id === edit.block) ? edit.block : null;
    if (edit?.block != null && block == null) continue;
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    roomEdits.set(key, block);
  }
  const pending = [];
  for (const [key, block] of roomEdits.entries()) {
    const [x,y,z] = key.split(',').map(Number), desired = block ? BLOCKS.findIndex(item => item.id === block) + 1 : 0;
    if (!world || !world.loaded(x, z) || world.block(x, y, z) !== desired) pending.push({x,y,z,block});
  }
  pendingRoomEdits = pending;
}
function applyPendingRoomEdits() {
  if (!world || !pendingRoomEdits.length) return;
  const remaining = [];
  let applied = 0;
  for (let index = 0; index < pendingRoomEdits.length; index++) {
    const edit = pendingRoomEdits[index];
    if (applied >= 32) { remaining.push(...pendingRoomEdits.slice(index)); break; }
    if (!world.loaded(edit.x, edit.z)) { remaining.push(edit); continue; }
    const desired = edit.block ? BLOCKS.findIndex(block => block.id === edit.block) + 1 : 0;
    if (world.block(edit.x, edit.y, edit.z) !== desired) { if (world.edit(edit.x, edit.y, edit.z, edit.block)) applied++; }
  }
  pendingRoomEdits = remaining;
}
function localRoomPosition() {
  return {x:camera.position.x, y:camera.position.y, z:camera.position.z,
    yaw:camera.rotation.y, pitch:camera.rotation.x, grounded:!!physics.grounded,
    moving:!!(keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD || Math.hypot(mobileMove.x, mobileMove.y) > .05), ready:!!ready};
}
function remoteAvatarTarget(remote) {
  const pos = remote?.position || {};
  const x = Number.isFinite(Number(pos.x)) ? Number(pos.x) : 0;
  const z = Number.isFinite(Number(pos.z)) ? Number(pos.z) : 0;
  let feetY = Number.isFinite(Number(pos.y)) ? Number(pos.y) - EYE_HEIGHT : 0;
  // New clients report grounded; for an older client infer it from the
  // nearby floor.  This keeps avatars planted when one map has just streamed
  // in, while still allowing a jumping player to move freely in the air.
  const grounded = pos.grounded !== false;
  if (grounded) {
    const floor = remoteGroundY(x, z, feetY);
    if (floor != null && Math.abs(floor - feetY) <= 4.5) feetY = floor;
  }
  return {x, y:feetY, z, yaw:Number.isFinite(Number(pos.yaw)) ? Number(pos.yaw) : 0,
    moving:!!pos.moving || pos.grounded === false, ready:pos.ready !== false};
}
function roomWorldInfo(data) {
  const worldMeta = data?.world && typeof data.world === 'object' ? data.world : (data || {});
  const seed = Number(worldMeta.seed), hostClientId = String(data?.hostClientId || worldMeta.hostClientId || '');
  const isHost = worldMeta.owner ? worldMeta.owner===playerName && worldMeta.id===info?.id : hostClientId ? hostClientId === roomClientId : Number.isFinite(seed) && seed === Number(info?.seed);
  return {worldMeta, seed, hostClientId, isHost, sharedId:roomWorldStorageId(roomId, worldMeta)};
}
async function adoptRoomWorld(data) {
  const meta = roomWorldInfo(data);
  if (meta.isHost || !Number.isFinite(meta.seed)) return meta;
  const sameSharedWorld = info?.sharedRoom === roomId && info?.id === meta.sharedId && Number(info?.seed) === Math.floor(meta.seed);
  if (!sameSharedWorld) {
    chooseBagMode(meta.sharedId);
    const saved=await store.readProfile(meta.sharedId,playerName);
    roomEdits = new Map(); pendingRoomEdits = []; roomEditRevision = 0;
    beginWorld({id:meta.sharedId, seed:Math.max(1,Math.floor(meta.seed)), name:meta.worldMeta.name || meta.worldMeta.worldName || '组队地图', version:2, created:Date.now(), sharedRoom:roomId, sharedInstance:meta.worldMeta.instanceId || null});
    restoreProfile(saved);
    loading('正在载入房主地图…');
  } else if (!ready) loading('正在载入房主地图…');
  return meta;
}
async function joinRoom(requested) {
  requested = String(requested || '').replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(requested)) return toast('请输入 6 位数字房间号');
  if (!playerName || !playerToken) return toast('组队需要在线登录账号，请重新登录后加入');
  if (roomJoinPending) return;
  roomJoinPending = true;
  const roomButtons = [$('#createRoomButton'), $('#joinRoomButton')]; roomButtons.forEach(button => { if (button) button.disabled = true; });
  if (roomId && roomId !== requested) leaveRoom();
  const joinGeneration = roomSyncGeneration;
  try {
    const outgoingWorld = {id:info?.id, seed:info?.seed, name:info?.name || '组队地图',time:worldClock.seconds};
    if(!await saveWorld())throw Error('背包尚未保存，请重试后加入房间');
    const outgoingEdits = await collectWorldEdits();
    const response = await fetch('/api/blockworld/room/join', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({room:requested,name:playerName,token:playerToken,clientId:roomClientId,world:outgoingWorld,edits:outgoingEdits,position:localRoomPosition()})
    });
    const data = await response.json(); if (!response.ok) throw Error(data.error || '加入房间失败');
    if (joinGeneration !== roomSyncGeneration) return;
    roomId = data.room; roomClientId = data.clientId; roomActionCursor = data.actions?.length || 0;
    monsters?.clear();roomLifeClient.reset();
    const meta = roomWorldInfo(data);
    roomEdits = new Map(); pendingRoomEdits = []; roomEditRevision = 0;
    await adoptRoomWorld(data);
    queueRoomEdits(data.edits || data.snapshot || [], data.revision);
    $('#roomCodeDisplay').textContent = roomId;
    const players = Array.isArray(data.players) ? data.players : [];
    const mapName = meta.worldMeta.name || meta.worldMeta.worldName || '组队地图';
    $('#roomStatus').textContent = `房间 ${roomId}：${players.map(p => p.name).join('、')} · 共用「${mapName}」（${players.length}/4）`;
    toast(meta.isHost ? `已创建房间 ${roomId}，这是共享地图` : `已加入房间 ${roomId}，正在使用房主地图`);
  } catch (error) { $('#roomStatus').textContent = error.message; }
  finally { roomJoinPending = false; roomButtons.forEach(button => { if (button) button.disabled = false; }); }
}
$('#roomCodeInput').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); $('#roomCodeDisplay').textContent = event.target.value || '------'; });
$('#joinRoomButton').onclick = () => joinRoom($('#roomCodeInput').value);
$('#createRoomButton').onclick = () => {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  $('#roomCodeInput').value = code; $('#roomCodeDisplay').textContent = code; joinRoom(code);
};
async function syncRoom(force = false) {
  if (!roomId || !roomClientId || !playerName || !playerToken || roomJoinPending || roomSyncPending || (!force && roomSyncClock < .8)) return;
  roomSyncClock = 0;
  roomSyncPending = true;
  const activeRoom = roomId, activeClient = roomClientId, syncGeneration = roomSyncGeneration;
  try {
    const response = await fetch('/api/blockworld/room/state', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({room:activeRoom,clientId:activeClient,name:playerName,token:playerToken,position:localRoomPosition()})});
    if (!response.ok) { if (response.status === 404 || response.status === 401) { toast('房间已结束，请重新输入房间号'); resetRoomState(); } return; }
    const data = await response.json();
    if (roomId !== activeRoom || roomClientId !== activeClient) return;
    const visibleIds = new Set();
    for (const remote of (data.players || [])) {
      if (remote.clientId === roomClientId) continue;
      const target = remoteAvatarTarget(remote);
      if (!target.ready) continue; // hide the reset-at-25m loading pose
      visibleIds.add(remote.clientId); let avatar = remotePlayers.get(remote.clientId);
      if (!avatar || avatar.userData.playerName !== remote.name) {
        if (avatar) { scene.remove(avatar); disposeRemoteAvatar(avatar); }
        avatar = makeRemoteAvatar(remote.name);avatar.userData.remoteClientId=remote.clientId; scene.add(avatar); remotePlayers.set(remote.clientId, avatar);
      }
      avatar.userData.target.set(target.x, target.y, target.z); avatar.userData.targetYaw = target.yaw; avatar.userData.moving = target.moving;
      // Place a newly created avatar immediately; subsequent updates are
      // interpolated in updateRemoteAvatars for a natural walk instead of
      // teleporting every network tick.
      if (!avatar.userData.synced) { avatar.position.copy(avatar.userData.target); avatar.rotation.y = target.yaw; avatar.userData.synced = true; }
    }
    for (const [id, avatar] of remotePlayers) if (!visibleIds.has(id)) { scene.remove(avatar); disposeRemoteAvatar(avatar); remotePlayers.delete(id); }
    queueRoomEdits(data.edits || data.snapshot || [], data.revision);
    const meta = await adoptRoomWorld(data);
    const mapName = meta.worldMeta.name || meta.worldMeta.worldName || '组队地图';
    $('#roomStatus').textContent = `房间 ${roomId}：${(data.players || []).map(p => p.name).join('、')} · 共用「${mapName}」（${(data.players || []).length}/4）`;
    const actions = data.actions || [];
    for (const action of actions.slice(roomActionCursor)) if (action.by !== playerName && action.type === 'edit') {
      if (world?.loaded(action.x, action.z)) world.edit(action.x, action.y, action.z, action.block || null);
      toast(`${action.by} ${action.block ? '放置了方块' : '挖掘了方块'}`);
    }
    roomActionCursor = actions.length;
  } catch { /* temporary network loss; local play continues */ }
  finally { if (syncGeneration === roomSyncGeneration) roomSyncPending = false; }
}
function sendRoomEdit(x, y, z, block) {
  if (!roomId || !roomClientId || !playerToken) return;
  const key = `${Math.floor(Number(x))},${Math.floor(Number(y))},${Math.floor(Number(z))}`;
  roomEdits.set(key, block == null ? null : block);
  fetch('/api/blockworld/room/state', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:roomId,clientId:roomClientId,name:playerName,token:playerToken,position:localRoomPosition(),edits:[{x,y,z,block}]})}).catch(() => {});
}
$('#renameMapButton').onclick = async () => {
  if (!info) return; const name = $('#mapNameInput').value.trim(); if (!name) return toast('请输入地图名称');
  try { const updated = await store.rename(info.id, name); if (updated) { info = updated; if (world) world.info = updated; $('#worldName').textContent = name; $('#mapNameInput').value = ''; toast(`地图已命名：${name}`); refreshMapList(); } }
  catch { toast('地图名称保存失败'); }
};
$('#homeButton').onclick=()=>{leaveRoom();startScreen.classList.add('active');pause();hud.classList.add('hidden');pauseScreen.classList.remove('active');};
$('#newWorldButton').onclick=async()=>{
  if (!playerName) return toast('请先登录，再新建自己的岛屿');
  if (switchingWorld) return;
  const name = prompt('给新岛屿起个名字（旧岛屿会保留在大厅）', '新的岛屿');
  if (name === null) return;
  switchingWorld = true;
  $('#newWorldButton').disabled=true;
  try {
    if (!store.db) await store.open();
    if (!await saveWorld()) return;
    const next = await store.create(playerName, name);
    await switchIsland(next);
  } catch (error) { console.error(error); toast(`新世界创建失败：${error?.message || '请允许浏览器使用本地存储'}`); }
  finally { switchingWorld = false; $('#newWorldButton').disabled=false; }
};
$('#newIslandButton').onclick = () => $('#newWorldButton').click();
addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
addEventListener('pagehide',()=>{snapshotPosition();resetInput();saveWorld();leaveRoom();});
addEventListener('beforeunload',e=>{if(world && [...world.chunks.values()].some(c=>c.revision!==c.saved)){e.preventDefault();e.returnValue='';}});
async function loginBlockworld(restored = null, mode = 'login') {
  const name = $('#playerName').value.trim(), password = $('#playerPassword').value.trim();
  const error = $('#loginError'); error.textContent = '';
  if (!restored && !name) { error.textContent = '请输入玩家名字'; return; }
  if (!restored && !/^\d{6}$/.test(password)) { error.textContent = '密码必须是 6 位数字'; return; }
  const button = $('#loginButton'); button.disabled = true; button.textContent = '进入中…';
  let authenticated;
  try { authenticated = restored || await window.GameAccount.login(name, password, mode); }
  catch(e) { error.textContent = e.message || '登录失败，请检查账号密码，或点击注册新账号'; button.disabled = false; button.textContent = '登录并开始'; return; }
  const previousPlayer = loadedPlayer;
  if (previousPlayer && !await saveWorld()) { button.disabled = false; button.textContent = '登录并开始'; return; }
  loadedPlayer = '';
  if (roomId && previousPlayer && previousPlayer !== name) leaveRoom();
  try {
    playerName = authenticated.name; playerToken = authenticated.token;
    $('#playerName').value = playerName;
    sessionStorage.setItem('blockworld-player', JSON.stringify({name:playerName,token:playerToken}));
    // Open the account store before selecting a world.  A short timeout keeps
    // a privacy-restricted browser usable while normal IndexedDB startup still
    // gets a chance to load the correct per-account map.
    if (!store.db) {
      try { await Promise.race([store.open(), new Promise((_, reject) => setTimeout(() => reject(Error('存档读取超时')), 900))]); }
      catch { /* continue with the in-memory preview */ }
    }
    await Promise.race([initialWorld, new Promise((_, reject) => setTimeout(() => reject(Error('地图读取超时，请关闭同站点旧标签页后重试')), 10000))]);
    ready=false;$('#startButton').disabled=true;
    if(world){await world.flush();if(!store.cloud)store.localIds.add(world.id);world.dispose();world=null;}
    await store.connect(playerName,playerToken);
    const accountWorld = await store.activeFor(playerName);
    chooseBagMode(accountWorld.id);
    if (accountWorld && (previousPlayer !== playerName || !world || world.info?.id !== accountWorld.id)) beginWorld(accountWorld);
    restoreProfile(await store.readProfile(world.id, playerName));
    loadedPlayer = playerName;
  } catch (e) {
    loadedPlayer = ''; error.textContent = `存档读取失败：${e.message}。请勿清除浏览器数据。`;
    window.GameAccount?.showError(error.textContent);
    button.disabled = false; button.textContent = '登录并开始'; return;
  }
  updateToolsUI(); updateInventoryUI(); $('#loginScreen').classList.remove('active'); $('#startButton').focus(); toast(`欢迎 ${playerName}，请点击“进入方屿”`);
  window.GameAccount?.entered();
  button.disabled = false; button.textContent = '登录并开始';
}
$('#loginButton').onclick = () => loginBlockworld();
$('#registerButton').onclick = () => { if (!$('#loginButton').disabled) loginBlockworld(null, 'register'); };
$('#playerPassword').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g,'').slice(0,6); });
$('#playerName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#playerPassword').focus(); });
$('#playerPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginButton').click(); });
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resetInput();});
let last=performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const realDt=Math.max(0,(now-last)/1000),dt=Math.min(realDt,.05); last=now;
  tickBedSleep(Math.min(realDt,.1));
  const clockActive=playing&&ready&&!document.hidden&&!bedSleep;
  ranking.setActive(clockActive);
  music.setPlaying(clockActive);
  if(clockActive&&clockWasActive){if(!roomId)worldClock.advance(realDt);clockSaveElapsed+=realDt;if(clockSaveElapsed>=5){clockSaveElapsed=0;saveWorld();}}
  clockWasActive=clockActive;
  darkness+=(Number(worldClock.night)-darkness)*Math.min(1,dt*2);
  scene.background.lerpColors(daySky,nightSky,darkness);scene.fog.color.lerpColors(dayFog,nightFog,darkness);
  ambientLight.intensity=2.2-1.65*darkness;sun.intensity=2.8-2.5*darkness;
  $('.sun-glow').style.opacity=String(1-darkness);
  $('#worldClock').textContent=`第 ${worldClock.day} 天 · ${worldClock.label} · ${worldClock.night?'夜晚 · 当心怪物':'白天'}`;
  if(!worldClock.night&&monsters?.entities.size)monsters.clear();
  roomSyncClock += dt; syncRoom();
  roomLifeClient.tick();
  updateRemoteAvatars(dt);
  if(world){
    world.updateCenter(camera.position.x,camera.position.z); world.tick(4);
    streamState.textContent = world.chunks.size ? `${[...world.chunks.values()].filter(c=>c.ready).length}/${world.chunks.size} 区块` : '加载中';
    applyPendingRoomEdits();
    if(spawning)spawn();
    if(ready)merchants?.update(dt,camera.position);
    updateDrops(dt);
    if(playing&&ready){animals?.update(dt,camera.position);tickEating(dt);}
    if(playing&&ready){respawnGrace=Math.max(0,respawnGrace-dt);if(roomId)monsters?.renderRemote(dt);else monsters?.update(dt,camera.position,worldClock.night,amount=>damagePlayer(amount,'怪物攻击'));}
    if(playing && ready) tickMining(dt);
    if(playing && ready&&!bedSleep){
      camera.getWorldDirection(direction);
      const move=movement(direction,lastForward,(keys.KeyW?1:0)-(keys.KeyS?1:0)-mobileMove.y,(keys.KeyD?1:0)-(keys.KeyA?1:0)+mobileMove.x);
      if(fallTracker.peak==null)fallTracker.peak=camera.position.y;
      fallTracker.peak=Math.max(fallTracker.peak,camera.position.y);
      physics.update(dt,move,keys.ShiftLeft||keys.ShiftRight?7.6:5.1);
      damagePlayer(fallTracker.update(camera.position.y,physics.grounded,physics.waiting));
      loading(physics.waiting?'附近地形正在加载…':'');
      if(camera.position.y < MIN_Y - 8){spawning=true;ready=false;camera.position.set(.5,25,.5);}
      updateTarget();
      const p=camera.position; $('#coords').textContent=`X ${Math.floor(p.x)} · Y ${Math.floor(p.y-EYE_HEIGHT)} · Z ${Math.floor(p.z)}`;
    }
  }
  const p=camera.position; water.position.x=p.x;water.position.z=p.z;
  // Snap the shadow center to a world grid to avoid per-frame shadow shimmer.
  const sx=Math.floor(p.x/8)*8,sz=Math.floor(p.z/8)*8;
  sun.position.set(sx+34,60,sz+18);sun.target.position.set(sx,8,sz);
  for(const cloud of clouds){cloud.position.x+=dt*.4; if(cloud.position.x<p.x-55)cloud.position.x+=110;if(cloud.position.x>p.x+55)cloud.position.x-=110;
    if(cloud.position.z<p.z-55)cloud.position.z+=110;if(cloud.position.z>p.z+55)cloud.position.z-=110;}
  renderBedSleep();
}
$('#startButton').disabled=true; $('#newWorldButton').disabled=true;
loading('正在读取世界存档…');
const initialWorld = store.open().then(()=>store.active()).then(next=>{beginWorld(next);$('#newWorldButton').disabled=false;})
  .catch(error=>{loading('世界存档读取失败，请允许浏览器本地存储后刷新；原存档未删除。');console.error(error);});
requestAnimationFrame(animate);
window.GameAccount?.ready.then(data => { if (data) loginBlockworld(data); });
// Explicit local QA entry point; absent during normal play.
if(new URLSearchParams(location.search).has('qa')) {
  window.blockworldQA = {camera,physics,get world(){return world;},get ready(){return ready;},get inventory(){return {...inventory};},get drops(){return drops.length;},get input(){return {...mobileMove,keys:{...keys}};},renderer,pause,enterWorld,saveWorld};
}
