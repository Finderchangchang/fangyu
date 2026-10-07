// Restricted entry point for the standalone Block Isle distribution.
// Keep the shared backend unmodified, but expose only this game's routes.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'runtime-data'));
fs.mkdirSync(dataDir, { recursive: true });
for (const [variable, filename] of Object.entries({
  PLAYERS_DATA: 'players.json', REDEMPTIONS_DATA: 'redemptions.json',
  POWER_RANKING_DATA: 'power-ranking.json', POWER_ACCOUNTS_DATA: 'power-players.json',
  POWER_RECHARGE_REQUESTS_DATA: 'power-recharge-requests.json'
})) process.env[variable] = path.join(dataDir, filename);
process.env.PORT ||= '4301';

const files = new Set(['index.html', 'styles.css', 'controls.css', 'game.js',
  'storage.js', 'chunks.js', 'physics.js', 'world-core.js'].map(name => `/blockworld/${name}`));
files.add('/online-presence.js'); files.add('/online-presence.css');
files.add('/center-account.js');
files.add('/center-account.css');
files.add('/blockworld/survival.js'); files.add('/blockworld/animals.js');
files.add('/blockworld/day-night.js'); files.add('/blockworld/night-monsters.js');
files.add('/blockworld/music.js');
files.add('/blockworld/ranking.js');
files.add('/blockworld/cloud-storage.js');
files.add('/blockworld/bag.js');
files.add('/blockworld/room-life.js');
files.add('/blockworld/player-position.js');
files.add('/blockworld/merchant.js');
files.add('/blockworld/diagnostics.js');
for(const name of ['three.module.js','PointerLockControls.js','LICENSE']) files.add(`/blockworld/vendor/three/${name}`);
const apis = new Set(['/api/login', '/api/blockworld/room/join',
  '/api/blockworld/room/state', '/api/blockworld/room/snapshot', '/api/blockworld/room/leave']);
apis.add('/api/presence');
apis.add('/api/session');
apis.add('/api/blockworld/ranking');
apis.add('/api/blockworld/cloud');
apis.add('/api/blockworld/room/life');
const createServer = http.createServer;
http.createServer = function (handler) {
  return createServer.call(http, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400); return res.end('Bad request'); }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/blockworld/')) {
      if(url.pathname==='/blockworld/'){res.writeHead(302, { Location: '/blockworld/index.html' });return res.end();}
      req.url='/deploy/blockworld/lobby.html';return handler(req,res);
    }
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}');
    }
    if ((req.method === 'GET' && files.has(url.pathname)) || (req.method === 'POST' && apis.has(url.pathname))) {
      return handler(req, res);
    }
    res.writeHead(404); res.end('Not found');
  });
};
require(path.join(root, 'server.js'));
http.createServer = createServer;
