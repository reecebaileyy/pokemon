/* ============================================================
   CTO Arena server
   - Serves ./public as a static site
   - Runs the authoritative multiplayer game over WebSockets
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Poke = require('./public/sprites.js');

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
const MOVE_COOLDOWN_MS = 110;
const CHAT_COOLDOWN_MS = 700;
const ENCOUNTER_TIMEOUT_MS = 30000;
const ENCOUNTER_THROWS = 3;
const CHALLENGE_TIMEOUT_MS = 20000;
const CHALLENGE_RANGE = 2;
const BATTLE_TURN_MS = 25000;
const WIN_POINTS = 25;
const LOSS_POINTS = 5;

// Tile ids
const T = { GRASS: 0, TALL: 1, WATER: 2, TREE: 3, PATH: 4, FLOWER: 5, SAND: 6 };
const WALKABLE = new Set([T.GRASS, T.TALL, T.PATH, T.FLOWER, T.SAND]);

// ---------- Static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if (urlPath === '/api/stats') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ online: players.size, wilds: wilds.size, leaderboard: leaderboard(10), hallOfFame: hallOfFame.slice(0, 10) }));
    return;
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 — a wild 404 appeared!');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
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
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) row.push(T.GRASS);
    map.push(row);
  }
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) map[y][x] = t; };
  const blob = (cx, cy, rx, ry, t, sandRing) => {
    for (let y = cy - ry - 1; y <= cy + ry + 1; y++) {
      for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d = dx * dx + dy * dy + (rnd() - 0.5) * 0.25;
        if (d <= 1) set(x, y, t);
        else if (sandRing && d <= 1.45) { if (map[y] && map[y][x] === T.GRASS) set(x, y, T.SAND); }
      }
    }
  };

  // Lakes
  blob(9, 8, 5, 3, T.WATER, true);
  blob(38, 27, 6, 4, T.WATER, true);
  blob(36, 7, 3, 2, T.WATER, true);
  blob(10, 28, 3, 3, T.WATER, true);

  // Tree groves
  for (let i = 0; i < 14; i++) {
    const cx = 3 + Math.floor(rnd() * (MAP_W - 6));
    const cy = 3 + Math.floor(rnd() * (MAP_H - 6));
    if (Math.abs(cx - MAP_W / 2) < 5 && Math.abs(cy - MAP_H / 2) < 5) continue;
    blob(cx, cy, 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2), T.TREE, false);
  }

  // Tall grass patches (encounter zones)
  for (let i = 0; i < 12; i++) {
    const cx = 3 + Math.floor(rnd() * (MAP_W - 6));
    const cy = 3 + Math.floor(rnd() * (MAP_H - 6));
    const rx = 2 + Math.floor(rnd() * 4), ry = 2 + Math.floor(rnd() * 3);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (map[y] && map[y][x] === T.GRASS && rnd() > 0.15) set(x, y, T.TALL);
    }
  }

  // Flowers sprinkled
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rnd() * MAP_W), y = Math.floor(rnd() * MAP_H);
    if (map[y][x] === T.GRASS) set(x, y, T.FLOWER);
  }

  // Roads through the middle (cross) — always walkable
  const midX = Math.floor(MAP_W / 2), midY = Math.floor(MAP_H / 2);
  for (let x = 1; x < MAP_W - 1; x++) { set(x, midY, T.PATH); set(x, midY + 1, T.PATH); }
  for (let y = 1; y < MAP_H - 1; y++) { set(midX, y, T.PATH); set(midX + 1, y, T.PATH); }
  // Plaza in the center
  for (let y = midY - 2; y <= midY + 3; y++) for (let x = midX - 3; x <= midX + 4; x++) set(x, y, T.PATH);

  // Border trees
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
const players = new Map();   // id -> player
const wilds = new Map();     // id -> wild
const battles = new Map();   // id -> battle
let hallOfFame = [];

try {
  if (fs.existsSync(HALL_FILE)) hallOfFame = JSON.parse(fs.readFileSync(HALL_FILE, 'utf8'));
} catch (e) { hallOfFame = []; }

let hallDirty = false;
function recordHall(p) {
  if (!p || p.score <= 0) return;
  const existing = hallOfFame.find(h => h.name.toLowerCase() === p.name.toLowerCase());
  if (existing) {
    if (p.score > existing.score) { existing.score = p.score; existing.catches = p.catches; existing.wins = p.wins; existing.starter = p.active; hallDirty = true; }
  } else {
    hallOfFame.push({ name: p.name, score: p.score, catches: p.catches, wins: p.wins, starter: p.active });
    hallDirty = true;
  }
  hallOfFame.sort((a, b) => b.score - a.score);
  hallOfFame = hallOfFame.slice(0, 50);
}
setInterval(() => {
  if (!hallDirty) return;
  hallDirty = false;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(HALL_FILE, JSON.stringify(hallOfFame, null, 2), () => {});
  } catch (e) { /* ignore */ }
}, 5000);

const uid = () => crypto.randomBytes(6).toString('base64url');
const now = () => Date.now();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function sanitizeName(raw) {
  let n = String(raw || '').replace(/[^\w \-]/g, '').trim().slice(0, 14);
  if (n.length < 2) n = 'Trainer' + Math.floor(Math.random() * 900 + 100);
  const taken = new Set([...players.values()].map(p => p.name.toLowerCase()));
  let candidate = n, i = 2;
  while (taken.has(candidate.toLowerCase())) { candidate = n.slice(0, 11) + '#' + (i++); }
  return candidate;
}

function sanitizeColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c.toLowerCase() : '#e3350d';
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, x: p.x, y: p.y, dir: p.dir, color: p.color, active: p.active,
    score: p.score, catches: p.catches, wins: p.wins, losses: p.losses, busy: !!(p.battleId || p.encounter),
    level: levelOf(p)
  };
}

function levelOf(p) { return 1 + Math.floor(p.catches / 2) + Math.floor(p.wins / 2); }

function send(p, msg) {
  if (!p || !p.ws || p.ws.readyState !== 1) return;
  try { p.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
}
function sendWs(ws, msg) {
  if (ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ }
}
function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id === exceptId || p.ws.readyState !== 1) continue;
    try { p.ws.send(data); } catch (e) { /* ignore */ }
  }
}
function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    try { ws.send(data); } catch (e) { /* ignore */ }
  }
}

function leaderboard(n) {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || b.catches - a.catches)
    .slice(0, n)
    .map(p => ({ id: p.id, name: p.name, score: p.score, catches: p.catches, wins: p.wins, active: p.active }));
}

let lbDirty = true;
setInterval(() => {
  if (!lbDirty) return;
  lbDirty = false;
  broadcast({ t: 'leaderboard', list: leaderboard(10) });
}, 2000);

setInterval(() => {
  broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size });
}, 10000);

// ---------- Wild spawns ----------
function pickSpecies() {
  const total = Poke.SPECIES.reduce((s, sp) => s + sp.weight, 0);
  let r = Math.random() * total;
  for (const sp of Poke.SPECIES) { r -= sp.weight; if (r <= 0) return sp; }
  return Poke.SPECIES[0];
}

function wildAt(x, y) {
  for (const w of wilds.values()) if (w.x === x && w.y === y) return w;
  return null;
}

function spawnWild() {
  if (wilds.size >= MAX_WILDS || tallTiles.length === 0) return;
  for (let tries = 0; tries < 20; tries++) {
    const tile = tallTiles[Math.floor(Math.random() * tallTiles.length)];
    if (wildAt(tile.x, tile.y)) continue;
    let occupied = false;
    for (const p of players.values()) if (p.x === tile.x && p.y === tile.y) { occupied = true; break; }
    if (occupied) continue;
    const sp = pickSpecies();
    const w = { id: uid(), species: sp.id, x: tile.x, y: tile.y, expires: now() + WILD_LIFETIME_MS };
    wilds.set(w.id, w);
    broadcast({ t: 'wild_spawn', wild: w });
    if (sp.rarity === 'legendary') broadcast({ t: 'announce', kind: 'legendary', text: 'A legendary Moonwhale surfaced somewhere in the tall grass!' });
    return;
  }
}

setInterval(() => {
  const t = now();
  for (const w of wilds.values()) {
    if (w.expires <= t) { wilds.delete(w.id); broadcast({ t: 'wild_remove', id: w.id }); }
  }
  if (players.size > 0) spawnWild();
}, WILD_SPAWN_MS);

// Pre-seed some wilds so the world isn't empty on first join
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
  send(p, { t: 'encounter_end', reason, species: w.species });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
}

function handleThrow(p, quality) {
  const enc = p.encounter;
  if (!enc) return;
  quality = clamp(Number(quality) || 0, 0, 1);
  const sp = Poke.SPECIES_BY_ID[enc.wild.species];
  const chance = clamp(sp.catchRate * (0.35 + 0.9 * quality), 0.05, 0.95);
  const success = Math.random() < chance;
  enc.throwsLeft -= 1;
  if (success) {
    const isNew = !p.party.includes(sp.id);
    if (isNew) p.party.push(sp.id);
    const points = sp.points + (isNew ? 5 : 0);
    p.score += points;
    p.catches += 1;
    lbDirty = true;
    recordHall(p);
    clearTimeout(enc.timer);
    p.encounter = null;
    send(p, { t: 'catch_result', success: true, species: sp.id, points, isNew, quality, party: p.party });
    broadcast({ t: 'player_update', player: publicPlayer(p) });
    if (sp.rarity === 'legendary') broadcast({ t: 'announce', kind: 'legendary', text: `${p.name} caught a legendary MOONWHALE! 🐋` });
    else if (sp.rarity === 'uncommon') broadcast({ t: 'announce', kind: 'catch', text: `${p.name} caught a ${sp.name}!` }, p.id);
  } else if (enc.throwsLeft <= 0) {
    send(p, { t: 'catch_result', success: false, species: sp.id, throwsLeft: 0, fled: true });
    endEncounter(p, 'fled');
  } else {
    send(p, { t: 'catch_result', success: false, species: sp.id, throwsLeft: enc.throwsLeft, fled: false });
  }
}

// ---------- Battles ----------
function distance(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function makeSide(p) {
  const sp = Poke.SPECIES_BY_ID[p.active] || Poke.SPECIES[0];
  const level = levelOf(p);
  const maxHp = 100 + level * 5;
  return { pid: p.id, name: p.name, species: sp.id, level, hp: maxHp, maxHp, move: null, color: p.color };
}

function battleView(b, forPid) {
  const me = b.a.pid === forPid ? b.a : b.b;
  const foe = b.a.pid === forPid ? b.b : b.a;
  const strip = s => ({ pid: s.pid, name: s.name, species: s.species, level: s.level, hp: s.hp, maxHp: s.maxHp, color: s.color });
  return { id: b.id, turn: b.turn, me: strip(me), foe: strip(foe), moves: Poke.SPECIES_BY_ID[me.species].moves, turnEndsAt: b.turnEndsAt };
}

function startBattle(p1, p2) {
  const b = { id: uid(), a: makeSide(p1), b: makeSide(p2), turn: 1, timer: null, turnEndsAt: now() + BATTLE_TURN_MS };
  battles.set(b.id, b);
  p1.battleId = b.id; p2.battleId = b.id;
  p1.pendingChallenge = null; p2.pendingChallenge = null;
  send(p1, { t: 'battle_start', battle: battleView(b, p1.id) });
  send(p2, { t: 'battle_start', battle: battleView(b, p2.id) });
  broadcast({ t: 'player_update', player: publicPlayer(p1) });
  broadcast({ t: 'player_update', player: publicPlayer(p2) });
  broadcast({ t: 'announce', kind: 'battle', text: `⚔️ ${p1.name} vs ${p2.name} — battle started!` });
  armTurnTimer(b);
}

function armTurnTimer(b) {
  clearTimeout(b.timer);
  b.turnEndsAt = now() + BATTLE_TURN_MS;
  b.timer = setTimeout(() => {
    if (!battles.has(b.id)) return;
    for (const side of [b.a, b.b]) {
      if (side.move == null) side.move = Math.floor(Math.random() * 4);
    }
    resolveTurn(b);
  }, BATTLE_TURN_MS);
}

function chooseMove(p, index) {
  const b = battles.get(p.battleId);
  if (!b) return;
  const side = b.a.pid === p.id ? b.a : b.b;
  index = Number(index);
  if (!Number.isInteger(index) || index < 0 || index > 3) return;
  if (side.move != null) return;
  side.move = index;
  const other = side === b.a ? b.b : b.a;
  if (other.move != null) resolveTurn(b);
  else {
    send(p, { t: 'battle_waiting' });
    send(players.get(other.pid), { t: 'battle_opponent_ready' });
  }
}

function resolveTurn(b) {
  clearTimeout(b.timer);
  const spA = Poke.SPECIES_BY_ID[b.a.species], spB = Poke.SPECIES_BY_ID[b.b.species];
  // Order by speed (+ small random), ties random
  const speedA = spA.speed + Math.random() * 2, speedB = spB.speed + Math.random() * 2;
  const order = speedA >= speedB ? [b.a, b.b] : [b.b, b.a];
  const events = [];
  let winner = null;

  for (const attacker of order) {
    const defender = attacker === b.a ? b.b : b.a;
    if (attacker.hp <= 0) continue;
    const sp = Poke.SPECIES_BY_ID[attacker.species];
    const mv = sp.moves[attacker.move] || sp.moves[0];
    if (mv.heal) {
      const before = attacker.hp;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + mv.heal + attacker.level);
      events.push({ kind: 'heal', by: attacker.pid, move: mv.name, amount: attacker.hp - before, hpA: b.a.hp, hpB: b.b.hp });
    } else {
      const hit = Math.random() * 100 < mv.acc;
      if (!hit) {
        events.push({ kind: 'miss', by: attacker.pid, move: mv.name, hpA: b.a.hp, hpB: b.b.hp });
      } else {
        const defSp = Poke.SPECIES_BY_ID[defender.species];
        const eff = Poke.effectiveness(mv.type, defSp.type);
        const stab = mv.type === sp.type ? 1.15 : 1;
        const crit = Math.random() < 0.08 ? 1.6 : 1;
        const roll = 0.85 + Math.random() * 0.3;
        const dmg = Math.max(1, Math.round(mv.power * (1 + attacker.level * 0.07) * eff * stab * crit * roll));
        defender.hp = Math.max(0, defender.hp - dmg);
        events.push({ kind: 'hit', by: attacker.pid, target: defender.pid, move: mv.name, type: mv.type, dmg, eff, crit: crit > 1, hpA: b.a.hp, hpB: b.b.hp });
        if (defender.hp <= 0) { winner = attacker; break; }
      }
    }
  }

  b.a.move = null; b.b.move = null;
  b.turn += 1;
  const pA = players.get(b.a.pid), pB = players.get(b.b.pid);
  const payload = side => ({ t: 'battle_turn', events, me: { hp: side.hp, maxHp: side.maxHp }, foe: { hp: (side === b.a ? b.b : b.a).hp, maxHp: (side === b.a ? b.b : b.a).maxHp }, turn: b.turn, turnEndsAt: now() + BATTLE_TURN_MS });
  send(pA, payload(b.a));
  send(pB, payload(b.b));

  if (winner) {
    const loser = winner === b.a ? b.b : b.a;
    endBattle(b, winner.pid, loser.pid, 'ko');
  } else {
    armTurnTimer(b);
  }
}

function endBattle(b, winnerId, loserId, reason) {
  clearTimeout(b.timer);
  battles.delete(b.id);
  const w = players.get(winnerId), l = players.get(loserId);
  if (w) { w.score += WIN_POINTS; w.wins += 1; w.battleId = null; recordHall(w); }
  if (l) { l.score += LOSS_POINTS; l.losses += 1; l.battleId = null; recordHall(l); }
  lbDirty = true;
  const msg = { t: 'battle_end', winner: winnerId, loser: loserId, reason, winnerName: w ? w.name : '?', loserName: l ? l.name : '?', winPoints: WIN_POINTS, lossPoints: LOSS_POINTS };
  send(w, msg); send(l, msg);
  if (w) broadcast({ t: 'player_update', player: publicPlayer(w) });
  if (l) broadcast({ t: 'player_update', player: publicPlayer(l) });
  if (w && l) broadcast({ t: 'announce', kind: 'battle', text: `🏆 ${w.name} defeated ${l.name}${reason === 'forfeit' ? ' (forfeit)' : ''}!` });
}

function handleChallenge(p, targetId) {
  const target = players.get(targetId);
  if (!target || target.id === p.id) return send(p, { t: 'error', msg: 'That trainer is not here.' });
  if (p.battleId || p.encounter) return send(p, { t: 'error', msg: 'You are busy.' });
  if (target.battleId || target.encounter) return send(p, { t: 'error', msg: `${target.name} is busy right now.` });
  if (distance(p, target) > CHALLENGE_RANGE) return send(p, { t: 'error', msg: 'Get closer to challenge them!' });
  if (target.pendingChallenge && target.pendingChallenge.from === p.id) return;
  // If they already challenged us, accept immediately
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
  if (!d) return;
  if (p.battleId || p.encounter) return;
  const t = now();
  if (t - p.lastMove < MOVE_COOLDOWN_MS) return;
  p.lastMove = t;
  p.dir = dir;
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
      if (players.size >= MAX_PLAYERS) return sendWs(ws, { t: 'error', msg: 'The arena is full. Try again soon!' });
      const starter = Poke.SPECIES_BY_ID[msg.starter] && Poke.SPECIES_BY_ID[msg.starter].starter ? msg.starter : 'embercub';
      player = {
        id: uid(), ws, name: sanitizeName(msg.name), color: sanitizeColor(msg.color),
        x: SPAWN.x + Math.floor(Math.random() * 6) - 3, y: SPAWN.y + Math.floor(Math.random() * 4) - 2, dir: 'down',
        active: starter, party: [starter], score: 0, catches: 0, wins: 0, losses: 0,
        lastMove: 0, lastChat: 0, battleId: null, encounter: null, pendingChallenge: null
      };
      if (!walkable(player.x, player.y)) { player.x = SPAWN.x; player.y = SPAWN.y; }
      players.set(player.id, player);
      sendWs(ws, {
        t: 'welcome', id: player.id, you: publicPlayer(player), party: player.party,
        map: { w: MAP_W, h: MAP_H, tiles: map, seed: MAP_SEED },
        players: [...players.values()].map(publicPlayer),
        wilds: [...wilds.values()],
        leaderboard: leaderboard(10)
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
      case 'forfeit': {
        const b = battles.get(player.battleId);
        if (b) { const other = b.a.pid === player.id ? b.b.pid : b.a.pid; endBattle(b, other, player.id, 'forfeit'); }
        break;
      }
      case 'set_active': {
        if (player.battleId || player.encounter) return;
        if (player.party.includes(msg.species)) {
          player.active = msg.species;
          send(player, { t: 'active_set', species: player.active });
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
    if (b) { const other = b.a.pid === p.id ? b.b.pid : b.a.pid; endBattle(b, other, p.id, 'disconnect'); }
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
  console.log(`\n  ⚡ CTO Arena is live →  http://localhost:${PORT}\n`);
  console.log(`  map ${MAP_W}x${MAP_H} · ${tallTiles.length} tall-grass tiles · ${wilds.size} wilds pre-spawned\n`);
});
