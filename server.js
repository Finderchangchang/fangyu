const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=__dirname;
const {roomLife}=require('./blockworld-room-life.cjs');
const DATA=process.env.PLAYERS_DATA?path.resolve(process.env.PLAYERS_DATA):path.join(ROOT,'players.json');
const {Diagnostics,reason:diagnosticReason}=require('./blockworld-diagnostics.cjs');
const diagnostics=new Diagnostics(path.join(path.dirname(DATA),'blockworld-diagnostic-data'));
const cloudWorlds=new (require('./blockworld-cloud.cjs').CloudWorlds)(path.join(path.dirname(DATA),'blockworld-cloud-data'));
const roomArchive=new (require('./blockworld-room-store.cjs').RoomArchive)(path.join(path.dirname(DATA),'blockworld-room-data'));
const SURVIVAL_DATA=path.join(path.dirname(DATA),'blockworld-survival.jsonl');
const survivalRanking=new (require('./blockworld-ranking.cjs').SurvivalRanking)(SURVIVAL_DATA);
const REDEMPTIONS=process.env.REDEMPTIONS_DATA?path.resolve(process.env.REDEMPTIONS_DATA):path.join(ROOT,'redemptions.json');
const POWER_RANKING_DATA=process.env.POWER_RANKING_DATA?path.resolve(process.env.POWER_RANKING_DATA):path.join(ROOT,'power-ranking.json');
const POWER_ACCOUNTS_DATA=process.env.POWER_ACCOUNTS_DATA?path.resolve(process.env.POWER_ACCOUNTS_DATA):path.join(ROOT,'power-players.json');
const POWER_RECHARGE_REQUESTS_DATA=process.env.POWER_RECHARGE_REQUESTS_DATA?path.resolve(process.env.POWER_RECHARGE_REQUESTS_DATA):path.join(ROOT,'power-recharge-requests.json');
const PORT=Math.max(1,Number(process.env.PORT)||4173);
let players={};try{players=JSON.parse(fs.readFileSync(DATA,'utf8'))}catch{}
let powerAccounts={};try{powerAccounts=JSON.parse(fs.readFileSync(POWER_ACCOUNTS_DATA,'utf8'))}catch{}
let powerRechargeRequests=[];try{powerRechargeRequests=JSON.parse(fs.readFileSync(POWER_RECHARGE_REQUESTS_DATA,'utf8'));if(!Array.isArray(powerRechargeRequests))powerRechargeRequests=[]}catch{}function savePowerRechargeRequests(){fs.writeFileSync(POWER_RECHARGE_REQUESTS_DATA,JSON.stringify(powerRechargeRequests,null,2),'utf8')}
function currentRankSeason(){let override=String(process.env.RANK_SEASON_OVERRIDE||'');if(/^\d{4}-\d{2}$/.test(override))return override;let parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Macau',year:'numeric',month:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return`${parts.year}-${parts.month}`}
let activeRankSeason=currentRankSeason();
const cleanName=n=>String(n||'').trim().slice(0,16).replace(/[<>]/g,'');
const onlineClients=new Map(),PRESENCE_TTL=35000;
function presenceView(){let now=Date.now(),named=new Map(),guests=0;for(const [id,p] of onlineClients){if(now-p.lastSeen>PRESENCE_TTL){onlineClients.delete(id);continue}if(p.name){if(!named.has(p.name))named.set(p.name,new Set());named.get(p.name).add(p.page)}else guests++}let list=[...named].map(([name,pages])=>({name,pages:[...pages]})).sort((a,b)=>a.name.localeCompare(b.name));return{online:list.length+guests,players:list,guests}}
const powerLobbyClients=new Map(),POWER_LOBBY_TTL=5000;
function powerLobbyView(exclude){let now=Date.now();for(const [id,p] of powerLobbyClients)if(now-p.lastSeen>POWER_LOBBY_TTL)powerLobbyClients.delete(id);return[...powerLobbyClients.entries()].filter(([id])=>id!==exclude).map(([id,p])=>{let gear=normalizePowerGame(powerAccounts[p.name]?.powerGame);return{id,name:p.name,power:p.power,auraQuality:gear.auraQuality,auras:gear.auras,x:p.x,y:p.y||0,z:p.z,yaw:p.yaw,walk:p.walk}})}
const POWER_SPAWNS=[[-7,-54,1],[9,-47,1],[-19,-37,2],[18,-28,2],[-24,-6,3],[6,2,3],[25,9,4],[-12,22,4],[18,33,5],[-24,49,5],[2,58,6],[22,67,6],[-8,80,7]],POWER_SPAWNS3=[[-9,-57,1],[10,-52,1],[-21,-43,2],[20,-37,2],[-27,-25,3],[4,-20,3],[27,-10,4],[-15,-2,4],[14,7,5],[-28,15,5],[3,23,6],[27,30,6],[-18,39,7],[18,46,7],[-30,56,8],[4,60,8],[29,67,9],[-13,73,9],[7,82,10],[-27,85,10]],POWER_SPAWNS4=[[-12,-59,1],[1,-56,1],[14,-52,1],[-26,-45,2],[-6,-42,2],[22,-38,2],[-29,-31,3],[3,-27,3],[28,-22,3],[-20,-14,4],[0,-9,4],[25,-4,4],[-27,5,5],[16,11,5],[-4,20,6],[29,25,6],[-24,34,7],[11,40,7],[-7,49,8],[27,55,8],[-29,64,9],[5,69,9],[-13,78,10],[24,84,10]],POWER_MAP1_HP=[0,18,40,75,120,180,260,360],POWER_MAP2_HP=[0,850,1100,1450,1850,2400,3100,4200],POWER_MAP1_REC=[0,1,10,25,50,80,120,200],POWER_MAP2_REC=[0,500,600,700,850,1000,1200,1500],POWER_MAP2_GAIN=[0,10,30,50,80,100,120,200],POWER_MAP3_GAIN=[0,500,1000,1500,2000,3000,4000,8000,9000,11000,15000],POWER_MAP3_REC=[0,10000,20000,30000,40000,60000,80000,120000,140000,180000,240000],POWER_MAP4_GAIN=[0,5000000,8000000,10000000,30000000,50000000,80000000,90000000,100000000,150000000,200000000];
let powerRankingSeed={};try{powerRankingSeed=JSON.parse(fs.readFileSync(POWER_RANKING_DATA,'utf8'))}catch{}const powerWorlds=new Map(),powerDungeons=new Map(),powerProfiles=new Map(Object.entries(powerRankingSeed)),POWER_WORLD_TTL=6000;
const powerGearHp=g=>(g?.equippedHelmet==='greenHelmet'?100000000:g?.equippedHelmet==='whiteHelmet'?150:0)+(g?.equippedArmor==='greenArmor'?200000000:g?.equippedArmor==='whiteArmor'?200:0),powerGearDefense=g=>g?.equippedHelmet==='greenHelmet'?10000000:0,powerMaxHp=(p,g)=>{let base=Math.max(1,Math.floor(Math.max(1,Number(p)||1)/2)+powerGearHp(g)),rare=(g?.equippedHelmet==='purpleHelmet'?.7:0)+(g?.equippedArmor==='purpleArmor'?.7:0);return Math.floor(base*(1+rare))};
function updatePowerProfile(id,name,power){let changed=false;if(String(id).startsWith('account:'))for(const [otherId,p] of powerProfiles)if(otherId!==id&&p.name===name){powerProfiles.delete(otherId);changed=true}let old=powerProfiles.get(id);if(!changed&&old&&old.name===name&&old.power===power)return;powerProfiles.set(id,{id,name,power});fs.writeFileSync(POWER_RANKING_DATA,JSON.stringify(Object.fromEntries(powerProfiles),null,2),'utf8')}
const POWER_SPAWNS5=[[-10,-58,1],[12,-53,1],[-24,-44,2],[20,-39,2],[-29,-30,3],[5,-25,3],[28,-16,4],[-15,-9,4],[14,0,5],[-27,9,5],[2,18,6],[27,27,6],[-19,37,7],[18,44,7],[-30,54,8],[4,60,8],[29,68,9],[-12,74,9],[8,82,10],[-27,86,10]],POWER_MAP5_GAIN=[0,100000000000,200000000000,500000000000,800000000000,1000000000000,1500000000000,5000000000000,50000000000000,100000000000000,500000000000000];
const POWER_SPAWNS6=[[-10,-58,1],[12,-53,1],[-24,-44,2],[20,-39,2],[-29,-30,3],[5,-25,3],[28,-16,4],[-15,-9,4],[14,0,5],[-27,9,5],[2,18,6],[27,27,6],[-19,37,7],[18,44,7],[-30,54,8],[4,60,8],[29,68,9],[-12,74,9],[8,82,10],[-27,86,10]],POWER_MAP6_GAIN=[0,5e21,5e21,1e23,5e23,8e23,5e24,1e25,5e25,1e26,1e27];
const POWER_SPAWNS7=[[-12,-58,1],[2,-54,1],[15,-49,1],[-24,-39,2],[5,-33,2],[25,-27,2],[-20,-14,3],[4,-7,3],[24,2,3],[-25,17,4],[2,27,4],[25,39,4],[-18,53,5],[5,66,5],[22,80,5]],POWER_MAP7_GAIN=[0,1e30,5e31,1e32,1e33,1e35];
const POWER_SPAWNS8=[[-12,-58,1],[2,-54,1],[15,-49,1],[-24,-39,2],[5,-33,2],[25,-27,2],[-20,-17,3],[4,-12,3],[24,-6,3],[-25,4,4],[2,10,4],[25,17,4],[-21,28,5],[4,34,5],[23,40,5],[-24,51,6],[3,58,6],[25,64,6],[-18,73,7],[4,80,7],[22,86,7]],POWER_MAP8_GAIN=[0,1e38,5e38,1e39,5e39,1e40,1e42,1e43];
const POWER_SPAWNS9=[[-12,-58,1],[2,-54,1],[15,-49,1],[-24,-39,2],[5,-33,2],[25,-27,2],[-20,-17,3],[4,-12,3],[24,-6,3],[-25,4,4],[2,10,4],[25,17,4],[-21,28,5],[4,34,5],[23,40,5],[-24,51,6],[3,58,6],[25,64,6],[-18,73,7],[4,80,7],[22,86,7]],POWER_MAP9_GAIN=[0,1e47,5e47,1e48,1e49,1e51,5e51,1e52];
const POWER_SPAWNS10=[[-12,-58,1],[2,-54,1],[15,-49,1],[-24,-39,2],[5,-33,2],[25,-27,2],[-20,-17,3],[4,-12,3],[24,-6,3],[-25,4,4],[2,10,4],[25,17,4],[-21,28,5],[4,34,5],[23,40,5],[-24,51,6],[3,58,6],[25,64,6],[-18,73,7],[4,80,7],[22,86,7],[-12,88,8],[12,88,8]],POWER_MAP10_GAIN=[0,1e52,1e55,5e55,9.999e55,5e60,1e62,1e63,1e64];
const POWER_SPAWNS11=[[-12,-58,1],[2,-54,1],[15,-49,1],[-24,-35,2],[4,-28,2],[25,-20,2],[-20,-7,3],[4,1,3],[24,10,3],[-23,25,4],[3,36,4],[24,47,4],[-18,62,5],[4,75,5],[22,86,5]],POWER_MAP11_GAIN=[0,5e68,5e70,5e71,1e72,1e74];
const cleanPowerMap=v=>[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].includes(Number(v))?Number(v):1;
function getPowerWorld(map){map=cleanPowerMap(map);if(!powerWorlds.has(map)){let spawns=map===11?POWER_SPAWNS11:map===10?POWER_SPAWNS10:map===9?POWER_SPAWNS9:map===8?POWER_SPAWNS8:map===7?POWER_SPAWNS7:map===6?POWER_SPAWNS6:map===5?POWER_SPAWNS5:map===4?POWER_SPAWNS4:map===3?POWER_SPAWNS3:POWER_SPAWNS,gains=map===11?POWER_MAP11_GAIN:map===10?POWER_MAP10_GAIN:map===9?POWER_MAP9_GAIN:map===8?POWER_MAP8_GAIN:map===7?POWER_MAP7_GAIN:map===6?POWER_MAP6_GAIN:map===5?POWER_MAP5_GAIN:map===4?POWER_MAP4_GAIN:POWER_MAP3_GAIN,hp=map===2?POWER_MAP2_HP:map>=3?gains.map(x=>x*(map>=10?5:3)):POWER_MAP1_HP;powerWorlds.set(map,{map,lastTick:Date.now(),players:new Map(),drops:[],monsters:spawns.map(([x,z,l],id)=>({id,x,z,hx:x,hz:z,l,max:hp[l],hp:hp[l],damage:map>=3?gains[l]*(map>=10?5:2):0,alive:true,respawnAt:0,attackAt:0,aggroId:null,yaw:0}))})}return powerWorlds.get(map)}
function getPowerDungeon(id,map=12){let key=`${id}:${map}`;if(!powerDungeons.has(key)){let high=map===13,newDungeon=map===14,asankhyaDungeon=map===15,impossibleDungeon=map===16,max=impossibleDungeon?5e66:asankhyaDungeon?2.5e57:newDungeon?5e52:high?3e17:10000000,damage=impossibleDungeon?5e66:asankhyaDungeon?2.5e57:newDungeon?5e52:high?2e17:1000000;powerDungeons.set(key,{map,lastTick:Date.now(),players:new Map(),drops:[],monsters:[{id:0,x:0,z:-24,hx:0,hz:-24,l:10,max,hp:max,damage,alive:true,respawnAt:0,attackAt:0,aggroId:null,yaw:0}]})}return powerDungeons.get(key)}
function powerLeaderboard(){return[...powerProfiles.values()].sort((a,b)=>b.power-a.power||a.name.localeCompare(b.name,'zh-CN')).slice(0,50)}
function tickPowerWorld(w){let now=Date.now(),dt=Math.min(.12,Math.max(0,(now-w.lastTick)/1000));w.lastTick=now;for(const [id,p] of w.players){if(now-p.lastSeen>POWER_WORLD_TTL){w.players.delete(id);continue}if(p.hp>0&&p.hp<p.maxHp)p.hp=Math.min(p.maxHp,p.hp+100*dt)}for(const m of w.monsters){if(!m.alive){if(now>=m.respawnAt){m.alive=true;m.hp=m.max;m.x=m.hx;m.z=m.hz;m.aggroId=null}continue}let nearest=m.aggroId?w.players.get(m.aggroId):null,locked=!!(nearest&&nearest.hp>0);if(m.aggroId&&!locked)m.aggroId=null;let dist=locked?Math.hypot(nearest.x-m.x,nearest.z-m.z):Infinity;if(!locked)for(const p of w.players.values()){if(p.hp<=0)continue;let d=Math.hypot(p.x-m.x,p.z-m.z);if(d<dist){dist=d;nearest=p}}if(!nearest)continue;if(locked||dist<11){let dx=nearest.x-m.x,dz=nearest.z-m.z;m.yaw=Math.atan2(dx,-dz);if(dist>1.7){let speed=1.15+m.l*.13+(w.map===2?.12:w.map>=3?.2:0);m.x+=dx/dist*speed*dt;m.z+=dz/dist*speed*dt}else if(now>=m.attackAt){m.attackAt=now+1100;let damage=w.map===16?5e66:w.map===15?2.5e57:w.map===14?5e52:w.map===13?2e17:w.map===12?1000000:w.map===11?POWER_MAP11_GAIN[m.l]*5:w.map===10?POWER_MAP10_GAIN[m.l]*5:w.map===9?POWER_MAP9_GAIN[m.l]*2:w.map===8?POWER_MAP8_GAIN[m.l]*2:w.map===7?POWER_MAP7_GAIN[m.l]*2:w.map===6?POWER_MAP6_GAIN[m.l]*2:w.map===5?POWER_MAP5_GAIN[m.l]*2:w.map===4?POWER_MAP4_GAIN[m.l]*2:w.map===3?POWER_MAP3_GAIN[m.l]*2:Math.max(.1,(w.map===2?POWER_MAP2_REC:POWER_MAP1_REC)[m.l]*(w.map===2?.02:.04));nearest.hp=Math.max(0,nearest.hp-Math.max(1,damage-(nearest.defense||0)))}}else{m.x+=(m.hx-m.x)*dt*.12;m.z+=(m.hz-m.z)*dt*.12}}}
function powerWorldView(w,id,extra={}){tickPowerWorld(w);let self=w.players.get(id);return{map:w.map,self:self&&{hp:self.hp,maxHp:self.maxHp},players:[...w.players.entries()].filter(([x])=>x!==id).map(([id,p])=>{let gear=normalizePowerGame(powerAccounts[p.name]?.powerGame);return{id,name:p.name,x:p.x,y:p.y||0,z:p.z,yaw:p.yaw,pitch:p.pitch,walk:p.walk,power:p.power,auraQuality:gear.auraQuality,auras:gear.auras,hp:p.hp,maxHp:p.maxHp,shotAt:p.shotAt||0}}),monsters:w.monsters.map(m=>({...m})),drops:w.drops.map(d=>({...d})),leaderboard:powerLeaderboard(),...extra}}
const fpsStatsDefaults=()=>({bestKills:0,bestWave:0,bestAccuracy:0,games:0});
const casualStatsDefaults=()=>({bestCollected:0,bestTime:null,completions:0,games:0});
const casualRankDefaults=()=>({stars:0,wins:0});
const fpsRankDefaults=()=>({stars:0,wins:0});
const normalizeFpsStats=s=>({bestKills:Math.max(0,Math.floor(Number(s?.bestKills)||0)),bestWave:Math.max(0,Math.min(3,Math.floor(Number(s?.bestWave)||0))),bestAccuracy:Math.max(0,Math.min(100,Math.floor(Number(s?.bestAccuracy)||0))),games:Math.max(0,Math.floor(Number(s?.games)||0))});
const normalizeCasualStats=s=>({bestCollected:Math.max(0,Math.min(10,Math.floor(Number(s?.bestCollected)||0))),bestTime:Number.isFinite(Number(s?.bestTime))&&Number(s.bestTime)>0?Number(s.bestTime):null,completions:Math.max(0,Math.floor(Number(s?.completions)||0)),games:Math.max(0,Math.floor(Number(s?.games)||0))});
const normalizeCasualRank=s=>({stars:Math.max(0,Math.floor(Number(s?.stars)||0)),wins:Math.max(0,Math.floor(Number(s?.wins)||0))});
const normalizeFpsRank=s=>({stars:Math.max(0,Math.floor(Number(s?.stars)||0)),wins:Math.max(0,Math.floor(Number(s?.wins)||0))});
const POWER_CAP=1e76,POWER_GEAR_RESET_VERSION=4,POWER_POWER_RESET_VERSION=5;
const normalizePowerGame=s=>{let weapons=Array.isArray(s?.weapons)?s.weapons.filter(x=>['starter','v9','m416','ak47'].includes(x)):['starter'];if(!weapons.includes('starter'))weapons.unshift('starter');weapons=[...new Set(weapons)];let equippedWeapon=weapons.includes(s?.equippedWeapon)?s.equippedWeapon:'starter',helmets=Array.isArray(s?.helmets)?[...new Set(s.helmets.filter(x=>['whiteHelmet','greenHelmet','purpleHelmet'].includes(x)))]:[],armors=Array.isArray(s?.armors)?[...new Set(s.armors.filter(x=>['whiteArmor','greenArmor','purpleArmor'].includes(x)))]:[],equippedHelmet=helmets.includes(s?.equippedHelmet)?s.equippedHelmet:null,equippedArmor=armors.includes(s?.equippedArmor)?s.equippedArmor:null,skills=Array.isArray(s?.skills)?[...new Set(s.skills.filter(x=>x==='dash'))]:[],validAuras=['white','green','blue','purple','red','gold'],legacyAura=validAuras.includes(s?.auraQuality)?s.auraQuality:null,auras=(Array.isArray(s?.auras)?s.auras:legacyAura?[legacyAura]:[]).filter(x=>validAuras.includes(x)).slice(0,10),auraQuality=auras.reduce((best,x)=>validAuras.indexOf(x)>validAuras.indexOf(best)?x:best,auras[0]||null);return{power:Math.min(POWER_CAP,Math.max(1,Math.floor(Number(s?.power)||1))),experience:Math.max(0,Math.floor(Number(s?.experience)||0)),pillItems:Array.isArray(s?.pillItems)?s.pillItems.slice(0,500).map(x=>({level:Math.max(1,Math.min(10,Math.floor(Number(x?.level)||1))),gain:Math.max(1,Math.floor(Number(x?.gain)||1)),map:cleanPowerMap(x?.map)})):[],reincarnationPills:Math.max(0,Math.min(40,Math.floor(Number(s?.reincarnationPills)||0))),reincarnationCount:Math.max(0,Math.min(40,Math.floor(Number(s?.reincarnationCount)||0))),questStage:Math.max(0,Math.min(3,Math.floor(Number(s?.questStage)||0))),kills:Math.max(0,Math.floor(Number(s?.kills)||0)),coins:Math.max(0,Math.floor(Number(s?.coins)||0)),weapons,equippedWeapon,helmets,armors,equippedHelmet,equippedArmor,skills,auras,auraQuality,attachments:Array.isArray(s?.attachments)?s.attachments.slice(0,30):[],gearResetVersion:Math.max(POWER_GEAR_RESET_VERSION,Math.floor(Number(s?.gearResetVersion)||0)),powerResetVersion:Math.max(POWER_POWER_RESET_VERSION,Math.floor(Number(s?.powerResetVersion)||0))}};
const CASUAL_RANKS=['青铜','白银','黄金','铂金','钻石'];
function casualRankView(value){let rank=normalizeCasualRank(value),tierIndex=Math.min(CASUAL_RANKS.length-1,Math.floor(rank.stars/5)),top=tierIndex===CASUAL_RANKS.length-1;return{tier:CASUAL_RANKS[tierIndex],tierIndex,stars:top?rank.stars-tierIndex*5:rank.stars%5,starsToNext:top?null:5,totalStars:rank.stars,wins:rank.wins}}
function fpsRankView(value){let rank=normalizeFpsRank(value),tierIndex=Math.min(CASUAL_RANKS.length-1,Math.floor(rank.stars/5)),top=tierIndex===CASUAL_RANKS.length-1;return{tier:CASUAL_RANKS[tierIndex],tierIndex,stars:top?rank.stars-tierIndex*5:rank.stars%5,starsToNext:top?null:5,totalStars:rank.stars,wins:rank.wins}}
const defaults=()=>({money:30000,owned:['carbine'],equipped:'carbine',ownedHelmets:[],ownedArmors:[],equippedHelmet:null,equippedArmor:null,stash:[],selectedMap:'warehouse',bagCapacity:8,medkits:0,ammoBundles:0,fpsStats:fpsStatsDefaults(),casualStats:casualStatsDefaults(),casualRank:casualRankDefaults(),fpsRank:fpsRankDefaults(),powerGame:normalizePowerGame(),rankSeason:activeRankSeason});
const makePassword=p=>{let salt=crypto.randomBytes(16).toString('hex');return salt+':'+crypto.scryptSync(p,salt,32).toString('hex')};
const checkPassword=(p,s)=>{try{let [salt,hash]=s.split(':'),test=crypto.scryptSync(p,salt,32);return crypto.timingSafeEqual(test,Buffer.from(hash,'hex'))}catch{return false}};
function save(){fs.writeFileSync(DATA,JSON.stringify(players,null,2),'utf8')}
function savePowerAccounts(){fs.writeFileSync(POWER_ACCOUNTS_DATA,JSON.stringify(powerAccounts,null,2),'utf8')}
function resetPowerInventory(progress){return{...normalizePowerGame(progress),power:1,experience:0,pillItems:[],reincarnationPills:0,reincarnationCount:0,questStage:0,kills:0,coins:0,weapons:['starter'],equippedWeapon:'starter',helmets:[],armors:[],equippedHelmet:null,equippedArmor:null,skills:[],auras:[],auraQuality:null,attachments:[],gearResetVersion:POWER_GEAR_RESET_VERSION,powerResetVersion:Math.max(0,Math.floor(Number(progress?.powerResetVersion)||0))}}
let powerGearReset=false;for(const account of Object.values(powerAccounts))if(Number(account?.powerGame?.gearResetVersion||0)<POWER_GEAR_RESET_VERSION){account.powerGame=resetPowerInventory(account.powerGame);powerGearReset=true}for(const account of Object.values(players))if(account?.powerGame&&Number(account.powerGame.gearResetVersion||0)<POWER_GEAR_RESET_VERSION){account.powerGame=resetPowerInventory(account.powerGame);powerGearReset=true}if(powerGearReset){for(const [name,account] of Object.entries(powerAccounts)){for(const [id,p] of powerProfiles)if(p.name===name)powerProfiles.delete(id);powerProfiles.set(`account:${name}`,{id:`account:${name}`,name,power:account.powerGame.power})}fs.writeFileSync(POWER_RANKING_DATA,JSON.stringify(Object.fromEntries(powerProfiles),null,2),'utf8');savePowerAccounts();save()}
let powerScoreReset=false;for(const account of Object.values(powerAccounts))if(Number(account?.powerGame?.powerResetVersion||0)<POWER_POWER_RESET_VERSION){account.powerGame={...normalizePowerGame(account.powerGame),power:1,experience:0,powerResetVersion:POWER_POWER_RESET_VERSION};account.token=crypto.randomUUID();account.tokens=[account.token];powerScoreReset=true}for(const account of Object.values(players))if(account?.powerGame&&Number(account.powerGame.powerResetVersion||0)<POWER_POWER_RESET_VERSION){account.powerGame={...normalizePowerGame(account.powerGame),power:1,experience:0,powerResetVersion:POWER_POWER_RESET_VERSION};powerScoreReset=true}if(powerScoreReset){for(const [id,p] of powerProfiles)powerProfiles.set(id,{...p,power:1});for(const [name,account] of Object.entries(powerAccounts)){for(const [id,p] of powerProfiles)if(p.name===name)powerProfiles.delete(id);powerProfiles.set(`account:${name}`,{id:`account:${name}`,name,power:1})}fs.writeFileSync(POWER_RANKING_DATA,JSON.stringify(Object.fromEntries(powerProfiles),null,2),'utf8');savePowerAccounts();save()}
function ensureMonthlyRankReset(){let season=currentRankSeason();if(season===activeRankSeason)return false;activeRankSeason=season;for(const p of Object.values(players)){p.casualRank=casualRankDefaults();p.fpsRank=fpsRankDefaults();p.rankSeason=season}save();return true}
let rankMigration=false;for(const p of Object.values(players)){if(!p.rankSeason){p.rankSeason=activeRankSeason;rankMigration=true}else if(p.rankSeason!==activeRankSeason){p.casualRank=casualRankDefaults();p.fpsRank=fpsRankDefaults();p.rankSeason=activeRankSeason;rankMigration=true}}if(rankMigration)save();
function saveRedemption(record){let list=[];try{list=JSON.parse(fs.readFileSync(REDEMPTIONS,'utf8'))}catch{}list.push(record);fs.writeFileSync(REDEMPTIONS,JSON.stringify(list,null,2),'utf8')}
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function body(req){return new Promise((ok,bad)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{ok(JSON.parse(s||'{}'))}catch(e){bad(e)}})})}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const casualQueue=new Map(),casualMatches=new Map(),casualPlayerMatch=new Map();
const matchAuth=(name,token)=>typeof token==='string'&&token.length>0&&Object.hasOwn(players,name)&&token===players[name].token;
const powerMatchAuth=(name,token)=>{let account=name&&powerAccounts[name];return!!(account&&token&&(token===account.token||Array.isArray(account.tokens)&&account.tokens.includes(token)))};
// Lightweight Blockworld co-op rooms.  The first player becomes the room host;
// the room keeps one authoritative seed/edit overlay and relays presence to up
// to four players.  Rooms are intentionally ephemeral and expire after the
// last client disappears.
const blockworldRooms=new Map(),BLOCKWORLD_ROOM_TTL=45000,BLOCKWORLD_ACTION_LIMIT=80,BLOCKWORLD_EDIT_LIMIT=8000;
const cleanRoomId=value=>String(value||'大厅').trim().replace(/[^\w\-一-龥 ]/g,'').slice(0,48)||'大厅';
const cleanClientId=value=>String(value||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
const cleanRoomSeed=value=>{let n=Number(value);return Number.isFinite(n)&&n>0?Math.max(1,Math.min(2147483647,Math.floor(n))):0};
const cleanRoomWorldId=value=>String(value||'').trim().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,96);
const cleanRoomWorldName=value=>String(value||'').trim().replace(/[<>]/g,'').slice(0,32)||'组队地图';
const randomRoomSeed=()=>Math.floor(Math.random()*900000+100000);
const randomRoomInstance=()=>crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,48);
const cleanRoomPosition=(raw,previous={x:0,y:0,z:0,yaw:0,pitch:0,grounded:false,moving:false,ready:true})=>{const n=(v,f)=>Number.isFinite(Number(v))?Number(v):f,b=(v,f)=>v===undefined?!!f:v===true||v===1||v==='1'||v==='true';return{x:Math.max(-100000,Math.min(100000,n(raw?.x,previous.x))),y:Math.max(-1000,Math.min(10000,n(raw?.y,previous.y))),z:Math.max(-100000,Math.min(100000,n(raw?.z,previous.z))),yaw:Math.atan2(Math.sin(n(raw?.yaw,previous.yaw)),Math.cos(n(raw?.yaw,previous.yaw))),pitch:Math.max(-Math.PI/2,Math.min(Math.PI/2,n(raw?.pitch,previous.pitch))),grounded:b(raw?.grounded,previous.grounded),moving:b(raw?.moving,previous.moving),ready:b(raw?.ready,previous.ready)}};
function cleanupBlockworldRooms(){const now=Date.now();for(const [roomId,room] of blockworldRooms){for(const [id,p] of room.players)if(now-p.lastSeen>BLOCKWORLD_ROOM_TTL)room.players.delete(id);if(!room.players.size){roomArchive.base(room);blockworldRooms.delete(roomId)}}}
function blockworldRoomEdits(room){return Object.entries(room.edits||{}).map(([key,block])=>{const [x,y,z]=key.split(',').map(Number);return{x,y,z,block}})}
function blockworldRoomView(room,options={}){const world=room.world||{};const view={room:room.id,seed:world.seed,worldId:world.id||null,worldName:world.name||'组队地图',hostClientId:world.hostClientId||null,revision:room.editRevision||0,players:[...room.players.values()].map(p=>({clientId:p.clientId,name:p.name,position:p.position,lastSeen:p.lastSeen})),actions:room.actions.slice(-BLOCKWORLD_ACTION_LIMIT),world:{...world},edits:blockworldRoomEdits(room)};if(options.snapshot)view.snapshot=view.edits;return view}
function blockworldApplyEdit(room,edit,by='',clientId='',recordAction=true){
  if(!edit||typeof edit!=='object')return null;
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Math.floor(Number(value)):fallback;
  const x=Math.max(-100000,Math.min(100000,finite(edit.x))),y=Math.max(-1000,Math.min(10000,finite(edit.y))),z=Math.max(-100000,Math.min(100000,finite(edit.z)));
  const block=typeof edit.block==='string'?edit.block.slice(0,24):null,key=`${x},${y},${z}`;
  if(recordAction)roomArchive.edit(room,key,block);
  if(!room.edits||typeof room.edits!=='object')room.edits={};
  // Delete/reinsert so the edit limit evicts the oldest touched cell first.
  if(Object.prototype.hasOwnProperty.call(room.edits,key))delete room.edits[key];
  room.edits[key]=block; room.editRevision=(room.editRevision||0)+1;
  if(recordAction)room.actions.push({type:'edit',by,clientId,x,y,z,block,at:Date.now()});
  return{x,y,z,block};
}
const blockworldRoomAuth=(name,token)=>token==='local'||matchAuth(name,token);
function cleanupCasualMatches(){let now=Date.now();for(const [name,entry] of casualQueue)if(now-entry.lastSeen>15000||!players[name])casualQueue.delete(name);for(const [id,match] of casualMatches)if(now-(match.finishedAt||match.startedAt)>30*60*1000){casualMatches.delete(id);for(const name of match.players)if(casualPlayerMatch.get(name)===id)casualPlayerMatch.delete(name)}}
function cleanCasualPosition(raw,previous={x:0,y:0,z:40,yaw:0,walk:0}){let finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;return{x:Math.max(-78,Math.min(78,finite(raw?.x,previous.x))),y:Math.max(0,Math.min(8,finite(raw?.y,previous.y))),z:Math.max(-78,Math.min(78,finite(raw?.z,previous.z))),yaw:Math.atan2(Math.sin(finite(raw?.yaw,previous.yaw)),Math.cos(finite(raw?.yaw,previous.yaw))),walk:Math.max(0,Math.min(1000000,finite(raw?.walk,previous.walk)))}}
function awardCasualRankWin(match,winner){if(match.rankAwarded||!players[winner])return;let rank=normalizeCasualRank(players[winner].casualRank);players[winner].casualRank={stars:rank.stars+1,wins:rank.wins+1};players[winner].lastLogin=Date.now();match.rankAwarded=true;save()}
function casualMatchView(match,name){let opponent=match.players.find(x=>x!==name);return{status:match.status,matchId:match.id,you:{name,collected:match.progress[name]||0,position:match.positions?.[name]||null,rank:casualRankView(players[name]?.casualRank)},opponent:{name:opponent,collected:match.progress[opponent]||0,position:match.positions?.[opponent]||null,rank:casualRankView(players[opponent]?.casualRank)},winner:match.winner||null,reason:match.reason||null,startedAt:match.startedAt,finishedAt:match.finishedAt||null}}
const FPS_MAP=["11111111111111111111","10000000000000000001","10222000111100033001","10200000100100000001","10200000100111110001","10001111100000010001","10001000000000010001","10001001111000000001","10000001001011111001","10111001001010000001","10001000000010044001","10001111011110040001","10000000010000040001","10011100010000000001","10000100011111000101","10000100000000000101","10000111110011111101","10000000000000000001","10000000000000000001","11111111111111111111"];
const FPS_CORNERS=[{corner:'左上角',x:1.5,y:1.5,z:0,a:Math.PI/4},{corner:'右上角',x:18.5,y:1.5,z:0,a:Math.PI*3/4},{corner:'左下角',x:1.5,y:18.5,z:0,a:-Math.PI/4},{corner:'右下角',x:18.5,y:18.5,z:0,a:-Math.PI*3/4}];
const FPS_CENTER={corner:'地图中心',x:10.5,y:10.5,z:0,a:0};
const fpsQueue=new Map(),fpsMatches=new Map(),fpsPlayerMatch=new Map();
function cleanupFpsMatches(){let now=Date.now();for(const [name,entry] of fpsQueue)if(now-entry.lastSeen>15000||!players[name])fpsQueue.delete(name);for(const [id,match] of fpsMatches)if(now-(match.finishedAt||match.startedAt)>30*60*1000){fpsMatches.delete(id);for(const name of match.players)if(fpsPlayerMatch.get(name)===id)fpsPlayerMatch.delete(name)}}
function fpsSolid(x,y){return FPS_MAP[Math.floor(y)]?.[Math.floor(x)]!=='0'}
function cleanFpsPosition(raw,previous){let finite=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback,a=finite(raw?.a,previous.a),next={x:Math.max(1.05,Math.min(18.95,finite(raw?.x,previous.x))),y:Math.max(1.05,Math.min(18.95,finite(raw?.y,previous.y))),z:Math.max(0,Math.min(2.2,finite(raw?.z,previous.z||0))),a:Math.atan2(Math.sin(a),Math.cos(a)),walk:Math.max(0,Math.min(1000000,finite(raw?.walk,previous.walk||0)))};if(fpsSolid(next.x,next.y)){next.x=previous.x;next.y=previous.y}return next}
function fpsClearShot(from,to){let distance=Math.hypot(to.x-from.x,to.y-from.y),steps=Math.ceil(distance*16);for(let i=1;i<steps;i++){let t=i/steps;if(fpsSolid(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t))return false}return true}
function awardFpsRankWin(match,winner){if(match.rankAwarded||!players[winner])return;let rank=normalizeFpsRank(players[winner].fpsRank);players[winner].fpsRank={stars:rank.stars+1,wins:rank.wins+1};players[winner].lastLogin=Date.now();match.rankAwarded=true;save()}
function fpsMatchView(match,name,extra={}){let opponent=match.players.find(x=>x!==name);return{status:match.status,matchId:match.id,you:{name,health:match.health[name],position:match.positions[name],rank:fpsRankView(players[name]?.fpsRank)},opponent:{name:opponent,health:match.health[opponent],position:match.positions[opponent],rank:fpsRankView(players[opponent]?.fpsRank)},winner:match.winner||null,reason:match.reason||null,startedAt:match.startedAt,finishedAt:match.finishedAt||null,...extra}}
http.createServer(async(req,res)=>{let u=new URL(req.url,'http://localhost');
 const diagnosticId=crypto.randomUUID(),diagnosticStart=Date.now();
 if(u.pathname.startsWith('/api/blockworld/')){
   res.setHeader('X-Request-Id',diagnosticId);
   res.on('finish',()=>{if(res.statusCode>=400)diagnostics.record({requestId:diagnosticId,status:res.statusCode,operation:req.diagnosticOperation||u.pathname.split('/').slice(-2).join('.'),reason:req.diagnosticReason||'HTTP_ERROR',durationMs:Date.now()-diagnosticStart});});
 }
 try{
  if(decodeURIComponent(u.pathname).includes('blockworld-diagnostic-data'))return json(res,403,{error:'Forbidden'});
  ensureMonthlyRankReset();
  if(req.method==='POST'&&u.pathname==='/api/blockworld/room/life'){
    const b=await body(req),name=cleanName(b.name),room=blockworldRooms.get(cleanRoomId(b.room)),clientId=cleanClientId(b.clientId);
    if(!matchAuth(name,b.token))return json(res,401,{error:'请重新登录'});
    if(!room||room.players.get(clientId)?.name!==name)return json(res,404,{error:'请重新加入房间'});
    return json(res,200,await roomLife(room,clientId,b));
  }
  if(u.pathname==='/api/blockworld/cloud'&&req.method==='POST'){
    const b=await body(req),name=cleanName(b.name);
    req.diagnosticOperation=/^[a-zA-Z]{1,32}$/.test(b.op||'')?b.op:'invalid-operation';
    if(!matchAuth(name,b.token))return json(res,401,{error:'请重新登录后同步地图'});
    try{return json(res,200,{value:cloudWorlds.handle(name,b)});}catch(error){req.diagnosticReason=diagnosticReason(error);return json(res,error.status||500,{error:error.message});}
  }
  if(decodeURIComponent(u.pathname).includes('blockworld-cloud-data'))return json(res,403,{error:'Forbidden'});
  if(decodeURIComponent(u.pathname).includes('blockworld-room-data'))return json(res,403,{error:'Forbidden'});
  if(u.pathname==='/api/blockworld/ranking'&&req.method==='POST'){
    const b=await body(req),name=cleanName(b.name);
    if(!matchAuth(name,b.token))return json(res,401,{error:'请先登录游戏账号'});
    if(b.action==='pulse'){
      if(typeof b.clientId!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(b.clientId)||typeof b.active!=='boolean')return json(res,400,{error:'无效的生存记录'});
      survivalRanking.pulse(name,b.clientId,b.active);return json(res,200,{ok:true});
    }
    return json(res,200,survivalRanking.board(name,b.page));
  }
  if(decodeURIComponent(u.pathname).includes('blockworld-survival.json'))return json(res,403,{error:'Forbidden'});
  if(req.method==='POST'&&u.pathname==='/api/presence'){
    let b=await body(req),clientId=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);if(!clientId)return json(res,400,{error:'缺少设备标识'});if(b.action==='leave')onlineClients.delete(clientId);else {let name=cleanName(b.name),page=['lobby','fps','casual','extraction','blockworld'].includes(b.page)?b.page:'lobby';onlineClients.set(clientId,{lastSeen:Date.now(),name:matchAuth(name,b.token)?name:'',page})}return json(res,200,presenceView());
  }
  if(req.method==='POST'&&u.pathname==='/api/blockworld/room/join'){
    cleanupBlockworldRooms();
    let b=await body(req),name=cleanName(b.name),roomId=cleanRoomId(b.room);
    if(!blockworldRoomAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let room=blockworldRooms.get(roomId)||roomArchive.load(roomId),wasEmpty=!room||room.players.size===0,incoming=b.world&&typeof b.world==='object'?b.world:{};
    if(room)blockworldRooms.set(roomId,room);
    let clientId=cleanClientId(b.clientId),existing=room&&[...room.players.values()].find(p=>p.name===name);
    if(existing)clientId=existing.clientId;else {
      // A stale tab must not be able to overwrite another player's entry by
      // reusing its client id.  Generate a fresh id until it is unique in the
      // requested room.
      if(room?.players.has(clientId))clientId='';
      while(!clientId||room?.players.has(clientId))clientId=crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,24);
    }
    if(!room){
      const seed=cleanRoomSeed(incoming.seed)||randomRoomSeed(),worldId=cleanRoomWorldId(incoming.id||incoming.worldId)||`room-${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g,'')}`;
      room={id:roomId,players:new Map(),actions:[],world:{id:worldId,seed,name:cleanRoomWorldName(incoming.name||incoming.worldName),hostClientId:clientId,instanceId:randomRoomInstance()},edits:{},editRevision:0,editsInitialized:false,createdAt:Date.now()};
      blockworldRooms.set(roomId,room);
      room.lifeStartTime=Number.isFinite(incoming.time)&&incoming.time>=0?incoming.time:28800;
      room.world.owner=name;
    }else{
      // Rooms created by an older server build may lack the new metadata.
      room.world=room.world||{id:`room-${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g,'')}`,seed:randomRoomSeed(),name:'组队地图',hostClientId:'',instanceId:randomRoomInstance()};
      room.world.seed=cleanRoomSeed(room.world.seed)||randomRoomSeed(); room.world.name=cleanRoomWorldName(room.world.name);
      room.world.id=cleanRoomWorldId(room.world.id)||`room-${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g,'')}`;
      room.world.hostClientId=cleanClientId(room.world.hostClientId); room.world.instanceId=cleanClientId(room.world.instanceId)||randomRoomInstance();
      room.edits=room.edits&&typeof room.edits==='object'?room.edits:{}; room.editRevision=Number(room.editRevision)||0;
      // A room created by an older build has already accepted its first
      // player's map; never let a later joiner overwrite it with private edits.
      if(typeof room.editsInitialized!=='boolean')room.editsInitialized=room.players.size>0||Object.keys(room.edits).length>0;
    }
    if(!room.world.hostClientId)room.world.hostClientId=clientId;
    if(!room.players.has(clientId)&&room.players.size>=4)return json(res,409,{error:'房间已满，最多 4 名玩家'});
    let previous=room.players.get(clientId),position=cleanRoomPosition(b.position,previous?.position);
    room.players.set(clientId,{clientId,name,position,lastSeen:Date.now()});
    if (!room.editsInitialized) {
      if (wasEmpty && Array.isArray(b.edits)) for (const edit of b.edits.slice(0,BLOCKWORLD_EDIT_LIMIT)) blockworldApplyEdit(room,edit,'', '',false);
      // Lock the first player's snapshot even when an old client omitted the
      // edits field; later joiners must never import their private map.
      room.editsInitialized=true;
    }
    roomArchive.base(room);
    return json(res,200,{ok:true,room:roomId,clientId,...blockworldRoomView(room,{snapshot:true})});
  }
  if(req.method==='POST'&&u.pathname==='/api/blockworld/room/state'){
    cleanupBlockworldRooms();
    let b=await body(req),name=cleanName(b.name),roomId=cleanRoomId(b.room),clientId=cleanClientId(b.clientId),room=blockworldRooms.get(roomId);
    if(!blockworldRoomAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    if(!room||!clientId||!room.players.has(clientId))return json(res,404,{error:'房间或玩家不存在，请重新加入'});
    let player=room.players.get(clientId);if(player.name!==name)return json(res,403,{error:'玩家身份不匹配'});
    player.position=cleanRoomPosition(b.position,player.position);player.lastSeen=Date.now();
    if(Array.isArray(b.edits))for(const edit of b.edits.slice(0,20))blockworldApplyEdit(room,edit,name,clientId,true);
    if(b.action){let action=typeof b.action==='string'?b.action.slice(0,80):b.action&&typeof b.action==='object'?{...b.action}:null;if(action)room.actions.push({type:'action',by:name,clientId,action,at:Date.now()})}
    if(room.actions.length>BLOCKWORLD_ACTION_LIMIT*2)room.actions=room.actions.slice(-BLOCKWORLD_ACTION_LIMIT);
    return json(res,200,{ok:true,room:roomId,clientId,...blockworldRoomView(room,{snapshot:!!b.snapshot})});
  }
  if(req.method==='POST'&&u.pathname==='/api/blockworld/room/snapshot'){
    cleanupBlockworldRooms();
    let b=await body(req),name=cleanName(b.name),roomId=cleanRoomId(b.room),clientId=cleanClientId(b.clientId),room=blockworldRooms.get(roomId);
    if(!blockworldRoomAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    if(!room||!clientId||!room.players.has(clientId))return json(res,404,{error:'房间或玩家不存在，请重新加入'});
    let player=room.players.get(clientId);if(player.name!==name)return json(res,403,{error:'玩家身份不匹配'});
    player.lastSeen=Date.now();
    return json(res,200,{ok:true,...blockworldRoomView(room,{snapshot:true})});
  }
  if(req.method==='POST'&&u.pathname==='/api/blockworld/room/leave'){
    cleanupBlockworldRooms();
    let b=await body(req),name=cleanName(b.name),roomId=cleanRoomId(b.room),clientId=cleanClientId(b.clientId),room=blockworldRooms.get(roomId);
    if(!blockworldRoomAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    if(room&&clientId){let player=room.players.get(clientId);if(player?.name===name)room.players.delete(clientId);if(!room.players.size){roomArchive.base(room);blockworldRooms.delete(roomId)}}
    return json(res,200,{ok:true,room:roomId,players:room?blockworldRoomView(room).players:[],actions:room?room.actions.slice(-BLOCKWORLD_ACTION_LIMIT):[]});
  }
  if(req.method==='GET'&&u.pathname==='/api/power-map-counts'){
    let lobby=powerLobbyView('').length,maps={};for(let map=1;map<=11;map++){let w=powerWorlds.get(map);if(w)tickPowerWorld(w);maps[map]=w?w.players.size:0}return json(res,200,{lobby,maps});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-lobby'){
    let b=await body(req),id=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),name=cleanName(b.name);if(!id)return json(res,400,{error:'缺少大厅标识'});if(!powerMatchAuth(name,b.token))return json(res,401,{error:'请先登录 3D 游戏账号'});if(b.action==='leave'){powerLobbyClients.delete(id);return json(res,200,{players:[]})}let finite=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback,previous=powerLobbyClients.get(id)||{x:0,y:0,z:13,yaw:0,walk:0},power=Math.max(1,Math.floor(Number(b.power)||1));powerLobbyClients.set(id,{name,power,x:Math.max(-32,Math.min(32,finite(b.x,previous.x))),y:Math.max(0,Math.min(2.5,finite(b.y,previous.y||0))),z:Math.max(-28,Math.min(28,finite(b.z,previous.z))),yaw:Math.atan2(Math.sin(finite(b.yaw,previous.yaw)),Math.cos(finite(b.yaw,previous.yaw))),walk:Math.max(0,Math.min(1e7,finite(b.walk,previous.walk))),lastSeen:Date.now()});updatePowerProfile(`account:${name}`,name,power);let others=powerLobbyView(id);return json(res,200,{players:others,online:others.length+1,leaderboard:powerLeaderboard()});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-world/sync'){
    let b=await body(req),id=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),name=cleanName(b.name);if(!id)return json(res,400,{error:'缺少玩家标识'});if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏登录已失效，请刷新后重新登录'});let map=cleanPowerMap(b.map),gear=normalizePowerGame(powerAccounts[name]?.powerGame),weaponPower=gear.equippedWeapon==='ak47'?Math.floor(gear.power*.8):gear.equippedWeapon==='m416'?100000000:gear.equippedWeapon==='v9'?1000:0,power=Math.min(POWER_CAP,gear.power+weaponPower);if(map===2&&power<500)return json(res,403,{error:'进入雾隐山谷需要 500 战力'});if(map===3&&power<10000)return json(res,403,{error:'进入地图 3 需要 1万战力'});if(map===4&&power<10000000)return json(res,403,{error:'进入地图 4 需要 1000万战力'});if(map===5&&power<1000000000)return json(res,403,{error:'进入地图 5 需要 10亿战力'});if(map===6&&power<5e16)return json(res,403,{error:'进入地图 6 需要 5京战力'});if(map===7&&power<5e28)return json(res,403,{error:'进入地图 7 需要 5穰战力'});if(map===8&&power<1e37)return json(res,403,{error:'进入地图 8 需要 10涧战力'});if(map===9&&power<1e45)return json(res,403,{error:'进入地图 9 需要 10载战力'});if(map===10&&power<1e54)return json(res,403,{error:'进入地图 10 需要 100恒河沙战力'});if(map===11&&power<1e66)return json(res,403,{error:'进入地图 11 需要 100不可思议战力'});if(map===12&&power<5000000)return json(res,403,{error:'进入第一关副本需要 500万战力'});if(map===13&&power<5000)return json(res,403,{error:'进入京级副本需要 5000 战力'});if(map===14&&power<1e49)return json(res,403,{error:'进入恒沙副本需要 10极战力'});if(map===15&&power<5e56)return json(res,403,{error:'进入阿僧祇副本需要 5阿僧祇战力'});if(map===16&&power<5e65)return json(res,403,{error:'进入不可思议副本需要 50不可思议战力'});powerLobbyClients.delete(id);let dungeon=map>=12;for(const [otherMap,world] of powerWorlds)if(dungeon||otherMap!==map)world.players.delete(id);if(!dungeon)powerDungeons.delete(`${id}:12`),powerDungeons.delete(`${id}:13`),powerDungeons.delete(`${id}:14`),powerDungeons.delete(`${id}:15`),powerDungeons.delete(`${id}:16`);let w=dungeon?getPowerDungeon(id,map):getPowerWorld(map),old=w.players.get(id),maxHp=powerMaxHp(power,gear),defense=powerGearDefense(gear),finite=(v,f)=>Number.isFinite(Number(v))?Number(v):f,hp=old?Math.min(maxHp,old.hp+(maxHp-old.maxHp)):maxHp;w.players.set(id,{name,power,maxHp,hp,defense,x:Math.max(-42,Math.min(42,finite(b.x,old?.x||0))),y:Math.max(0,Math.min(2.5,finite(b.y,old?.y||0))),z:Math.max(-70,Math.min(91,finite(b.z,old?.z||-62))),yaw:Math.atan2(Math.sin(finite(b.yaw,old?.yaw||0)),Math.cos(finite(b.yaw,old?.yaw||0))),pitch:Math.max(-.7,Math.min(.7,finite(b.pitch,old?.pitch||0))),walk:Math.max(0,Math.min(1e9,finite(b.walk,old?.walk||0))),shotAt:old?.shotAt||0,lastSeen:Date.now()});updatePowerProfile(`account:${name}`,name,power);return json(res,200,powerWorldView(w,id));
  }
  if(req.method==='POST'&&u.pathname==='/api/power-world/shoot'){
    let b=await body(req),id=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),map=cleanPowerMap(b.map),w=map>=12?getPowerDungeon(id,map):getPowerWorld(map);tickPowerWorld(w);let shooter=w.players.get(id);if(!shooter)return json(res,404,{error:'玩家不在地图中'});let gear=normalizePowerGame(powerAccounts[shooter.name]?.powerGame),requested=['v9','m416','ak47'].includes(b.weapon)?b.weapon:'starter',weapon=gear.weapons.includes(requested)?requested:gear.equippedWeapon,now=Date.now(),shotDelay=weapon==='ak47'?20:weapon==='v9'?65:weapon==='m416'?80:180;if(now-(shooter.lastAttackAt||0)<shotDelay)return json(res,200,powerWorldView(w,id,{shot:{hit:false,damage:0,defeated:false,cooldown:true,targetType:b.targetType||null}}));shooter.lastAttackAt=now;shooter.shotAt=now;let hit=false,damage=0,defeated=false,reward=null,weaponDamage=weapon==='m416'?100000000:weapon==='v9'?1000:5;if(b.targetType==='monster'){let m=w.monsters.find(x=>x.id===Number(b.targetId));if(m?.alive&&Math.hypot(m.x-shooter.x,m.z-shooter.z)<42){m.aggroId=id;damage=weaponDamage+shooter.power;m.hp=Math.max(0,m.hp-damage);hit=true;if(m.hp<=0){m.alive=false;m.aggroId=null;m.respawnAt=w.map>=12?Number.MAX_SAFE_INTEGER:Date.now()+7000;defeated=true;if(w.map>=12){let account=powerAccounts[shooter.name];if(account){account.powerGame=normalizePowerGame(account.powerGame);let baseReward=w.map===16?1e66:w.map===15?5e56:w.map===14?1e52:w.map===13?1e17:5000000,rewardPower=Math.min(Math.floor(baseReward*(1+account.powerGame.reincarnationCount*.1)),Math.max(0,POWER_CAP-account.powerGame.power)),rewardCoins=w.map===15?100:w.map===12?1000:0;account.powerGame.coins+=rewardCoins;account.powerGame.power+=rewardPower;account.lastLogin=Date.now();savePowerAccounts();reward={coins:rewardCoins,power:rewardPower,progress:account.powerGame}}}else{let gain=w.map===11?POWER_MAP11_GAIN[m.l]:w.map===10?POWER_MAP10_GAIN[m.l]:w.map===9?POWER_MAP9_GAIN[m.l]:w.map===8?POWER_MAP8_GAIN[m.l]:w.map===7?POWER_MAP7_GAIN[m.l]:w.map===6?POWER_MAP6_GAIN[m.l]:w.map===5?POWER_MAP5_GAIN[m.l]:w.map===4?POWER_MAP4_GAIN[m.l]:w.map===3?POWER_MAP3_GAIN[m.l]:w.map===2?POWER_MAP2_GAIN[m.l]:m.l,phase=Math.random()*6;w.drops.push({id:crypto.randomUUID(),type:'pill',x:m.x-.42,z:m.z,level:m.l,gain,map:w.map,phase});w.drops.push({id:crypto.randomUUID(),type:'coin',x:m.x+.42,z:m.z,coins:1,map:w.map,phase:phase+1.7})}}}}else if(b.targetType==='player'&&w.map<12){let target=w.players.get(String(b.targetId||''));if(target&&target!==shooter&&target.hp>0&&Math.hypot(target.x-shooter.x,target.z-shooter.z)<42){damage=Math.max(1,(weaponDamage+shooter.power)*.1-(target.defense||0));target.hp=Math.max(0,target.hp-damage);hit=true;defeated=target.hp<=0}}return json(res,200,powerWorldView(w,id,{shot:{hit,damage,defeated,weapon,reward,targetType:b.targetType||null}}));
  }
  if(req.method==='POST'&&u.pathname==='/api/power-world/pickup'){
    let b=await body(req),id=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80),w=getPowerWorld(cleanPowerMap(b.map)),p=w.players.get(id);if(!p)return json(res,404,{error:'玩家不在地图中'});let drop=w.drops.find(x=>x.id===String(b.dropId||''));if(!drop||Math.hypot(drop.x-p.x,drop.z-p.z)>2)return json(res,409,{error:'掉落物不存在或距离太远'});w.drops.splice(w.drops.indexOf(drop),1);if(drop.type==='coin'&&powerAccounts[p.name]){powerAccounts[p.name].powerGame=normalizePowerGame(powerAccounts[p.name].powerGame);powerAccounts[p.name].powerGame.coins+=1;powerAccounts[p.name].lastLogin=Date.now();savePowerAccounts()}return json(res,200,{item:drop,...powerWorldView(w,id)});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-world/leave'){
    let b=await body(req),id=String(b.clientId||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);for(const w of powerWorlds.values())w.players.delete(id);for(const key of powerDungeons.keys())if(key.startsWith(`${id}:`))powerDungeons.delete(key);return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&u.pathname==='/api/power-leaderboard')return json(res,200,powerLeaderboard());
  if(req.method==='POST'&&u.pathname==='/api/power-login'){
    let b=await body(req),name=cleanName(b.name),password=String(b.password||'');if(!name)return json(res,400,{error:'请输入玩家名字'});if(!/^\d{6}$/.test(password))return json(res,400,{error:'密码必须是 6 位数字'});let sessionToken=crypto.randomUUID();if(powerAccounts[name]){let account=powerAccounts[name];if(!checkPassword(password,account.passwordHash))return json(res,401,{error:'3D 游戏密码错误'});account.tokens=[...new Set([...(Array.isArray(account.tokens)?account.tokens:[]),account.token,sessionToken].filter(Boolean))].slice(-12);account.token=sessionToken;account.lastLogin=Date.now();account.powerGame=normalizePowerGame(account.powerGame)}else{let migrated=normalizePowerGame(players[name]?.powerGame);powerAccounts[name]={passwordHash:makePassword(password),token:sessionToken,tokens:[sessionToken],lastLogin:Date.now(),powerGame:migrated}}savePowerAccounts();return json(res,200,{name,token:sessionToken,profile:{powerGame:powerAccounts[name].powerGame}});
  }
  if(req.method==='POST'&&u.pathname==='/api/session'){
    const b=await body(req),name=cleanName(b.name);
    if(!matchAuth(name,b.token))return json(res,401,{error:'登录已失效，请重新登录'});
    const {token,passwordHash,...profile}=players[name];return json(res,200,{name,token,profile});
  }
  if(req.method==='POST'&&u.pathname==='/api/login'){
    let b=await body(req),name=cleanName(b.name),password=String(b.password||'');
    if(!name)return json(res,400,{error:'请输入玩家名字'});
    if(['__proto__','constructor','prototype'].includes(name))return json(res,400,{error:'请换一个玩家名字'});
    if(!/^\d{6}$/.test(password))return json(res,400,{error:'密码必须是 6 位数字'});
    if(b.mode==='register'&&Object.hasOwn(players,name))return json(res,409,{error:'这个名字已被注册，请换一个名字；如果是你的账号，请点击登录'});
    if(b.mode==='login'&&!Object.hasOwn(players,name))return json(res,404,{error:'这个名字还未注册，请点击“注册新账号”'});
    if(players[name]){
      if(players[name].passwordHash){if(!checkPassword(password,players[name].passwordHash))return json(res,401,{error:'密码错误'})}
      else if(b.token&&b.token===players[name].token){players[name].passwordHash=makePassword(password)}
      else return json(res,409,{error:'该名字已经存在，请在原设备设置密码或更换名字'});
      players[name].token=crypto.randomUUID();players[name].lastLogin=Date.now();players[name].casualRank=normalizeCasualRank(players[name].casualRank);players[name].fpsRank=normalizeFpsRank(players[name].fpsRank);players[name].powerGame=normalizePowerGame(players[name].powerGame);
    }else players[name]={...defaults(),passwordHash:makePassword(password),token:crypto.randomUUID(),lastLogin:Date.now()};
    save();let {token,passwordHash,...profile}=players[name];return json(res,200,{name,token,profile});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-save'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});let current=normalizePowerGame(powerAccounts[name].powerGame),incoming={...(b.progress||{}),reincarnationPills:current.reincarnationPills,reincarnationCount:current.reincarnationCount,questStage:current.questStage,skills:current.skills,auras:current.auras,auraQuality:current.auraQuality};if(Number(incoming.gearResetVersion||0)<POWER_GEAR_RESET_VERSION)incoming={...incoming,pillItems:current.pillItems,kills:current.kills,coins:current.coins,weapons:current.weapons,equippedWeapon:current.equippedWeapon,helmets:current.helmets,armors:current.armors,equippedHelmet:current.equippedHelmet,equippedArmor:current.equippedArmor,skills:current.skills,auras:current.auras,auraQuality:current.auraQuality,attachments:current.attachments,gearResetVersion:POWER_GEAR_RESET_VERSION};if(Number(incoming.powerResetVersion||0)<POWER_POWER_RESET_VERSION)incoming={...incoming,power:current.power,powerResetVersion:POWER_POWER_RESET_VERSION};powerAccounts[name].powerGame=normalizePowerGame({...current,...incoming});powerAccounts[name].lastLogin=Date.now();savePowerAccounts();return json(res,200,{ok:true,powerGame:powerAccounts[name].powerGame});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-shop/buy'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});let progress=normalizePowerGame(powerAccounts[name].powerGame),item=String(b.item||''),prices={v9:100,m416:1000,whiteHelmet:50,whiteArmor:60,greenHelmet:1000,greenArmor:1000},price=prices[item]||0;if(!price)return json(res,400,{error:'该装备还没有上架'});let weapon=['v9','m416'].includes(item),helmet=['whiteHelmet','greenHelmet'].includes(item),owned=weapon?progress.weapons.includes(item):helmet?progress.helmets.includes(item):progress.armors.includes(item);if(b.dryRun)return json(res,200,{ok:true,dryRun:true,item,price,coins:progress.coins,owned,canBuy:owned||progress.coins>=price});if(owned)return json(res,200,{ok:true,alreadyOwned:true,powerGame:progress});if(progress.coins<price)return json(res,400,{error:`金币不足，还差 ${price-progress.coins} 枚`});progress.coins-=price;if(weapon){progress.weapons.push(item);progress.equippedWeapon=item}else if(helmet){progress.helmets.push(item);progress.equippedHelmet=item}else{progress.armors.push(item);progress.equippedArmor=item}powerAccounts[name].powerGame=normalizePowerGame(progress);powerAccounts[name].lastLogin=Date.now();savePowerAccounts();let equipped=powerAccounts[name].powerGame.equippedWeapon,weaponPower=equipped==='m416'?100000000:equipped==='v9'?1000:0;updatePowerProfile(`account:${name}`,name,powerAccounts[name].powerGame.power+weaponPower);return json(res,200,{ok:true,powerGame:powerAccounts[name].powerGame});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-recharge/test-buy'){
    return json(res,403,{error:'免费领取已经关闭，请提交线下购买申请'});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-recharge/request'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});let item=String(b.item||''),catalog={reincarnationPill:{label:'轮回丹',price:1},ak47:{label:'AK47',price:.5},purpleHelmet:{label:'紫色稀有头盔',price:.5},purpleArmor:{label:'紫色稀有护甲',price:.5},dashSkill:{label:'推进技能（10秒冷却）',price:.1},auraWhite:{label:'白色光环',price:.1},auraGreen:{label:'绿色光环',price:.2},auraBlue:{label:'蓝色光环',price:.3},auraPurple:{label:'紫色光环',price:.4},auraRed:{label:'红色光环',price:.5},auraGold:{label:'金色光环',price:.6},giftPack05:{label:'五毛新手礼包（轮回丹×5、AK47、稀有护甲、1亿战力）',price:.5},giftPack1:{label:'一元进阶礼包（轮回丹×8、AK47、稀有护甲、1秭战力）',price:1}},product=catalog[item];if(!product)return json(res,400,{error:'该商品还没有上架'});let existing=powerRechargeRequests.find(x=>x.player===name&&x.item===item&&x.status==='待付款确认');if(existing)return json(res,200,{ok:true,existing:true,request:existing});let request={id:crypto.randomUUID(),player:name,item,label:product.label,price:product.price,status:'待付款确认',createdAt:Date.now()};powerRechargeRequests.unshift(request);powerRechargeRequests=powerRechargeRequests.slice(0,500);savePowerRechargeRequests();return json(res,200,{ok:true,request});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-recharge/admin-list'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});if(!process.env.POWER_ADMIN_NAME||name!==process.env.POWER_ADMIN_NAME)return json(res,403,{error:'仅管理员可以查看购买申请'});return json(res,200,{ok:true,requests:powerRechargeRequests.slice(0,100)});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-quest/submit'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});let progress=normalizePowerGame(powerAccounts[name].powerGame),stage=progress.questStage;if(stage>=3)return json(res,400,{error:'新手任务已经全部完成'});if(stage===0){let matches=[];for(let i=0;i<progress.pillItems.length;i++)if(progress.pillItems[i].map===1&&progress.pillItems[i].level===7)matches.push(i);if(matches.length<20)return json(res,400,{error:`地图一的7级丹药不足，还差 ${20-matches.length} 个`});let remove=new Set(matches.slice(0,20));progress.pillItems=progress.pillItems.filter((_,i)=>!remove.has(i))}else if(stage===1){if(progress.coins<100)return json(res,400,{error:`金币不足，还差 ${100-progress.coins} 个`});progress.coins-=100}else{let matches=[];for(let i=0;i<progress.pillItems.length;i++)if(progress.pillItems[i].map===3&&progress.pillItems[i].level===1)matches.push(i);if(matches.length<5)return json(res,400,{error:`地图三的1级丹药不足，还差 ${5-matches.length} 个`});if(progress.reincarnationPills>=40)return json(res,400,{error:'轮回丹持有数量已满，请先使用一颗'});let remove=new Set(matches.slice(0,5));progress.pillItems=progress.pillItems.filter((_,i)=>!remove.has(i));progress.reincarnationPills++}progress.questStage++;powerAccounts[name].powerGame=normalizePowerGame(progress);powerAccounts[name].lastLogin=Date.now();savePowerAccounts();return json(res,200,{ok:true,completed:progress.questStage>=3,powerGame:powerAccounts[name].powerGame});
  }
  if(req.method==='POST'&&u.pathname==='/api/power-reincarnation/consume'){
    let b=await body(req),name=cleanName(b.name);if(!powerMatchAuth(name,b.token))return json(res,401,{error:'3D 游戏账号验证失败，请重新登录'});let progress=normalizePowerGame(powerAccounts[name].powerGame);if(progress.reincarnationCount>=40)return json(res,400,{error:'轮回丹最多使用 40 颗'});if(progress.reincarnationPills<1)return json(res,400,{error:'还没有轮回丹，可通过充值、免费赠送或任务获得'});progress.reincarnationPills--;progress.reincarnationCount++;progress.power=1;powerAccounts[name].powerGame=normalizePowerGame(progress);powerAccounts[name].lastLogin=Date.now();savePowerAccounts();updatePowerProfile(`account:${name}`,name,1);return json(res,200,{ok:true,powerGame:powerAccounts[name].powerGame});
  }
  if(req.method==='POST'&&u.pathname==='/api/save'){let b=await body(req),name=cleanName(b.name);if(!name||!players[name]||b.token!==players[name].token)return json(res,401,{error:'账号验证失败，请重新登录'});let p=b.profile||{},previous=players[name],token=previous.token,passwordHash=previous.passwordHash;players[name]={...defaults(),money:Math.max(0,Number(p.money)||0),owned:Array.isArray(p.owned)?p.owned.slice(0,20):['carbine'],equipped:String(p.equipped||'carbine'),ownedHelmets:Array.isArray(p.ownedHelmets)?p.ownedHelmets.slice(0,10):[],ownedArmors:Array.isArray(p.ownedArmors)?p.ownedArmors.slice(0,10):[],equippedHelmet:p.equippedHelmet?String(p.equippedHelmet):null,equippedArmor:p.equippedArmor?String(p.equippedArmor):null,stash:Array.isArray(p.stash)?p.stash.slice(0,200):[],selectedMap:String(p.selectedMap||'warehouse'),bagCapacity:[8,12,16,24,32,48].includes(p.bagCapacity)?p.bagCapacity:8,medkits:Math.max(0,Number(p.medkits)||0),ammoBundles:Math.max(0,Number(p.ammoBundles)||0),fpsStats:normalizeFpsStats(previous.fpsStats),casualStats:normalizeCasualStats(previous.casualStats),casualRank:normalizeCasualRank(previous.casualRank),fpsRank:normalizeFpsRank(previous.fpsRank),powerGame:normalizePowerGame(previous.powerGame),rankSeason:activeRankSeason,passwordHash,token,lastLogin:Date.now()};save();return json(res,200,{ok:true})}
  if(req.method==='POST'&&u.pathname==='/api/redeem'){let b=await body(req),name=cleanName(b.name),p=players[name];if(!name||!p||b.token!==p.token)return json(res,401,{error:'账号验证失败，请重新登录'});if(!process.env.REDEMPTION_CODE||String(b.code||'')!==process.env.REDEMPTION_CODE)return json(res,403,{error:'兑换密码错误'});if((Number(p.money)||0)<5000000)return json(res,400,{error:'资金不足，需要攒够 ¥5,000,000'});p.money-=5000000;p.lastLogin=Date.now();let record={id:crypto.randomUUID(),player:name,cost:5000000,rewardYuan:1,status:'待联系',createdAt:Date.now()};save();saveRedemption(record);return json(res,200,{ok:true,money:p.money,record:{id:record.id,rewardYuan:1,status:record.status}})}
  if(req.method==='POST'&&u.pathname==='/api/game-score'){
    let b=await body(req),name=cleanName(b.name),p=players[name];
    if(!name||!p||b.token!==p.token)return json(res,401,{error:'账号验证失败，请重新登录'});
    if(b.game==='fps'){
      let current=normalizeFpsStats(p.fpsStats),kills=Math.max(0,Math.min(10000,Math.floor(Number(b.kills)||0))),wave=Math.max(1,Math.min(3,Math.floor(Number(b.wave)||1))),accuracy=Math.max(0,Math.min(100,Math.floor(Number(b.accuracy)||0)));
      p.fpsStats={bestKills:Math.max(current.bestKills,kills),bestWave:Math.max(current.bestWave,wave),bestAccuracy:Math.max(current.bestAccuracy,accuracy),games:current.games+1};
    }else if(b.game==='casual'){
      let current=normalizeCasualStats(p.casualStats),collected=Math.max(0,Math.min(10,Math.floor(Number(b.collected)||0))),time=Math.max(1,Math.min(36000,Number(b.time)||36000)),completed=collected>=10;
      p.casualStats={bestCollected:Math.max(current.bestCollected,collected),bestTime:completed&&(!current.bestTime||time<current.bestTime)?time:current.bestTime,completions:current.completions+(completed?1:0),games:current.games+1};
    }else return json(res,400,{error:'未知游戏'});
    p.lastLogin=Date.now();save();return json(res,200,{ok:true,stats:b.game==='fps'?normalizeFpsStats(p.fpsStats):normalizeCasualStats(p.casualStats)});
  }
  if(req.method==='GET'&&u.pathname==='/api/game-leaderboard'){
    if(u.searchParams.get('game')==='fps'){
      let board=Object.entries(players).map(([name,p])=>({name,...normalizeFpsStats(p.fpsStats)})).filter(x=>x.games>0).sort((a,b)=>b.bestWave-a.bestWave||b.bestKills-a.bestKills||b.bestAccuracy-a.bestAccuracy).slice(0,100);return json(res,200,board);
    }
    if(u.searchParams.get('game')==='casual'){
      let board=Object.entries(players).map(([name,p])=>({name,...normalizeCasualStats(p.casualStats)})).filter(x=>x.games>0).sort((a,b)=>b.bestCollected-a.bestCollected||(a.bestTime??Infinity)-(b.bestTime??Infinity)||b.completions-a.completions).slice(0,100);return json(res,200,board);
    }
    return json(res,400,{error:'未知游戏'});
  }
  if(req.method==='GET'&&u.pathname==='/api/game-rank-leaderboard'){
    let game=u.searchParams.get('game'),rankOf=game==='fps'?p=>fpsRankView(p.fpsRank):game==='casual'?p=>casualRankView(p.casualRank):null;if(!rankOf)return json(res,400,{error:'未知游戏'});
    let board=Object.entries(players).map(([name,p])=>({name,...rankOf(p)})).filter(x=>x.wins>0||x.totalStars>0).sort((a,b)=>b.totalStars-a.totalStars||b.wins-a.wins||a.name.localeCompare(b.name,'zh-CN')).slice(0,100);return json(res,200,board);
  }
  if(req.method==='POST'&&u.pathname==='/api/fps-match/join'){
    let b=await body(req),name=cleanName(b.name);cleanupFpsMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let oldId=fpsPlayerMatch.get(name),oldMatch=oldId&&fpsMatches.get(oldId);
    if(oldMatch?.status==='playing'){oldMatch.lastSeen[name]=Date.now();return json(res,200,fpsMatchView(oldMatch,name))}
    if(oldId)fpsPlayerMatch.delete(name);
    let now=Date.now(),opponentEntry=[...fpsQueue.values()].find(x=>x.name!==name&&now-x.lastSeen<=15000&&players[x.name]);
    if(opponentEntry){
      fpsQueue.delete(opponentEntry.name);fpsQueue.delete(name);let corner={...FPS_CORNERS[Math.floor(Math.random()*FPS_CORNERS.length)]},center={...FPS_CENTER,a:Math.random()*Math.PI*2-Math.PI},spawns=Math.random()<.5?[center,corner]:[corner,center],first=spawns[0],second=spawns[1],id=crypto.randomUUID(),match={id,status:'playing',players:[opponentEntry.name,name],positions:{[opponentEntry.name]:first,[name]:second},health:{[opponentEntry.name]:100,[name]:100},lastShot:{[opponentEntry.name]:0,[name]:0},winner:null,reason:null,rankAwarded:false,startedAt:now,finishedAt:null,lastSeen:{[opponentEntry.name]:opponentEntry.lastSeen,[name]:now}};
      fpsMatches.set(id,match);fpsPlayerMatch.set(opponentEntry.name,id);fpsPlayerMatch.set(name,id);return json(res,200,fpsMatchView(match,name));
    }
    let waiting=fpsQueue.get(name);fpsQueue.set(name,{name,joinedAt:waiting?.joinedAt||now,lastSeen:now});return json(res,200,{status:'waiting',waitingSince:waiting?.joinedAt||now,queueSize:fpsQueue.size,rank:fpsRankView(players[name].fpsRank)});
  }
  if(req.method==='POST'&&u.pathname==='/api/fps-match/sync'){
    let b=await body(req),name=cleanName(b.name);cleanupFpsMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});let match=fpsMatches.get(String(b.matchId||''));
    if(!match||!match.players.includes(name))return json(res,404,{error:'对战已经结束或不存在'});match.lastSeen[name]=Date.now();if(match.status==='playing')match.positions[name]=cleanFpsPosition(b.position,match.positions[name]);return json(res,200,fpsMatchView(match,name));
  }
  if(req.method==='POST'&&u.pathname==='/api/fps-match/shoot'){
    let b=await body(req),name=cleanName(b.name);cleanupFpsMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});let match=fpsMatches.get(String(b.matchId||''));
    if(!match||!match.players.includes(name))return json(res,404,{error:'对战已经结束或不存在'});match.lastSeen[name]=Date.now();
    let shot={fired:false,hit:false,damage:0};if(match.status==='playing'){
      match.positions[name]=cleanFpsPosition(b.position,match.positions[name]);let now=Date.now();if(now-(match.lastShot[name]||0)>=90){match.lastShot[name]=now;shot.fired=true;let opponent=match.players.find(x=>x!==name),from=match.positions[name],to=match.positions[opponent],distance=Math.hypot(to.x-from.x,to.y-from.y),targetAngle=Math.atan2(to.y-from.y,to.x-from.x),angleError=Math.atan2(Math.sin(targetAngle-from.a),Math.cos(targetAngle-from.a));if(distance<25&&Math.abs(angleError)<.06&&fpsClearShot(from,to)){shot.hit=true;shot.damage=25;match.health[opponent]=Math.max(0,match.health[opponent]-shot.damage);if(match.health[opponent]<=0){match.status='finished';match.winner=name;match.reason='elimination';match.finishedAt=now;awardFpsRankWin(match,name)}}}
    }
    return json(res,200,fpsMatchView(match,name,{shot}));
  }
  if(req.method==='POST'&&u.pathname==='/api/fps-match/leave'){
    let b=await body(req),name=cleanName(b.name);cleanupFpsMatches();if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});fpsQueue.delete(name);let id=String(b.matchId||fpsPlayerMatch.get(name)||''),match=fpsMatches.get(id);if(match?.status==='playing'&&match.players.includes(name)){let opponent=match.players.find(x=>x!==name);match.status='finished';match.winner=opponent;match.reason='opponent_left';match.finishedAt=Date.now();awardFpsRankWin(match,opponent)}return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&u.pathname==='/api/casual-match/join'){
    let b=await body(req),name=cleanName(b.name);cleanupCasualMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let oldId=casualPlayerMatch.get(name),oldMatch=oldId&&casualMatches.get(oldId);
    if(oldMatch?.status==='playing'){oldMatch.lastSeen[name]=Date.now();return json(res,200,casualMatchView(oldMatch,name))}
    if(oldId)casualPlayerMatch.delete(name);
    let now=Date.now(),opponentEntry=[...casualQueue.values()].find(x=>x.name!==name&&now-x.lastSeen<=15000&&players[x.name]);
    if(opponentEntry){
      casualQueue.delete(opponentEntry.name);casualQueue.delete(name);
      let id=crypto.randomUUID(),match={id,status:'playing',players:[opponentEntry.name,name],progress:{[opponentEntry.name]:0,[name]:0},positions:{[opponentEntry.name]:{x:-1.4,y:0,z:40,yaw:0,walk:0},[name]:{x:1.4,y:0,z:40,yaw:0,walk:0}},winner:null,reason:null,rankAwarded:false,startedAt:now,finishedAt:null,lastSeen:{[opponentEntry.name]:opponentEntry.lastSeen,[name]:now}};
      casualMatches.set(id,match);casualPlayerMatch.set(opponentEntry.name,id);casualPlayerMatch.set(name,id);
      return json(res,200,casualMatchView(match,name));
    }
    let waiting=casualQueue.get(name);casualQueue.set(name,{name,joinedAt:waiting?.joinedAt||now,lastSeen:now});
    return json(res,200,{status:'waiting',waitingSince:waiting?.joinedAt||now,queueSize:casualQueue.size});
  }
  if(req.method==='POST'&&u.pathname==='/api/casual-match/state'){
    let b=await body(req),name=cleanName(b.name);cleanupCasualMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let match=casualMatches.get(String(b.matchId||''));if(!match||!match.players.includes(name))return json(res,404,{error:'比赛已经结束或不存在'});
    match.lastSeen[name]=Date.now();return json(res,200,casualMatchView(match,name));
  }
  if(req.method==='POST'&&u.pathname==='/api/casual-match/sync'){
    let b=await body(req),name=cleanName(b.name);cleanupCasualMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let match=casualMatches.get(String(b.matchId||''));if(!match||!match.players.includes(name))return json(res,404,{error:'比赛已经结束或不存在'});
    match.lastSeen[name]=Date.now();if(match.status==='playing')match.positions[name]=cleanCasualPosition(b.position,match.positions[name]);
    return json(res,200,casualMatchView(match,name));
  }
  if(req.method==='POST'&&u.pathname==='/api/casual-match/progress'){
    let b=await body(req),name=cleanName(b.name);cleanupCasualMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    let match=casualMatches.get(String(b.matchId||''));if(!match||!match.players.includes(name))return json(res,404,{error:'比赛已经结束或不存在'});
    match.lastSeen[name]=Date.now();
    if(match.status==='playing'){
      let collected=Math.max(0,Math.min(10,Math.floor(Number(b.collected)||0)));match.progress[name]=Math.max(match.progress[name]||0,collected);
      if(match.progress[name]>=10){match.status='finished';match.winner=name;match.reason='collected_10';match.finishedAt=Date.now();awardCasualRankWin(match,name)}
    }
    return json(res,200,casualMatchView(match,name));
  }
  if(req.method==='POST'&&u.pathname==='/api/casual-match/leave'){
    let b=await body(req),name=cleanName(b.name);cleanupCasualMatches();
    if(!matchAuth(name,b.token))return json(res,401,{error:'账号验证失败，请重新登录'});
    casualQueue.delete(name);let id=String(b.matchId||casualPlayerMatch.get(name)||''),match=casualMatches.get(id);
    if(match?.status==='playing'&&match.players.includes(name)){let opponent=match.players.find(x=>x!==name);match.status='finished';match.winner=opponent;match.reason='opponent_left';match.finishedAt=Date.now();awardCasualRankWin(match,opponent)}
    return json(res,200,{ok:true});
  }
  if(req.method==='GET'&&u.pathname==='/api/leaderboard'){let board=Object.entries(players).map(([name,p])=>{let stashValue=(p.stash||[]).reduce((n,x)=>n+(Number(x.value)||0),0);return{name,money:p.money||0,stashValue,total:(p.money||0)+stashValue}}).sort((a,b)=>b.total-a.total).slice(0,100);return json(res,200,board)}
  let file=path.join(ROOT,decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(ROOT))return json(res,403,{error:'Forbidden'});fs.readFile(file,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(d)})
 }catch(e){console.error('request error', e);json(res,500,{error:'服务器错误'})}
}).listen(PORT,'0.0.0.0',()=>console.log(`Game server: http://0.0.0.0:${PORT}`));
