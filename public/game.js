/* ============================================================
   Arena — multiplayer game client
   Talks to server.js over WebSocket. Canvas overworld, catch
   minigame, PvP battles, evolution, chat, leaderboard.
   ============================================================ */
(function () {
  const P = window.PokeData;      // pixel trainer + pokéball
  const D = window.Pokedex;       // Gen-1 roster, types, assets
  const FX = window.SiteFX || { confetti() {}, setOnline() {} };
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = dex => (D.BY_DEX[dex] || {}).name || '???';
  const typeBadges = dex => (D.BY_DEX[dex] ? D.BY_DEX[dex].types : []).map(t => `<span class="type" style="--t:${D.TYPE_COLORS[t]}">${t}</span>`).join('');

  const TILE = 32;
  const T = { GRASS: 0, TALL: 1, WATER: 2, TREE: 3, PATH: 4, FLOWER: 5, SAND: 6 };
  const WALKABLE = new Set([T.GRASS, T.TALL, T.PATH, T.FLOWER, T.SAND]);
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const CHALLENGE_RANGE = 2;

  const canvas = $('game-canvas');
  // Phones get a squarer handheld-style viewport (more rows visible in portrait)
  if (window.matchMedia('(max-width: 820px)').matches) { canvas.width = 560; canvas.height = 480; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const VIEW_W = canvas.width, VIEW_H = canvas.height;

  /* ---------- State ---------- */
  let ws = null, connected = false, joined = false, myId = null;
  let map = null, mapCanvas = null;
  const players = new Map();
  const wilds = new Map();
  const bubbles = new Map();
  let party = [], activeIndex = 0, me = null;
  let encounter = null, battle = null, pendingChallenge = null;
  let leaderboardList = [], hallList = [];
  let lastFrame = performance.now(), lastMoveSent = 0, nearbyTick = 0, lastNearbyIds = '';
  const keys = new Set();
  let heldDir = null;
  let reconnectDelay = 1000;

  /* ---------- Assets ---------- */
  const imgCache = new Map();
  function img(src) { let i = imgCache.get(src); if (!i) { i = new Image(); i.src = src; imgCache.set(src, i); } return i; }
  const ready = i => i.complete && i.naturalWidth > 0;
  D.ROSTER.forEach(p => img(D.assets.front(p.dex)));
  const spriteUrl = (mon, back) => back ? D.assets.back(mon.dex) : D.assets.front(mon.dex, mon.shiny);
  const animUrl = (mon, back) => mon.shiny ? D.assets.front(mon.dex, true) : D.assets.anim(mon.dex, back);
  function setSprite(el, mon, back) {
    el.innerHTML = '';
    const im = document.createElement('img');
    im.alt = nameOf(mon.dex);
    im.src = animUrl(mon, back);
    im.onerror = () => { im.onerror = null; im.src = spriteUrl(mon, back); };
    el.appendChild(im);
    return im;
  }
  const spriteImg = (mon, size) => `<img class="mon" width="${size}" height="${size}" src="${spriteUrl(mon)}" alt="${esc(nameOf(mon.dex))}">${mon.shiny ? '<i class="shiny" title="Shiny">✦</i>' : ''}`;

  const cache = new Map();
  function trainerSprite(color, scale, flip) {
    const key = `t:${color}:${scale}:${flip ? 1 : 0}`;
    if (!cache.has(key)) cache.set(key, P.spriteToCanvas(P.TRAINER, scale, { A: color, C: '#f8fafc', B: '#1e3a8a' }, flip));
    return cache.get(key);
  }
  function ballSprite(scale) { const key = `b:${scale}`; if (!cache.has(key)) cache.set(key, P.spriteToCanvas(P.POKEBALL, scale)); return cache.get(key); }

  let audioOk = true;
  function playCry(dex, vol) {
    if (!audioOk) return;
    try { const a = new Audio(D.assets.cry(dex)); a.volume = vol == null ? 0.35 : vol; a.play().catch(() => {}); } catch (e) { audioOk = false; }
  }

  /* ---------- Map pre-render ---------- */
  function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
  function renderMap() {
    mapCanvas = document.createElement('canvas');
    mapCanvas.width = map.w * TILE; mapCanvas.height = map.h * TILE;
    const c = mapCanvas.getContext('2d');
    c.imageSmoothingEnabled = false;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.tiles[y][x], px = x * TILE, py = y * TILE, r = hash2(x, y);
      c.fillStyle = (t === T.PATH) ? '#d9b46b' : (t === T.SAND) ? '#e8d5a3' : (t === T.WATER) ? '#3b82f6' : (r < 0.5 ? '#5cb552' : '#57ad4d');
      c.fillRect(px, py, TILE, TILE);
      if (t === T.GRASS || t === T.FLOWER || t === T.TREE || t === T.TALL) {
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (let i = 0; i < 3; i++) { const rr = hash2(x * 3 + i, y * 5 + i); c.fillRect(px + Math.floor(rr * 28), py + Math.floor(hash2(y + i, x) * 28), 3, 3); }
      }
      if (t === T.PATH || t === T.SAND) { c.fillStyle = 'rgba(0,0,0,0.07)'; for (let i = 0; i < 4; i++) c.fillRect(px + Math.floor(hash2(x + i, y * 2) * 28), py + Math.floor(hash2(y * 3, x + i) * 28), 3, 2); }
      if (t === T.TALL) {
        c.fillStyle = '#2f8f3a'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#1f6f2c';
        for (let i = 0; i < 6; i++) { const bx = px + 2 + ((i * 5 + Math.floor(r * 4)) % 28), by = py + 6 + ((i * 7 + Math.floor(r * 9)) % 18); c.fillRect(bx, by, 3, 10); c.fillRect(bx + 3, by + 3, 2, 7); }
        c.fillStyle = '#4ac352';
        for (let i = 0; i < 4; i++) { const bx = px + 4 + ((i * 8 + Math.floor(r * 7)) % 24); c.fillRect(bx, py + 10 + (i * 3) % 12, 2, 8); }
      }
      if (t === T.FLOWER) {
        const cols = ['#ef4444', '#fde047', '#f9a8d4', '#ffffff'];
        c.fillStyle = cols[Math.floor(r * cols.length)];
        const fx = px + 8 + Math.floor(r * 12), fy = py + 8 + Math.floor(hash2(y, x) * 12);
        c.fillRect(fx, fy - 3, 3, 3); c.fillRect(fx, fy + 3, 3, 3); c.fillRect(fx - 3, fy, 3, 3); c.fillRect(fx + 3, fy, 3, 3);
        c.fillStyle = '#fbbf24'; c.fillRect(fx, fy, 3, 3);
      }
      if (t === T.WATER) { c.fillStyle = '#2563eb'; c.fillRect(px, py, TILE, TILE); c.fillStyle = '#60a5fa'; c.fillRect(px + 4 + Math.floor(r * 10), py + 8, 10, 2); c.fillRect(px + 14 - Math.floor(r * 8), py + 22, 8, 2); }
      if (t === T.TREE) {
        c.fillStyle = '#3d7a2c'; c.fillRect(px + 2, py + 4, 28, 26);
        c.fillStyle = '#2b5f1f'; c.fillRect(px + 2, py + 20, 28, 10);
        c.fillStyle = '#4f9a38'; c.fillRect(px + 6, py + 2, 20, 12); c.fillRect(px + 4, py + 8, 6, 8); c.fillRect(px + 22, py + 8, 6, 8);
        c.fillStyle = '#6cbf4a'; c.fillRect(px + 9, py + 4, 8, 5);
        c.fillStyle = '#5b3a1a'; c.fillRect(px + 13, py + 24, 6, 8);
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px + 2, py + 30, 28, 2);
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (map.tiles[y][x] !== T.WATER) continue;
      const px = x * TILE, py = y * TILE;
      if (y > 0 && map.tiles[y - 1][x] !== T.WATER) c.fillRect(px, py, TILE, 2);
      if (y < map.h - 1 && map.tiles[y + 1][x] !== T.WATER) c.fillRect(px, py + TILE - 2, TILE, 2);
      if (x > 0 && map.tiles[y][x - 1] !== T.WATER) c.fillRect(px, py, 2, TILE);
      if (x < map.w - 1 && map.tiles[y][x + 1] !== T.WATER) c.fillRect(px + TILE - 2, py, 2, TILE);
    }
  }
  const walkable = (x, y) => map && x >= 0 && y >= 0 && x < map.w && y < map.h && WALKABLE.has(map.tiles[y][x]);

  /* ---------- Networking ---------- */
  const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host || 'localhost:3000'}`;
  const send = obj => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  function connect() {
    try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
    ws.onopen = () => { connected = true; reconnectDelay = 1000; $('join-error').textContent = ''; };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    ws.onclose = () => {
      connected = false;
      if (joined) {
        joined = false; myId = null; me = null; battle = null; encounter = null;
        players.clear(); wilds.clear();
        hideAllOverlays();
        $('join-overlay').classList.remove('hidden');
        $('join-error').textContent = 'Disconnected — rejoin when ready.';
        setChatEnabled(false);
      }
      scheduleReconnect();
    };
    ws.onerror = () => {};
  }
  function scheduleReconnect() { setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(15000, reconnectDelay * 1.6); }

  function addPlayer(p) {
    const existing = players.get(p.id);
    if (existing) { Object.assign(existing, p); return existing; }
    p.rx = p.x * TILE; p.ry = p.y * TILE; p.tx = p.x; p.ty = p.y; p.frx = p.rx; p.fry = p.ry;
    players.set(p.id, p);
    return p;
  }

  function handle(m) {
    switch (m.t) {
      case 'stats':
        FX.setOnline(m.online);
        if (m.leaderboard) { leaderboardList = m.leaderboard; renderLeaderboard(); }
        if (m.hallOfFame) { hallList = m.hallOfFame; renderHall(); }
        break;
      case 'welcome':
        joined = true; myId = m.id; map = m.map; renderMap();
        players.clear(); wilds.clear();
        m.players.forEach(addPlayer);
        m.wilds.forEach(w => wilds.set(w.id, w));
        me = players.get(myId); party = m.party; activeIndex = m.active || 0;
        leaderboardList = m.leaderboard; renderLeaderboard();
        $('join-overlay').classList.add('hidden');
        setChatEnabled(true);
        renderMe(); renderParty();
        sysChat(`Welcome, ${me.name}. Wild Pokémon hide in tall grass.`);
        if (party[0] && party[0].shiny) toast('Your starter is SHINY. Lucky.', 'shiny');
        playCry(party[0].dex, 0.3);
        break;
      case 'player_join': addPlayer(m.player); sysChat(`${m.player.name} joined.`); break;
      case 'player_leave': players.delete(m.id); bubbles.delete(m.id); sysChat(`${m.name} left.`); break;
      case 'player_update': { const p = addPlayer(m.player); if (p.id === myId) { me = p; renderMe(); } break; }
      case 'move': { const p = players.get(m.id); if (!p) break; if (p.x !== m.x || p.y !== m.y) { p.tx = p.x; p.ty = p.y; } p.x = m.x; p.y = m.y; p.dir = m.dir; break; }
      case 'chat': addChat(m); bubbles.set(m.id, { text: m.text, until: performance.now() + 5000 }); break;
      case 'wild_spawn': wilds.set(m.wild.id, m.wild); img(D.assets.front(m.wild.dex, m.wild.shiny)); break;
      case 'wild_remove': wilds.delete(m.id); break;
      case 'encounter': startEncounter(m); break;
      case 'catch_result': onCatchResult(m); break;
      case 'encounter_end': onEncounterEnd(m); break;
      case 'evolve': onEvolve(m); break;
      case 'challenge_received': onChallengeReceived(m); break;
      case 'challenge_sent': toast(`Challenge sent to ${m.to.name}`, 'battle'); break;
      case 'challenge_declined': toast(`${m.by.name} declined.`, 'info'); break;
      case 'battle_start': startBattle(m.battle); break;
      case 'battle_waiting': battleLog('Waiting for opponent…', 'sys'); break;
      case 'battle_opponent_ready': battleLog('Opponent has chosen.', 'sys'); break;
      case 'battle_turn': onBattleTurn(m); break;
      case 'battle_end': onBattleEnd(m); break;
      case 'leaderboard': leaderboardList = m.list; renderLeaderboard(); break;
      case 'announce': toast(m.text, m.kind); if (m.kind === 'legendary' || m.kind === 'shiny') sysChat(m.text); break;
      case 'active_set': activeIndex = m.index; renderParty(); break;
      case 'error': toast(m.msg, 'error'); if (!joined) $('join-error').textContent = m.msg; break;
      default: break;
    }
  }

  /* ---------- Join UI ---------- */
  let selectedStarter = 25;
  (function buildStarterPicker() {
    const wrap = $('starter-picker');
    D.STARTERS.forEach(sp => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'starter' + (sp.dex === selectedStarter ? ' selected' : '');
      el.dataset.dex = sp.dex;
      el.innerHTML = `<img src="${D.assets.art(sp.dex)}" alt="${sp.name}"><b>${sp.name}</b><span class="types">${typeBadges(sp.dex)}</span>`;
      el.addEventListener('click', () => {
        selectedStarter = sp.dex;
        wrap.querySelectorAll('.starter').forEach(s => s.classList.toggle('selected', Number(s.dataset.dex) === sp.dex));
        playCry(sp.dex, 0.3);
      });
      wrap.appendChild(el);
    });
    try { const saved = localStorage.getItem('arena-name'); if (saved) $('join-name').value = saved; const col = localStorage.getItem('arena-color'); if (col) $('join-color').value = col; } catch (e) { /* ignore */ }
  })();
  function join() {
    if (!connected) { $('join-error').textContent = 'Connecting… try again in a second.'; return; }
    const name = $('join-name').value.trim(), color = $('join-color').value;
    try { localStorage.setItem('arena-name', name); localStorage.setItem('arena-color', color); } catch (e) { /* ignore */ }
    send({ t: 'join', name, starter: selectedStarter, color });
  }
  $('join-btn').addEventListener('click', join);
  $('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  function hideAllOverlays() { ['encounter-overlay', 'battle-overlay', 'challenge-toast', 'evo-overlay'].forEach(id => $(id).classList.add('hidden')); }

  /* ---------- Chat ---------- */
  function setChatEnabled(on) { $('chat-input').disabled = !on; $('chat-send').disabled = !on; }
  function pushChat(html, cls) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    log.appendChild(el);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  const addChat = m => pushChat(`<b style="color:${esc(m.color || '#fff')}">${esc(m.name)}</b> ${esc(m.text)}`, 'msg');
  const sysChat = text => pushChat(esc(text), 'sys');
  $('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('chat-input'), text = inp.value.trim();
    if (!text || !joined) return;
    send({ t: 'chat', text }); inp.value = ''; inp.blur();
  });

  /* ---------- Toasts ---------- */
  function toast(text, kind) {
    const wrap = $('game-toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || ''); el.textContent = text;
    wrap.appendChild(el);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 4200);
  }

  /* ---------- Side panels ---------- */
  function renderMe() {
    if (!me) return;
    $('me-card').innerHTML = `${spriteImg(me.mon, 56)}<div><div class="me-name" style="color:${esc(me.color)}">${esc(me.name)} <span class="lv">Lv ${me.level}</span></div><div class="me-stats"><span>${me.score} pts</span><span>${me.catches} caught</span><span>${me.wins}W ${me.losses}L</span></div></div>`;
  }
  function renderParty() {
    const wrap = $('party-list');
    wrap.innerHTML = party.map((mon, i) => `<button type="button" class="party-mon ${i === activeIndex ? 'active' : ''}" data-i="${i}" title="${esc(nameOf(mon.dex))}">${spriteImg(mon, 44)}<small>${esc(nameOf(mon.dex))}</small></button>`).join('') + (party.length < 6 ? `<div class="party-empty">${6 - party.length} free</div>` : '');
    wrap.querySelectorAll('.party-mon').forEach(b => b.addEventListener('click', () => { if (!battle && !encounter) send({ t: 'set_active', index: Number(b.dataset.i) }); }));
  }
  function renderLeaderboard() {
    $('leaderboard').innerHTML = leaderboardList.length ? leaderboardList.map((p, i) => `<li class="${p.id === myId ? 'me' : ''}"><span class="rank">${i + 1}</span>${spriteImg({ dex: p.dex, shiny: p.shiny }, 28)}<span class="nm">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`).join('') : '<li class="muted">No trainers yet</li>';
  }
  function renderHall() {
    $('hall-of-fame').innerHTML = hallList.length ? hallList.map((p, i) => `<li><span class="rank">${i + 1}</span>${p.dex ? spriteImg({ dex: p.dex, shiny: p.shiny }, 28) : ''}<span class="nm">${esc(p.name)}</span><span class="pts">${p.score}</span></li>`).join('') : '<li class="muted">Empty</li>';
  }
  function nearbyPlayers() {
    if (!me) return [];
    return [...players.values()].filter(p => p.id !== myId && Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y)) <= CHALLENGE_RANGE);
  }
  function renderNearby() {
    const list = nearbyPlayers();
    const sig = list.map(p => p.id + (p.busy ? 'b' : '')).join(',');
    if (sig === lastNearbyIds) return;
    lastNearbyIds = sig;
    const wrap = $('nearby-list');
    if (!list.length) { wrap.innerHTML = '<div class="muted">Walk up to a trainer to challenge them.</div>'; return; }
    wrap.innerHTML = list.map(p => `<div class="nearby">${spriteImg(p.mon, 28)}<span class="nm">${esc(p.name)} <small>Lv${p.level}</small></span><button class="btn btn-sm ${p.busy ? '' : 'btn-primary'}" data-id="${p.id}" ${p.busy ? 'disabled' : ''}>${p.busy ? 'Busy' : 'Battle'}</button></div>`).join('');
    wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => send({ t: 'challenge', id: b.dataset.id })));
  }

  /* ---------- Challenges ---------- */
  let challengeTimer = null;
  function onChallengeReceived(m) {
    pendingChallenge = m.from;
    $('challenge-text').textContent = `${m.from.name} (Lv${m.from.level}) wants to battle`;
    $('challenge-toast').classList.remove('hidden');
    clearTimeout(challengeTimer);
    challengeTimer = setTimeout(hideChallenge, Math.max(1000, m.expiresAt - Date.now()));
  }
  function hideChallenge() { $('challenge-toast').classList.add('hidden'); pendingChallenge = null; }
  $('challenge-accept').addEventListener('click', () => { if (pendingChallenge) send({ t: 'accept', id: pendingChallenge.id }); hideChallenge(); });
  $('challenge-decline').addEventListener('click', () => { if (pendingChallenge) send({ t: 'decline', id: pendingChallenge.id }); hideChallenge(); });
  function challengeNearest() {
    const list = nearbyPlayers().filter(p => !p.busy);
    if (!list.length) { toast('No trainer nearby.', 'info'); return; }
    list.sort((a, b) => (Math.abs(a.x - me.x) + Math.abs(a.y - me.y)) - (Math.abs(b.x - me.x) + Math.abs(b.y - me.y)));
    send({ t: 'challenge', id: list[0].id });
  }

  /* ---------- Encounter (catch minigame) ---------- */
  let encAnim = null, encT0 = 0, encPending = null;
  function startEncounter(m) {
    const w = m.wild, sp = D.BY_DEX[w.dex];
    encounter = { wild: w, sp, throws: m.throws, speed: 1.6, locked: false, pos: 0 };
    const spr = $('enc-sprite'); spr.className = 'enc-sprite'; setSprite(spr, w, false);
    const ball = $('enc-ball'); ball.innerHTML = ''; ball.className = 'enc-ball'; ball.appendChild(ballSprite(3));
    $('enc-title').innerHTML = `Wild <b>${esc(sp.name)}</b>${w.shiny ? ' <span class="shiny-tag">✦ shiny</span>' : ''} <span class="types">${typeBadges(w.dex)}</span>`;
    $('enc-msg').textContent = sp.rarity === 'legendary' ? 'Legendary. Make it count.' : 'Stop the marker in the green zone.';
    $('enc-throws').textContent = `${m.throws} Poké Balls`;
    $('enc-throw').disabled = false;
    $('encounter-overlay').classList.remove('hidden');
    playCry(w.dex);
    encT0 = performance.now();
    cancelAnimationFrame(encAnim);
    const tick = () => {
      if (!encounter) return;
      if (!encounter.locked) {
        const t = (performance.now() - encT0) / 1000;
        encounter.pos = (Math.sin(t * encounter.speed * Math.PI) + 1) / 2;
        $('enc-cursor').style.left = `calc(${(encounter.pos * 100).toFixed(2)}% - 2px)`;
      }
      encAnim = requestAnimationFrame(tick);
    };
    tick();
  }
  function throwBall() {
    if (!encounter || encounter.locked) return;
    encounter.locked = true;
    const d = Math.abs(encounter.pos - 0.5);
    const quality = d <= 0.03 ? 1 : d <= 0.15 ? 0.6 + ((0.15 - d) / 0.12) * 0.35 : Math.max(0, 0.3 - (d - 0.15));
    $('enc-throw').disabled = true;
    $('enc-msg').textContent = quality >= 1 ? 'Perfect throw.' : quality >= 0.6 ? 'Good throw.' : 'Weak throw…';
    const ball = $('enc-ball');
    ball.className = 'enc-ball throw';
    setTimeout(() => { ball.className = 'enc-ball wobble'; $('enc-sprite').classList.add('shake'); }, 550);
    encPending = null;
    send({ t: 'throw', quality });
    setTimeout(resolveThrow, 2100);
  }
  function resolveThrow() {
    if (!encounter) return;
    const r = encPending;
    if (!r) { setTimeout(resolveThrow, 200); return; }
    encPending = null;
    const ball = $('enc-ball');
    if (r.success) {
      $('enc-sprite').classList.add('caught');
      ball.className = 'enc-ball wobble';
      $('enc-msg').textContent = `Caught ${encounter.sp.name}. +${r.points} pts${r.isNew ? ' · new' : ''}${r.mon.shiny ? ' · shiny ×3' : ''}`;
      $('enc-throws').textContent = '';
      const rect = canvas.getBoundingClientRect();
      FX.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 80);
      party = r.party; renderParty();
      setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1600);
    } else {
      ball.className = 'enc-ball';
      $('enc-sprite').classList.remove('shake');
      if (r.fled) {
        $('enc-msg').textContent = `${encounter.sp.name} broke free and ran.`;
        setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1400);
      } else {
        encounter.throws = r.throwsLeft; encounter.speed += 0.5; encounter.locked = false;
        $('enc-throws').textContent = `${r.throwsLeft} Poké Ball${r.throwsLeft === 1 ? '' : 's'}`;
        $('enc-msg').textContent = 'It broke free. The marker is faster now.';
        $('enc-throw').disabled = false;
        encT0 = performance.now();
      }
    }
  }
  function onCatchResult(m) { encPending = m; }
  function onEncounterEnd(m) {
    if (!encounter) return;
    if (m.reason === 'timeout') { $('enc-msg').textContent = 'It wandered off.'; setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1200); }
    else if (m.reason === 'ran') { $('encounter-overlay').classList.add('hidden'); encounter = null; }
  }
  $('enc-throw').addEventListener('click', throwBall);
  $('enc-run').addEventListener('click', () => { if (encounter && !encounter.locked) send({ t: 'run' }); });

  /* ---------- Evolution ---------- */
  const evoQueue = [];
  let evoBusy = false;
  function onEvolve(m) { party = m.party; renderParty(); evoQueue.push(m); runEvo(); }
  function runEvo() {
    if (evoBusy || !evoQueue.length) return;
    evoBusy = true;
    const m = evoQueue.shift();
    const ov = $('evo-overlay');
    const from = { dex: m.from, shiny: m.shiny }, to = { dex: m.to, shiny: m.shiny };
    ov.classList.remove('hidden');
    ov.classList.remove('done');
    setSprite($('evo-sprite'), from, false);
    $('evo-text').textContent = `What? ${nameOf(m.from)} is evolving…`;
    playCry(m.from, 0.3);
    setTimeout(() => {
      setSprite($('evo-sprite'), to, false);
      ov.classList.add('done');
      $('evo-text').textContent = `${nameOf(m.from)} evolved into ${nameOf(m.to)}!`;
      playCry(m.to);
      const rect = canvas.getBoundingClientRect();
      FX.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 100);
      renderMe();
      setTimeout(() => { ov.classList.add('hidden'); evoBusy = false; runEvo(); }, 2600);
    }, 2400);
  }
  $('evo-overlay').addEventListener('click', () => { /* keep visible; auto-hides */ });

  /* ---------- Battle ---------- */
  let battleTimerInt = null;
  const currentHp = { me: 0, foe: 0 };
  function startBattle(b) {
    battle = { data: b, busy: false, over: false };
    currentHp.me = b.me.hp; currentHp.foe = b.foe.hp;
    hideChallenge();
    $('encounter-overlay').classList.add('hidden');
    const foe = $('foe-sprite'); foe.className = 'battle-sprite'; setSprite(foe, b.foe, false);
    const mine = $('me-sprite'); mine.className = 'battle-sprite'; setSprite(mine, b.me, true);
    $('foe-name').innerHTML = `${esc(nameOf(b.foe.dex))}${b.foe.shiny ? ' <i class="shiny">✦</i>' : ''} <small>${esc(b.foe.name)}</small>`;
    $('me-name').innerHTML = `${esc(nameOf(b.me.dex))}${b.me.shiny ? ' <i class="shiny">✦</i>' : ''} <small>you</small>`;
    $('foe-level').textContent = `Lv${b.foe.level}`; $('me-level').textContent = `Lv${b.me.level}`;
    $('foe-types').innerHTML = typeBadges(b.foe.dex); $('me-types').innerHTML = typeBadges(b.me.dex);
    setHp('foe', b.foe.hp, b.foe.maxHp); setHp('me', b.me.hp, b.me.maxHp);
    $('battle-log').innerHTML = '';
    battleLog(`${b.foe.name} sent out ${nameOf(b.foe.dex)}.`, 'sys');
    battleLog(`Go, ${nameOf(b.me.dex)}!`, 'sys');
    renderMoves(b.moves, true);
    $('battle-overlay').classList.remove('hidden');
    startTurnTimer(b.turnEndsAt);
    playCry(b.me.dex, 0.3);
    setTimeout(() => playCry(b.foe.dex, 0.3), 600);
  }
  function renderMoves(moves, enabled) {
    const wrap = $('battle-moves');
    wrap.innerHTML = moves.map((mv, i) => {
      const col = D.TYPE_COLORS[mv.type];
      const sub = mv.heal ? `heals ${mv.heal}` : `${mv.power} pwr · ${mv.acc}%`;
      return `<button class="move-btn" data-i="${i}" style="--t:${col}" ${enabled ? '' : 'disabled'}><span class="mv-name">${esc(mv.name)}</span><span class="mv-meta"><span class="type" style="--t:${col}">${mv.type}</span>${sub}</span></button>`;
    }).join('');
    wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => chooseMove(Number(b.dataset.i))));
  }
  function chooseMove(i) {
    if (!battle || battle.busy || battle.over) return;
    battle.busy = true;
    $('battle-moves').querySelectorAll('button').forEach(b => { b.disabled = true; });
    send({ t: 'battle_move', index: i });
    battleLog(`You chose ${battle.data.moves[i].name}.`, 'sys');
  }
  function setHp(side, hp, max) {
    const pct = Math.max(0, hp / max * 100);
    const fill = $(`${side}-hp`);
    fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#34d399' : pct > 20 ? '#fbbf24' : '#f87171';
    $(`${side}-hp-text`).textContent = `${hp}/${max}`;
  }
  function battleLog(text, cls) {
    const log = $('battle-log');
    const el = document.createElement('div');
    el.className = 'ev ' + (cls || ''); el.textContent = text;
    log.appendChild(el);
    while (log.children.length > 40) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function startTurnTimer(endsAt) {
    clearInterval(battleTimerInt);
    const tick = () => { const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); $('battle-timer').textContent = `Turn ${battle ? battle.data.turn : ''} · ${left}s`; };
    tick(); battleTimerInt = setInterval(tick, 500);
  }
  function onBattleTurn(m) {
    if (!battle) return;
    const b = battle.data;
    const who = pid => pid === myId ? nameOf(b.me.dex) : `${b.foe.name}'s ${nameOf(b.foe.dex)}`;
    let delay = 200;
    m.events.forEach(ev => {
      setTimeout(() => {
        if (!battle) return;
        if (ev.kind === 'hit') {
          const effTxt = ev.eff >= 2 ? ' Super effective.' : ev.eff <= 0.5 ? ' Not very effective.' : '';
          battleLog(`${who(ev.by)} used ${ev.move}. −${ev.dmg}${ev.crit ? ' · critical' : ''}.${effTxt}`, ev.eff >= 2 ? 'super' : ev.eff <= 0.5 ? 'weak' : '');
          const side = ev.target === myId ? 'me' : 'foe';
          const el = $(`${side}-sprite`); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
          currentHp[side] = Math.max(0, currentHp[side] - ev.dmg);
          setHp(side, currentHp[side], side === 'me' ? b.me.maxHp : b.foe.maxHp);
        } else if (ev.kind === 'heal') {
          battleLog(`${who(ev.by)} used ${ev.move}. +${ev.amount} HP.`, '');
          const side = ev.by === myId ? 'me' : 'foe';
          currentHp[side] = Math.min(side === 'me' ? b.me.maxHp : b.foe.maxHp, currentHp[side] + ev.amount);
          setHp(side, currentHp[side], side === 'me' ? b.me.maxHp : b.foe.maxHp);
        } else if (ev.kind === 'miss') battleLog(`${who(ev.by)} used ${ev.move}… it missed.`, 'weak');
        else if (ev.kind === 'immune') battleLog(`${who(ev.by)} used ${ev.move}. It doesn't affect ${who(ev.target)}.`, 'weak');
      }, delay);
      delay += 900;
    });
    setTimeout(() => {
      if (!battle) return;
      currentHp.me = m.me.hp; currentHp.foe = m.foe.hp;
      setHp('me', m.me.hp, m.me.maxHp); setHp('foe', m.foe.hp, m.foe.maxHp);
      b.turn = m.turn;
      if (!battle.over) { battle.busy = false; renderMoves(b.moves, true); startTurnTimer(m.turnEndsAt); }
    }, delay);
  }
  function onBattleEnd(m) {
    if (!battle) return;
    battle.over = true;
    clearInterval(battleTimerInt);
    const won = m.winner === myId;
    setTimeout(() => {
      if (!battle) return;
      const loserSide = won ? 'foe' : 'me';
      $(`${loserSide}-sprite`).classList.add('faint');
      playCry(loserSide === 'me' ? battle.data.me.dex : battle.data.foe.dex, 0.25);
      battleLog(won ? `You won. +${m.winPoints} pts.` : `You lost to ${m.winnerName}. +${m.lossPoints} pts.`, won ? 'super' : 'weak');
      if (m.reason === 'forfeit') battleLog(`${m.loserName} forfeited.`, 'sys');
      if (m.reason === 'disconnect') battleLog(`${m.loserName} disconnected.`, 'sys');
      $('battle-moves').querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (won) { const rect = canvas.getBoundingClientRect(); FX.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 100); }
      setTimeout(() => { $('battle-overlay').classList.add('hidden'); battle = null; }, 2600);
    }, m.reason === 'ko' ? 900 * 2 + 400 : 100);
  }
  $('battle-forfeit').addEventListener('click', () => { if (battle && !battle.over) send({ t: 'forfeit' }); });

  /* ---------- Input ---------- */
  const keyDir = { w: 'up', a: 'left', s: 'down', d: 'right', arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
  const isTyping = () => document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (isTyping()) { if (k === 'escape') document.activeElement.blur(); return; }
    if (!joined) return;
    if (keyDir[k]) { keys.add(keyDir[k]); if (k.startsWith('arrow')) e.preventDefault(); return; }
    if (k === 'enter') { e.preventDefault(); $('chat-input').focus(); return; }
    if (k === ' ' || k === 'e') {
      e.preventDefault();
      if (encounter) throwBall();
      else if (pendingChallenge) { send({ t: 'accept', id: pendingChallenge.id }); hideChallenge(); }
      else if (!battle) challengeNearest();
    }
  });
  window.addEventListener('keyup', e => { const d = keyDir[e.key.toLowerCase()]; if (d) keys.delete(d); });
  window.addEventListener('blur', () => keys.clear());
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) $('arena').classList.add('touch');
  $('dpad').querySelectorAll('button').forEach(b => {
    const dir = b.dataset.dir;
    const down = e => { e.preventDefault(); heldDir = dir; };
    const up = e => { e.preventDefault(); if (heldDir === dir) heldDir = null; };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  $('action-btn').addEventListener('click', () => {
    if (!joined) return;
    if (encounter) throwBall();
    else if (pendingChallenge) { send({ t: 'accept', id: pendingChallenge.id }); hideChallenge(); }
    else if (!battle) challengeNearest();
  });
  // Game Boy shell buttons (phones / touch): B = run/back, START = chat, SELECT = menu, COLOR = LCD toggle
  $('b-btn').addEventListener('click', () => {
    if (!joined) return;
    if (encounter && !encounter.locked) send({ t: 'run' });
    else if (pendingChallenge) { send({ t: 'decline', id: pendingChallenge.id }); hideChallenge(); }
    else if ($('arena-side').classList.contains('open')) $('arena-side').classList.remove('open');
  });
  $('start-btn').addEventListener('click', () => { if (joined) { $('chat-input').focus(); $('chat-form').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } });
  $('select-btn').addEventListener('click', () => { const side = $('arena-side'); side.classList.toggle('open'); if (side.classList.contains('open')) side.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
  const gbQuery = window.matchMedia('(max-width: 820px)');
  function applyLcd() {
    let pref = null;
    try { pref = localStorage.getItem('arena-lcd'); } catch (e) { /* ignore */ }
    $('arena-screen').classList.toggle('lcd', pref != null ? pref === '1' : gbQuery.matches);
  }
  applyLcd();
  gbQuery.addEventListener('change', applyLcd);
  $('lcd-toggle').addEventListener('click', () => {
    const on = !$('arena-screen').classList.contains('lcd');
    $('arena-screen').classList.toggle('lcd', on);
    try { localStorage.setItem('arena-lcd', on ? '1' : '0'); } catch (e) { /* ignore */ }
    toast(on ? 'LCD mode' : 'Colour mode', 'info');
  });
  function tryMove(now) {
    if (!joined || !me || encounter || battle) return;
    const dir = heldDir || (keys.size ? [...keys][keys.size - 1] : null);
    if (!dir || now - lastMoveSent < 120) return;
    lastMoveSent = now;
    send({ t: 'move', dir });
    const d = DIRS[dir];
    me.dir = dir;
    if (walkable(me.x + d[0], me.y + d[1])) { me.tx = me.x; me.ty = me.y; me.x += d[0]; me.y += d[1]; }
  }

  /* ---------- Rendering ---------- */
  function drawIdle(now) {
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#12151c';
    for (let y = 0; y < VIEW_H; y += 32) for (let x = 0; x < VIEW_W; x += 32) if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
    const t = now / 1000;
    D.STARTERS.forEach((sp, i) => { const im = img(D.assets.front(sp.dex)); if (ready(im)) ctx.drawImage(im, 250 + i * 90, 270 + Math.sin(t * 2 + i) * 6, 72, 72); });
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '600 13px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(connected ? 'Pick a starter to enter' : 'Connecting…', VIEW_W / 2, 400); ctx.textAlign = 'left';
  }

  function drawWorld(now, dt) {
    for (const p of players.values()) {
      const tx = p.x * TILE, ty = p.y * TILE, k = Math.min(1, dt * 14);
      p.rx += (tx - p.rx) * k; p.ry += (ty - p.ry) * k;
      if (Math.abs(tx - p.rx) < 0.5) p.rx = tx;
      if (Math.abs(ty - p.ry) < 0.5) p.ry = ty;
      const fx = (p.tx == null ? p.x : p.tx) * TILE, fy = (p.ty == null ? p.y : p.ty) * TILE;
      p.frx += (fx - p.frx) * Math.min(1, dt * 10); p.fry += (fy - p.fry) * Math.min(1, dt * 10);
    }
    const camX = Math.round(Math.max(0, Math.min(map.w * TILE - VIEW_W, me.rx + TILE / 2 - VIEW_W / 2)));
    const camY = Math.round(Math.max(0, Math.min(map.h * TILE - VIEW_H, me.ry + TILE / 2 - VIEW_H / 2)));
    ctx.drawImage(mapCanvas, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    const x0 = Math.floor(camX / TILE), y0 = Math.floor(camY / TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = y0; y <= y0 + VIEW_H / TILE + 1 && y < map.h; y++) for (let x = x0; x <= x0 + VIEW_W / TILE + 1 && x < map.w; x++) {
      if (map.tiles[y][x] !== T.WATER) continue;
      const ph = (now / 600 + x * 0.7 + y * 1.3) % (Math.PI * 2);
      ctx.fillRect(x * TILE - camX + 6 + Math.sin(ph) * 6, y * TILE - camY + 14 + Math.cos(ph * 0.5) * 6, 8, 2);
    }

    // Draw order: entities sorted by y
    const ents = [];
    for (const w of wilds.values()) ents.push({ kind: 'wild', y: w.y * TILE, w });
    for (const p of players.values()) { ents.push({ kind: 'player', y: p.ry, p }); ents.push({ kind: 'follower', y: p.fry - 1, p }); }
    ents.sort((a, b) => a.y - b.y);
    ctx.font = '600 12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const e of ents) {
      if (e.kind === 'wild') {
        const w = e.w, bob = Math.sin(now / 250 + w.x) * 2;
        const sx = w.x * TILE - camX, sy = w.y * TILE - camY + bob;
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 30, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
        const sp = D.BY_DEX[w.dex];
        if (sp.rarity === 'legendary' || w.shiny) { ctx.fillStyle = w.shiny ? `rgba(255,203,5,${0.25 + Math.sin(now / 200) * 0.12})` : `rgba(168,85,247,${0.25 + Math.sin(now / 200) * 0.12})`; ctx.beginPath(); ctx.arc(sx + 16, sy + 14, 24, 0, Math.PI * 2); ctx.fill(); }
        const im = img(D.assets.front(w.dex, w.shiny));
        if (ready(im)) ctx.drawImage(im, sx - 8, sy - 18, 48, 48);
      } else if (e.kind === 'follower') {
        const p = e.p;
        const sx = Math.round(p.frx - camX), sy = Math.round(p.fry - camY);
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        const im = img(D.assets.front(p.mon.dex, p.mon.shiny));
        const bob = Math.abs(p.frx - (p.tx == null ? p.x : p.tx) * TILE) > 1 || Math.abs(p.fry - (p.ty == null ? p.y : p.ty) * TILE) > 1 ? Math.round(Math.sin(now / 70)) : 0;
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 29, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
        if (ready(im)) ctx.drawImage(im, sx - 2, sy - 8 + bob, 36, 36);
      } else {
        const p = e.p;
        const sx = Math.round(p.rx - camX), sy = Math.round(p.ry - camY);
        if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
        const moving = Math.abs(p.rx - p.x * TILE) > 0.5 || Math.abs(p.ry - p.y * TILE) > 0.5;
        const step = moving ? Math.round(Math.sin(now / 60) * 1.5) : 0;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 31, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
        if (p.id === myId) { ctx.strokeStyle = 'rgba(255,203,5,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 31, 14, 6, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.drawImage(trainerSprite(p.color, 2, p.dir === 'left'), sx, sy - 6 + step);
        if (p.busy) { ctx.fillStyle = '#f87171'; ctx.fillRect(sx + 26, sy - 14, 4, 8); ctx.fillRect(sx + 26, sy - 4, 4, 3); }
        const label = p.name, w = ctx.measureText(label).width + 10;
        ctx.fillStyle = 'rgba(10,10,12,0.72)'; ctx.fillRect(sx + 16 - w / 2, sy - 24, w, 16);
        ctx.fillStyle = p.id === myId ? '#ffcb05' : '#fff'; ctx.fillText(label, sx + 16, sy - 12);
        const b = bubbles.get(p.id);
        if (b && b.until > now) {
          const text = b.text.length > 38 ? b.text.slice(0, 36) + '…' : b.text;
          const bw = Math.min(260, ctx.measureText(text).width + 14);
          const bx = Math.max(4, Math.min(VIEW_W - bw - 4, sx + 16 - bw / 2)), by = sy - 46;
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(bx, by, bw, 20, 6); ctx.fill();
          ctx.beginPath(); ctx.moveTo(sx + 12, by + 20); ctx.lineTo(sx + 16, by + 25); ctx.lineTo(sx + 20, by + 20); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#111'; ctx.fillText(text, bx + bw / 2, by + 14);
        } else if (b) bubbles.delete(p.id);
      }
    }
    ctx.textAlign = 'left';

    // Minimap
    const mw = 96, mh = Math.round(96 * map.h / map.w), mx = VIEW_W - mw - 10, my = 10;
    ctx.fillStyle = 'rgba(10,10,12,0.75)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    ctx.drawImage(mapCanvas, mx, my, mw, mh);
    for (const w of wilds.values()) { ctx.fillStyle = w.shiny ? '#ffcb05' : D.BY_DEX[w.dex].rarity === 'legendary' ? '#c084fc' : '#fff'; ctx.fillRect(mx + w.x / map.w * mw - 1, my + w.y / map.h * mh - 1, 2, 2); }
    for (const p of players.values()) { ctx.fillStyle = p.id === myId ? '#ffcb05' : p.color; ctx.fillRect(mx + p.x / map.w * mw - 2, my + p.y / map.h * mh - 2, 4, 4); }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + camX / (map.w * TILE) * mw, my + camY / (map.h * TILE) * mh, VIEW_W / (map.w * TILE) * mw, VIEW_H / (map.h * TILE) * mh);

    // HUD
    const near = nearbyPlayers().filter(p => !p.busy);
    let hint = '';
    if (near.length) hint = `Space — battle ${near[0].name}`;
    else if (map.tiles[me.y][me.x] === T.TALL) hint = 'Tall grass';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    if (hint) {
      const w = ctx.measureText(hint).width + 20;
      ctx.fillStyle = 'rgba(10,10,12,0.75)'; ctx.fillRect(VIEW_W / 2 - w / 2, VIEW_H - 36, w, 24);
      ctx.fillStyle = '#ffcb05'; ctx.textAlign = 'center'; ctx.fillText(hint, VIEW_W / 2, VIEW_H - 20); ctx.textAlign = 'left';
    }
    const hud = `${me.score} pts · ${me.catches} caught · ${me.wins}W`;
    const hw = ctx.measureText(hud).width + 20;
    ctx.fillStyle = 'rgba(10,10,12,0.75)'; ctx.fillRect(10, VIEW_H - 36, hw, 24);
    ctx.fillStyle = '#fff'; ctx.fillText(hud, 20, VIEW_H - 20);
  }

  let frames = 0;
  function loop(now) {
    frames++;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (joined && map && me) { tryMove(now); drawWorld(now, dt); if (now - nearbyTick > 300) { nearbyTick = now; renderNearby(); } }
    else drawIdle(now);
    requestAnimationFrame(loop);
  }

  // Read-only debug snapshot (used by tests; harmless in production)
  window.ArenaDebug = () => ({ joined, me, map, wilds: [...wilds.values()], players: [...players.values()], party, encounter: !!encounter, battle: !!battle, frames, keys: [...keys], heldDir, lastMoveSent, wsState: ws && ws.readyState, visible: document.visibilityState, move: dir => send({ t: 'move', dir }) });

  connect();
  requestAnimationFrame(loop);
})();
