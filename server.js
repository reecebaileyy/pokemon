/* ============================================================
   $POKEMON — site + arena server
   - Serves ./public as a static site
   - Live token metrics (/api/token, /api/chart) with caching
   - Authoritative multiplayer game over WebSockets
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Dex = require('./public/pokedex.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const HALL_FILE = path.join(DATA_DIR, 'hall-of-fame.json');

// ---------- Tunables ----------
const MAP_W = 48;
const MAP_H = 36;
const MAX_PLAYERS = 80;
const MAX_WILDS = 16;
const WILD_SPAWN_MS = 2500;
const WILD_LIFETIME_MS = 90000;
const SHINY_CHANCE = 1 / 32;
const MOVE_COOLDOWN_MS = 110;
const CHAT_COOLDOWN_MS = 700;
const ENCOUNTER_TIMEOUT_MS = 30000;
const ENCOUNTER_THROWS = 3;
const CHALLENGE_TIMEOUT_MS = 20000;
const CHALLENGE_RANGE = 2;
const BATTLE_TURN_MS = 25000;
const WIN_POINTS = 25;
const LOSS_POINTS = 5;

const T = { GRASS: 0, TALL: 1, WATER: 2, TREE: 3, PATH: 4, FLOWER: 5, SAND: 6 };
const WALKABLE = new Set([T.GRASS, T.TALL, T.PATH, T.FLOWER, T.SAND]);

// ---------- Site config (shared with the browser) ----------
function loadSiteConfig() {
  try {
    const src = fs.readFileSync(path.join(PUBLIC_DIR, 'config.js'), 'utf8');
    const win = {};
    new Function('window', src)(win); // config.js is a plain `window.SITE_CONFIG = {...}` assignment
    return win.SITE_CONFIG || {};
  } catch (e) { return {}; }
}
const SITE = loadSiteConfig();
const TOKEN_MINT = process.env.TOKEN_MINT || SITE.contract || '';
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_CACHE_MS = 30000;
const CHART_CACHE_MS = 60000;

// ---------- Live token metrics ----------
async function fetchJson(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const r = await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}, {
      headers: Object.assign({ accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; PokemonArena/1.0)' }, (opts && opts.headers) || {})
    }));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}
const rpc = (method, params) => fetchJson(SOLANA_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

const tokenCache = { at: 0, data: null, pending: null };
async function buildTokenMetrics() {
  const mint = TOKEN_MINT;
  const out = { mint, updatedAt: Date.now(), sources: {} };
  if (!mint || /REPLACE/i.test(mint)) { out.error = 'No contract address configured'; return out; }

  const [dex, rug, pump, supply, mintInfo] = await Promise.allSettled([
    fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`),
    fetchJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, null, 12000),
    fetchJson(`https://frontend-api-v3.pump.fun/coins/${mint}`),
    rpc('getTokenSupply', [mint]),
    rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }])
  ]);

  if (dex.status === 'fulfilled' && Array.isArray(dex.value.pairs) && dex.value.pairs.length) {
    const pairs = dex.value.pairs.filter(p => p.chainId === 'solana');
    const best = pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0))[0];
    out.sources.dexscreener = 'ok';
    out.name = best.baseToken.name; out.symbol = best.baseToken.symbol;
    out.priceUsd = Number(best.priceUsd); out.priceNative = Number(best.priceNative);
    out.marketCap = best.marketCap; out.fdv = best.fdv;
    out.liquidityUsd = best.liquidity ? best.liquidity.usd : null;
    out.volume = best.volume || {}; out.priceChange = best.priceChange || {}; out.txns = best.txns || {};
    out.pairAddress = best.pairAddress; out.dexId = best.dexId; out.dexUrl = best.url; out.pairCreatedAt = best.pairCreatedAt;
    out.imageUrl = best.info && best.info.imageUrl; out.socials = (best.info && best.info.socials) || []; out.websites = (best.info && best.info.websites) || [];
  } else out.sources.dexscreener = 'error';

  if (rug.status === 'fulfilled' && rug.value && typeof rug.value === 'object') {
    const r = rug.value;
    out.sources.rugcheck = 'ok';
    out.holders = r.totalHolders;
    out.rugScore = r.score_normalised;
    out.risks = (r.risks || []).map(x => ({ name: x.name, level: x.level }));
    const lpMarket = (r.markets || []).find(m => m.lp && m.lp.lpLockedPct != null && (m.lp.lpLockedUSD || 0) > 0) || (r.markets || [])[0];
    out.lpLockedPct = lpMarket && lpMarket.lp ? lpMarket.lp.lpLockedPct : r.lpLockedPct;
    out.topHolderPct = r.topHolders && r.topHolders[0] ? r.topHolders[0].pct : null;
    out.top10Pct = r.topHolders ? r.topHolders.slice(0, 10).reduce((s, h) => s + (h.pct || 0), 0) : null;
    out.rugged = !!r.rugged;
  } else out.sources.rugcheck = 'error';

  if (pump.status === 'fulfilled' && pump.value && pump.value.mint) {
    const p = pump.value;
    out.sources.pumpfun = 'ok';
    out.createdAt = p.created_timestamp || null;
    out.creator = p.creator || null;
    out.ctoAddress = p.cto_address || null;
    const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
    out.creatorBurned = p.creator === INCINERATOR || p.cto_address === INCINERATOR;
    out.bonded = !!p.complete;
    out.description = p.description || '';
    if (!out.marketCap && p.usd_market_cap) out.marketCap = Number(p.usd_market_cap);
    if (!out.imageUrl && p.image_uri) out.imageUrl = p.image_uri;
  } else out.sources.pumpfun = 'error';

  if (supply.status === 'fulfilled' && supply.value.result) {
    out.sources.rpc = 'ok';
    out.supply = supply.value.result.value.uiAmount;
    out.decimals = supply.value.result.value.decimals;
  } else out.sources.rpc = 'error';
  if (mintInfo.status === 'fulfilled' && mintInfo.value.result && mintInfo.value.result.value) {
    const info = mintInfo.value.result.value.data && mintInfo.value.result.value.data.parsed && mintInfo.value.result.value.data.parsed.info;
    if (info) {
      out.mintAuthority = info.mintAuthority || null;
      out.freezeAuthority = info.freezeAuthority || null;
      out.tokenProgram = mintInfo.value.result.value.owner;
    }
  }
  return out;
}

function getTokenMetrics() {
  const fresh = tokenCache.data && (Date.now() - tokenCache.at) < TOKEN_CACHE_MS;
  if (fresh) return Promise.resolve(tokenCache.data);
  if (tokenCache.pending) return tokenCache.pending;
  tokenCache.pending = buildTokenMetrics()
    .then(data => { tokenCache.data = data; tokenCache.at = Date.now(); return data; })
    .catch(err => {
      if (tokenCache.data) return Object.assign({}, tokenCache.data, { stale: true });
      return { mint: TOKEN_MINT, error: String(err && err.message || err), updatedAt: Date.now(), sources: {} };
    })
    .finally(() => { tokenCache.pending = null; });
  return tokenCache.pending;
}

// OHLCV candles from GeckoTerminal for the deepest pair
const chartCache = {}; // tf -> {at, data, pending}
const TIMEFRAMES = { '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4] };
async function buildChart(tf) {
  const metrics = await getTokenMetrics();
  const pool = metrics.pairAddress;
  if (!pool) return { error: 'No pair yet', candles: [] };
  const [unit, agg] = TIMEFRAMES[tf] || TIMEFRAMES['15m'];
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=300&currency=usd`, null, 10000);
  const list = (j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
  // GeckoTerminal returns newest first: [ts, o, h, l, c, v]
  const candles = list.slice().reverse().map(c => [c[0] * 1000, c[1], c[2], c[3], c[4], c[5]]);
  return { pool, tf, candles, updatedAt: Date.now() };
}
function getChart(tf) {
  tf = TIMEFRAMES[tf] ? tf : '15m';
  const c = chartCache[tf] || (chartCache[tf] = { at: 0, data: null, pending: null });
  if (c.data && Date.now() - c.at < CHART_CACHE_MS) return Promise.resolve(c.data);
  if (c.pending) return c.pending;
  c.pending = buildChart(tf)
    .then(d => { c.data = d; c.at = Date.now(); return d; })
    .catch(err => c.data ? Object.assign({}, c.data, { stale: true }) : { error: String(err && err.message || err), candles: [] })
    .finally(() => { c.pending = null; });
  return c.pending;
}
if (TOKEN_MINT) { getTokenMetrics().then(() => getChart('15m')); setInterval(getTokenMetrics, TOKEN_CACHE_MS); }

// ---------- Static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  let urlPath = decodeURIComponent(url.pathname);
  const json = (obj, cache) => { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': cache || 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  if (urlPath === '/api/stats') return json({ online: players.size, wilds: wilds.size, leaderboard: leaderboard(10), hallOfFame: hallOfFame.slice(0, 10) });
  if (urlPath === '/api/token') return void getTokenMetrics().then(d => json(d, 'public, max-age=15'));
  if (urlPath === '/api/chart') return void getChart(url.searchParams.get('tf')).then(d => json(d, 'public, max-age=30'));
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 — a wild 404 appeared!'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const isAsset = urlPath.startsWith('/assets/');
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : isAsset ? 'public, max-age=604800, immutable' : 'public, max-age=300' });
    res.end(data);
  });
});

// ---------- Deterministic map generation ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateMap(seed) {
  const rnd = mulberry32(seed);
  const map = [];
  for (let y = 0; y < MAP_H; y++) { const row = []; for (let x = 0; x < MAP_W; x++) row.push(T.GRASS); map.push(row); }
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) map[y][x] = t; };
  const blob = (cx, cy, rx, ry, t, sandRing) => {
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      const d = dx * dx + dy * dy + (rnd() - 0.5) * 0.25;
      if (d <= 1) set(x, y, t);
      else if (sandRing && d <= 1.45 && map[y] && map[y][x] === T.GRASS) set(x, y, T.SAND);
    }
  };
  blob(9, 8, 5, 3, T.WATER, true); blob(38, 27, 6, 4, T.WATER, true); blob(36, 7, 3, 2, T.WATER, true); blob(10, 28, 3, 3, T.WATER, true);
  for (let i = 0; i < 14; i++) {
    const cx = 3 + Math.floor(rnd() * (MAP_W - 6)), cy = 3 + Math.floor(rnd() * (MAP_H - 6));
    if (Math.abs(cx - MAP_W / 2) < 5 && Math.abs(cy - MAP_H / 2) < 5) continue;
    blob(cx, cy, 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2), T.TREE, false);
  }
  for (let i = 0; i < 12; i++) {
    const cx = 3 + Math.floor(rnd() * (MAP_W - 6)), cy = 3 + Math.floor(rnd() * (MAP_H - 6));
    const rx = 2 + Math.floor(rnd() * 4), ry = 2 + Math.floor(rnd() * 3);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (map[y] && map[y][x] === T.GRASS && rnd() > 0.15) set(x, y, T.TALL);
  }
  for (let i = 0; i < 90; i++) { const x = Math.floor(rnd() * MAP_W), y = Math.floor(rnd() * MAP_H); if (map[y][x] === T.GRASS) set(x, y, T.FLOWER); }
  const midX = Math.floor(MAP_W / 2), midY = Math.floor(MAP_H / 2);
  for (let x = 1; x < MAP_W - 1; x++) { set(x, midY, T.PATH); set(x, midY + 1, T.PATH); }
  for (let y = 1; y < MAP_H - 1; y++) { set(midX, y, T.PATH); set(midX + 1, y, T.PATH); }
  for (let y = midY - 2; y <= midY + 3; y++) for (let x = midX - 3; x <= midX + 4; x++) set(x, y, T.PATH);
  for (let x = 0; x < MAP_W; x++) { set(x, 0, T.TREE); set(x, MAP_H - 1, T.TREE); }
  for (let y = 0; y < MAP_H; y++) { set(0, y, T.TREE); set(MAP_W - 1, y, T.TREE); }
  return map;
}

const MAP_SEED = 20240817;
const map = generateMap(MAP_SEED);
const SPAWN = { x: Math.floor(MAP_W / 2), y: Math.floor(MAP_H / 2) };
const tallTiles = [];
for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (map[y][x] === T.TALL) tallTiles.push({ x, y });
const walkable = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && WALKABLE.has(map[y][x]);

// ---------- State ----------
const players = new Map();
const wilds = new Map();
const battles = new Map();
let hallOfFame = [];
try { if (fs.existsSync(HALL_FILE)) hallOfFame = JSON.parse(fs.readFileSync(HALL_FILE, 'utf8')); } catch (e) { hallOfFame = []; }

let hallDirty = false;
function recordHall(p) {
  if (!p || p.score <= 0) return;
  const mon = activeMon(p);
  const existing = hallOfFame.find(h => h.name.toLowerCase() === p.name.toLowerCase());
  if (existing) {
    if (p.score > existing.score) { Object.assign(existing, { score: p.score, catches: p.catches, wins: p.wins, dex: mon.dex, shiny: !!mon.shiny }); hallDirty = true; }
  } else { hallOfFame.push({ name: p.name, score: p.score, catches: p.catches, wins: p.wins, dex: mon.dex, shiny: !!mon.shiny }); hallDirty = true; }
  hallOfFame.sort((a, b) => b.score - a.score);
  hallOfFame = hallOfFame.slice(0, 50);
}
setInterval(() => {
  if (!hallDirty) return;
  hallDirty = false;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFile(HALL_FILE, JSON.stringify(hallOfFame, null, 2), () => {}); } catch (e) { /* ignore */ }
}, 5000);

const uid = () => crypto.randomBytes(6).toString('base64url');
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sanitizeName(raw) {
  let n = String(raw || '').replace(/[^\w \-]/g, '').trim().slice(0, 14);
  if (n.length < 2) n = 'Trainer' + Math.floor(Math.random() * 900 + 100);
  const taken = new Set([...players.values()].map(p => p.name.toLowerCase()));
  let candidate = n, i = 2;
  while (taken.has(candidate.toLowerCase())) candidate = n.slice(0, 11) + '#' + (i++);
  return candidate;
}
const sanitizeColor = c => /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c.toLowerCase() : '#e3350d';

const activeMon = p => p.party[p.active] || p.party[0];
const levelOf = p => 1 + Math.floor(p.catches / 2) + Math.floor(p.wins / 2);

function publicPlayer(p) {
  const mon = activeMon(p);
  return {
    id: p.id, name: p.name, x: p.x, y: p.y, dir: p.dir, color: p.color,
    mon: { dex: mon.dex, shiny: !!mon.shiny }, level: levelOf(p),
    score: p.score, catches: p.catches, wins: p.wins, losses: p.losses, busy: !!(p.battleId || p.encounter)
  };
}

function send(p, msg) { if (!p || !p.ws || p.ws.readyState !== 1) return; try { p.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
function sendWs(ws, msg) { if (ws.readyState !== 1) return; try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) { if (p.id === exceptId || p.ws.readyState !== 1) continue; try { p.ws.send(data); } catch (e) { /* ignore */ } }
}
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) { if (ws.readyState !== 1) continue; try { ws.send(data); } catch (e) { /* ignore */ } }
}

function leaderboard(n) {
  return [...players.values()].sort((a, b) => b.score - a.score || b.catches - a.catches).slice(0, n)
    .map(p => { const m = activeMon(p); return { id: p.id, name: p.name, score: p.score, catches: p.catches, wins: p.wins, dex: m.dex, shiny: !!m.shiny }; });
}
let lbDirty = true;
setInterval(() => { if (!lbDirty) return; lbDirty = false; broadcast({ t: 'leaderboard', list: leaderboard(10) }); }, 2000);
setInterval(() => broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size }), 10000);

// ---------- Evolution ----------
function checkEvolutions(p) {
  const level = levelOf(p);
  p.party.forEach((mon, index) => {
    const sp = Dex.BY_DEX[mon.dex];
    if (!sp || !sp.evolvesTo || level < sp.evolveLevel) return;
    const targets = [].concat(sp.evolvesTo);
    const to = targets[Math.floor(Math.random() * targets.length)];
    const from = mon.dex;
    mon.dex = to;
    send(p, { t: 'evolve', index, from, to, shiny: !!mon.shiny, party: p.party });
    broadcast({ t: 'announce', kind: 'evolve', text: `${p.name}'s ${Dex.BY_DEX[from].name} evolved into ${Dex.BY_DEX[to].name}!` }, p.id);
  });
}

// ---------- Wild spawns ----------
const WILD_TOTAL_WEIGHT = Dex.WILD.reduce((s, sp) => s + sp.weight, 0);
function pickSpecies() {
  let r = Math.random() * WILD_TOTAL_WEIGHT;
  for (const sp of Dex.WILD) { r -= sp.weight; if (r <= 0) return sp; }
  return Dex.WILD[0];
}
function wildAt(x, y) { for (const w of wilds.values()) if (w.x === x && w.y === y) return w; return null; }

function spawnWild() {
  if (wilds.size >= MAX_WILDS || tallTiles.length === 0) return;
  for (let tries = 0; tries < 20; tries++) {
    const tile = tallTiles[Math.floor(Math.random() * tallTiles.length)];
    if (wildAt(tile.x, tile.y)) continue;
    let occupied = false;
    for (const p of players.values()) if (p.x === tile.x && p.y === tile.y) { occupied = true; break; }
    if (occupied) continue;
    const sp = pickSpecies();
    const w = { id: uid(), dex: sp.dex, x: tile.x, y: tile.y, shiny: Math.random() < SHINY_CHANCE, expires: now() + WILD_LIFETIME_MS };
    wilds.set(w.id, w);
    broadcast({ t: 'wild_spawn', wild: w });
    if (sp.rarity === 'legendary') broadcast({ t: 'announce', kind: 'legendary', text: `A legendary ${sp.name} appeared somewhere in the tall grass!` });
    else if (w.shiny) broadcast({ t: 'announce', kind: 'shiny', text: `✨ A shiny ${sp.name} is roaming the grass!` });
    return;
  }
}
setInterval(() => {
  const t = now();
  for (const w of wilds.values()) if (w.expires <= t) { wilds.delete(w.id); broadcast({ t: 'wild_remove', id: w.id }); }
  if (players.size > 0) spawnWild();
}, WILD_SPAWN_MS);
for (let i = 0; i < 8; i++) spawnWild();

// ---------- Encounters ----------
function startEncounter(p, w) {
  wilds.delete(w.id);
  broadcast({ t: 'wild_remove', id: w.id });
  p.encounter = { wild: w, throwsLeft: ENCOUNTER_THROWS, timer: setTimeout(() => endEncounter(p, 'timeout'), ENCOUNTER_TIMEOUT_MS) };
  send(p, { t: 'encounter', wild: w, throws: ENCOUNTER_THROWS });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
}
function endEncounter(p, reason) {
  if (!p.encounter) return;
  clearTimeout(p.encounter.timer);
  const w = p.encounter.wild;
  p.encounter = null;
  send(p, { t: 'encounter_end', reason, dex: w.dex });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
}
function handleThrow(p, quality) {
  const enc = p.encounter;
  if (!enc) return;
  quality = clamp(Number(quality) || 0, 0, 1);
  const sp = Dex.BY_DEX[enc.wild.dex];
  const chance = clamp(sp.catchRate * (0.35 + 0.9 * quality), 0.05, 0.95);
  const success = Math.random() < chance;
  enc.throwsLeft -= 1;
  if (success) {
    const isNew = !p.party.some(m => m.dex === sp.dex);
    const mon = { dex: sp.dex, shiny: !!enc.wild.shiny };
    if (p.party.length < 6) p.party.push(mon);
    else p.party[5] = mon; // party full: newest replaces the last slot
    const points = sp.points * (mon.shiny ? 3 : 1) + (isNew ? 5 : 0);
    p.score += points; p.catches += 1; lbDirty = true;
    clearTimeout(enc.timer); p.encounter = null;
    send(p, { t: 'catch_result', success: true, mon, points, isNew, quality, party: p.party });
    checkEvolutions(p);
    recordHall(p);
    broadcast({ t: 'player_update', player: publicPlayer(p) });
    if (sp.rarity === 'legendary') broadcast({ t: 'announce', kind: 'legendary', text: `${p.name} caught a legendary ${sp.name}!` });
    else if (mon.shiny) broadcast({ t: 'announce', kind: 'shiny', text: `✨ ${p.name} caught a shiny ${sp.name}!` });
    else if (sp.rarity === 'rare' || sp.rarity === 'epic') broadcast({ t: 'announce', kind: 'catch', text: `${p.name} caught a ${sp.name}!` }, p.id);
  } else if (enc.throwsLeft <= 0) {
    send(p, { t: 'catch_result', success: false, dex: sp.dex, throwsLeft: 0, fled: true });
    endEncounter(p, 'fled');
  } else send(p, { t: 'catch_result', success: false, dex: sp.dex, throwsLeft: enc.throwsLeft, fled: false });
}

// ---------- Battles ----------
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function makeSide(p) {
  const mon = activeMon(p);
  const sp = Dex.BY_DEX[mon.dex];
  const level = levelOf(p);
  const maxHp = 100 + level * 6 + sp.stage * 15 + (sp.bulky ? 20 : 0);
  return { pid: p.id, name: p.name, dex: sp.dex, shiny: !!mon.shiny, level, stage: sp.stage, hp: maxHp, maxHp, move: null, color: p.color };
}
function battleView(b, forPid) {
  const me = b.a.pid === forPid ? b.a : b.b, foe = b.a.pid === forPid ? b.b : b.a;
  const strip = s => ({ pid: s.pid, name: s.name, dex: s.dex, shiny: s.shiny, level: s.level, hp: s.hp, maxHp: s.maxHp, color: s.color, types: Dex.BY_DEX[s.dex].types });
  return { id: b.id, turn: b.turn, me: strip(me), foe: strip(foe), moves: Dex.BY_DEX[me.dex].moves, turnEndsAt: b.turnEndsAt };
}
function startBattle(p1, p2) {
  const b = { id: uid(), a: makeSide(p1), b: makeSide(p2), turn: 1, timer: null, turnEndsAt: now() + BATTLE_TURN_MS };
  battles.set(b.id, b);
  p1.battleId = b.id; p2.battleId = b.id; p1.pendingChallenge = null; p2.pendingChallenge = null;
  send(p1, { t: 'battle_start', battle: battleView(b, p1.id) });
  send(p2, { t: 'battle_start', battle: battleView(b, p2.id) });
  broadcast({ t: 'player_update', player: publicPlayer(p1) });
  broadcast({ t: 'player_update', player: publicPlayer(p2) });
  broadcast({ t: 'announce', kind: 'battle', text: `${p1.name} vs ${p2.name} — battle started` });
  armTurnTimer(b);
}
function armTurnTimer(b) {
  clearTimeout(b.timer);
  b.turnEndsAt = now() + BATTLE_TURN_MS;
  b.timer = setTimeout(() => {
    if (!battles.has(b.id)) return;
    for (const side of [b.a, b.b]) if (side.move == null) side.move = Math.floor(Math.random() * 4);
    resolveTurn(b);
  }, BATTLE_TURN_MS);
}
function chooseMove(p, index) {
  const b = battles.get(p.battleId);
  if (!b) return;
  const side = b.a.pid === p.id ? b.a : b.b;
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index > 3 || side.move != null) return;
  side.move = index;
  const other = side === b.a ? b.b : b.a;
  if (other.move != null) resolveTurn(b);
  else { send(p, { t: 'battle_waiting' }); send(players.get(other.pid), { t: 'battle_opponent_ready' }); }
}
function resolveTurn(b) {
  clearTimeout(b.timer);
  const spA = Dex.BY_DEX[b.a.dex], spB = Dex.BY_DEX[b.b.dex];
  const mvA = spA.moves[b.a.move] || spA.moves[0], mvB = spB.moves[b.b.move] || spB.moves[0];
  const prA = (mvA.priority || 0) * 100 + spA.speed + Math.random() * 2, prB = (mvB.priority || 0) * 100 + spB.speed + Math.random() * 2;
  const order = prA >= prB ? [b.a, b.b] : [b.b, b.a];
  const events = [];
  let winner = null;
  for (const attacker of order) {
    const defender = attacker === b.a ? b.b : b.a;
    if (attacker.hp <= 0) continue;
    const sp = Dex.BY_DEX[attacker.dex], defSp = Dex.BY_DEX[defender.dex];
    const mv = sp.moves[attacker.move] || sp.moves[0];
    if (mv.heal) {
      const before = attacker.hp;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + mv.heal + attacker.level * 2);
      events.push({ kind: 'heal', by: attacker.pid, move: mv.name, type: mv.type, amount: attacker.hp - before });
      continue;
    }
    if (Math.random() * 100 >= mv.acc) { events.push({ kind: 'miss', by: attacker.pid, move: mv.name, type: mv.type }); continue; }
    const eff = Dex.effectiveness(mv.type, defSp.types);
    if (eff === 0) { events.push({ kind: 'immune', by: attacker.pid, target: defender.pid, move: mv.name, type: mv.type }); continue; }
    const stab = sp.types.includes(mv.type) ? 1.2 : 1;
    const crit = Math.random() < 0.08 ? 1.6 : 1;
    const roll = 0.85 + Math.random() * 0.3;
    const dmg = Math.max(1, Math.round(mv.power * (1 + attacker.level * 0.06 + attacker.stage * 0.15) * eff * stab * crit * roll));
    defender.hp = Math.max(0, defender.hp - dmg);
    events.push({ kind: 'hit', by: attacker.pid, target: defender.pid, move: mv.name, type: mv.type, dmg, eff, crit: crit > 1 });
    if (defender.hp <= 0) { winner = attacker; break; }
  }
  b.a.move = null; b.b.move = null; b.turn += 1;
  const pA = players.get(b.a.pid), pB = players.get(b.b.pid);
  const payload = side => { const other = side === b.a ? b.b : b.a; return { t: 'battle_turn', events, me: { hp: side.hp, maxHp: side.maxHp }, foe: { hp: other.hp, maxHp: other.maxHp }, turn: b.turn, turnEndsAt: now() + BATTLE_TURN_MS }; };
  send(pA, payload(b.a)); send(pB, payload(b.b));
  if (winner) endBattle(b, winner.pid, (winner === b.a ? b.b : b.a).pid, 'ko');
  else armTurnTimer(b);
}
function endBattle(b, winnerId, loserId, reason) {
  clearTimeout(b.timer);
  battles.delete(b.id);
  const w = players.get(winnerId), l = players.get(loserId);
  if (w) { w.score += WIN_POINTS; w.wins += 1; w.battleId = null; }
  if (l) { l.score += LOSS_POINTS; l.losses += 1; l.battleId = null; }
  lbDirty = true;
  const msg = { t: 'battle_end', winner: winnerId, loser: loserId, reason, winnerName: w ? w.name : '?', loserName: l ? l.name : '?', winPoints: WIN_POINTS, lossPoints: LOSS_POINTS };
  send(w, msg); send(l, msg);
  if (w) { checkEvolutions(w); recordHall(w); broadcast({ t: 'player_update', player: publicPlayer(w) }); }
  if (l) { recordHall(l); broadcast({ t: 'player_update', player: publicPlayer(l) }); }
  if (w && l) broadcast({ t: 'announce', kind: 'battle', text: `${w.name} defeated ${l.name}${reason === 'forfeit' ? ' (forfeit)' : reason === 'disconnect' ? ' (disconnect)' : ''}` });
}
function handleChallenge(p, targetId) {
  const target = players.get(targetId);
  if (!target || target.id === p.id) return send(p, { t: 'error', msg: 'That trainer is not here.' });
  if (p.battleId || p.encounter) return send(p, { t: 'error', msg: 'You are busy.' });
  if (target.battleId || target.encounter) return send(p, { t: 'error', msg: `${target.name} is busy right now.` });
  if (distance(p, target) > CHALLENGE_RANGE) return send(p, { t: 'error', msg: 'Get closer to challenge them.' });
  if (target.pendingChallenge && target.pendingChallenge.from === p.id) return;
  if (p.pendingChallenge && p.pendingChallenge.from === target.id) return handleAccept(p, target.id);
  target.pendingChallenge = { from: p.id, expires: now() + CHALLENGE_TIMEOUT_MS };
  send(target, { t: 'challenge_received', from: publicPlayer(p), expiresAt: target.pendingChallenge.expires });
  send(p, { t: 'challenge_sent', to: publicPlayer(target) });
}
function handleAccept(p, fromId) {
  const pc = p.pendingChallenge;
  if (!pc || pc.from !== fromId) return;
  p.pendingChallenge = null;
  const from = players.get(fromId);
  if (!from) return send(p, { t: 'error', msg: 'They left.' });
  if (pc.expires < now()) return send(p, { t: 'error', msg: 'Challenge expired.' });
  if (from.battleId || from.encounter || p.battleId || p.encounter) return send(p, { t: 'error', msg: 'Someone is busy.' });
  if (distance(p, from) > CHALLENGE_RANGE + 1) return send(p, { t: 'error', msg: 'Too far apart now.' });
  startBattle(from, p);
}
function handleDecline(p, fromId) {
  const pc = p.pendingChallenge;
  if (!pc || pc.from !== fromId) return;
  p.pendingChallenge = null;
  send(players.get(fromId), { t: 'challenge_declined', by: publicPlayer(p) });
}

// ---------- Movement ----------
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function handleMove(p, dir) {
  const d = DIRS[dir];
  if (!d || p.battleId || p.encounter) return;
  const t = now();
  if (t - p.lastMove < MOVE_COOLDOWN_MS) return;
  p.lastMove = t; p.dir = dir;
  const nx = p.x + d[0], ny = p.y + d[1];
  if (walkable(nx, ny)) { p.x = nx; p.y = ny; }
  broadcast({ t: 'move', id: p.id, x: p.x, y: p.y, dir: p.dir });
  const w = wildAt(p.x, p.y);
  if (w) startEncounter(p, w);
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let player = null;
  sendWs(ws, { t: 'stats', online: players.size, wilds: wilds.size, leaderboard: leaderboard(10), hallOfFame: hallOfFame.slice(0, 10) });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (player) return;
      if (players.size >= MAX_PLAYERS) return sendWs(ws, { t: 'error', msg: 'The arena is full. Try again soon.' });
      const starterDex = Dex.STARTERS.some(s => s.dex === Number(msg.starter)) ? Number(msg.starter) : Dex.STARTERS[0].dex;
      player = {
        id: uid(), ws, name: sanitizeName(msg.name), color: sanitizeColor(msg.color),
        x: SPAWN.x + Math.floor(Math.random() * 6) - 3, y: SPAWN.y + Math.floor(Math.random() * 4) - 2, dir: 'down',
        party: [{ dex: starterDex, shiny: Math.random() < SHINY_CHANCE }], active: 0,
        score: 0, catches: 0, wins: 0, losses: 0, lastMove: 0, lastChat: 0, battleId: null, encounter: null, pendingChallenge: null
      };
      if (!walkable(player.x, player.y)) { player.x = SPAWN.x; player.y = SPAWN.y; }
      players.set(player.id, player);
      sendWs(ws, {
        t: 'welcome', id: player.id, you: publicPlayer(player), party: player.party, active: player.active,
        map: { w: MAP_W, h: MAP_H, tiles: map, seed: MAP_SEED },
        players: [...players.values()].map(publicPlayer), wilds: [...wilds.values()], leaderboard: leaderboard(10)
      });
      broadcast({ t: 'player_join', player: publicPlayer(player) }, player.id);
      broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size });
      lbDirty = true;
      return;
    }
    if (!player) return;

    switch (msg.t) {
      case 'move': handleMove(player, msg.dir); break;
      case 'face': if (DIRS[msg.dir]) { player.dir = msg.dir; broadcast({ t: 'move', id: player.id, x: player.x, y: player.y, dir: player.dir }, player.id); } break;
      case 'chat': {
        const t = now();
        if (t - player.lastChat < CHAT_COOLDOWN_MS) return;
        const text = String(msg.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
        if (!text) return;
        player.lastChat = t;
        broadcast({ t: 'chat', id: player.id, name: player.name, text, color: player.color });
        break;
      }
      case 'throw': handleThrow(player, msg.quality); break;
      case 'run': endEncounter(player, 'ran'); break;
      case 'challenge': handleChallenge(player, String(msg.id || '')); break;
      case 'accept': handleAccept(player, String(msg.id || '')); break;
      case 'decline': handleDecline(player, String(msg.id || '')); break;
      case 'battle_move': chooseMove(player, msg.index); break;
      case 'forfeit': { const b = battles.get(player.battleId); if (b) endBattle(b, b.a.pid === player.id ? b.b.pid : b.a.pid, player.id, 'forfeit'); break; }
      case 'set_active': {
        if (player.battleId || player.encounter) return;
        const i = Number(msg.index);
        if (Number.isInteger(i) && i >= 0 && i < player.party.length) {
          player.active = i;
          send(player, { t: 'active_set', index: i });
          broadcast({ t: 'player_update', player: publicPlayer(player) });
        }
        break;
      }
      case 'ping': send(player, { t: 'pong', at: msg.at }); break;
      default: break;
    }
  });

  ws.on('close', () => {
    if (!player) return;
    const p = player;
    player = null;
    players.delete(p.id);
    if (p.encounter) clearTimeout(p.encounter.timer);
    const b = battles.get(p.battleId);
    if (b) endBattle(b, b.a.pid === p.id ? b.b.pid : b.a.pid, p.id, 'disconnect');
    recordHall(p);
    broadcast({ t: 'player_leave', id: p.id, name: p.name });
    broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size });
    lbDirty = true;
  });
  ws.on('error', () => { /* handled by close */ });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`\n  $POKEMON arena live →  http://localhost:${PORT}`);
  console.log(`  map ${MAP_W}x${MAP_H} · ${tallTiles.length} tall-grass tiles · ${wilds.size} wilds pre-spawned · mint ${TOKEN_MINT || '(none)'}\n`);
});
