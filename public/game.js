/* ============================================================
   CTO Arena — multiplayer game client
   Talks to server.js over WebSocket. Canvas rendering,
   catch minigame, PvP battle UI, chat, leaderboard.
   ============================================================ */
(function () {
  const P = window.PokeData;
  const FX = window.SiteFX || { confetti() {}, playCry() {}, setOnline() {} };
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TILE = 32;
  const T = { GRASS: 0, TALL: 1, WATER: 2, TREE: 3, PATH: 4, FLOWER: 5, SAND: 6 };
  const WALKABLE = new Set([T.GRASS, T.TALL, T.PATH, T.FLOWER, T.SAND]);
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const CHALLENGE_RANGE = 2;

  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const VIEW_W = canvas.width, VIEW_H = canvas.height;

  /* ---------- State ---------- */
  let ws = null, connected = false, joined = false, myId = null;
  let map = null, mapCanvas = null;
  const players = new Map();   // id -> {..., rx, ry}
  const wilds = new Map();
  const bubbles = new Map();   // id -> {text, until}
  let party = [], me = null;
  let encounter = null, battle = null, pendingChallenge = null;
  let leaderboardList = [], hallList = [];
  let lastFrame = performance.now();
  let lastMoveSent = 0;
  const keys = new Set();
  let heldDir = null; // mobile
  let lastNearbyIds = '';
  let reconnectDelay = 1000;

  /* ---------- Sprite cache ---------- */
  const cache = new Map();
  function speciesSprite(id, scale, flip) {
    const key = `s:${id}:${scale}:${flip ? 1 : 0}`;
    if (!cache.has(key)) cache.set(key, P.spriteToCanvas((P.SPECIES_BY_ID[id] || P.SPECIES[0]).pixels, scale, null, flip));
    return cache.get(key);
  }
  function trainerSprite(color, scale, flip) {
    const key = `t:${color}:${scale}:${flip ? 1 : 0}`;
    if (!cache.has(key)) cache.set(key, P.spriteToCanvas(P.TRAINER, scale, { A: color, C: '#f8fafc', B: '#1e3a8a' }, flip));
    return cache.get(key);
  }
  function ballSprite(scale) {
    const key = `b:${scale}`;
    if (!cache.has(key)) cache.set(key, P.spriteToCanvas(P.POKEBALL, scale));
    return cache.get(key);
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
      // base grass
      c.fillStyle = (t === T.PATH) ? '#d9b46b' : (t === T.SAND) ? '#e8d5a3' : (t === T.WATER) ? '#3b82f6' : (r < 0.5 ? '#5cb552' : '#57ad4d');
      c.fillRect(px, py, TILE, TILE);
      if (t === T.GRASS || t === T.FLOWER || t === T.TREE || t === T.TALL) {
        c.fillStyle = 'rgba(255,255,255,0.08)';
        for (let i = 0; i < 3; i++) { const rr = hash2(x * 3 + i, y * 5 + i); c.fillRect(px + Math.floor(rr * 28), py + Math.floor(hash2(y + i, x) * 28), 3, 3); }
      }
      if (t === T.PATH || t === T.SAND) {
        c.fillStyle = 'rgba(0,0,0,0.07)';
        for (let i = 0; i < 4; i++) { c.fillRect(px + Math.floor(hash2(x + i, y * 2) * 28), py + Math.floor(hash2(y * 3, x + i) * 28), 3, 2); }
      }
      if (t === T.TALL) {
        c.fillStyle = '#2f8f3a';
        c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#1f6f2c';
        for (let i = 0; i < 6; i++) {
          const bx = px + 2 + ((i * 5 + Math.floor(r * 4)) % 28), by = py + 6 + ((i * 7 + Math.floor(r * 9)) % 18);
          c.fillRect(bx, by, 3, 10); c.fillRect(bx + 3, by + 3, 2, 7);
        }
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
      if (t === T.WATER) {
        c.fillStyle = '#2563eb'; c.fillRect(px, py, TILE, TILE);
        c.fillStyle = '#60a5fa';
        c.fillRect(px + 4 + Math.floor(r * 10), py + 8, 10, 2); c.fillRect(px + 14 - Math.floor(r * 8), py + 22, 8, 2);
      }
      if (t === T.TREE) {
        c.fillStyle = '#3d7a2c'; c.fillRect(px + 2, py + 4, 28, 26);
        c.fillStyle = '#2b5f1f'; c.fillRect(px + 2, py + 20, 28, 10);
        c.fillStyle = '#4f9a38'; c.fillRect(px + 6, py + 2, 20, 12); c.fillRect(px + 4, py + 8, 6, 8); c.fillRect(px + 22, py + 8, 6, 8);
        c.fillStyle = '#6cbf4a'; c.fillRect(px + 9, py + 4, 8, 5);
        c.fillStyle = '#5b3a1a'; c.fillRect(px + 13, py + 24, 6, 8);
        c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(px + 2, py + 30, 28, 2);
      }
    }
    // Water shoreline outline
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
  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const host = location.host || 'localhost:3000';
    return `${proto}://${host}`;
  }
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
        $('join-error').textContent = 'Disconnected from the arena — rejoin when ready.';
        setChatEnabled(false);
      }
      scheduleReconnect();
    };
    ws.onerror = () => { /* onclose handles */ };
  }
  function scheduleReconnect() { setTimeout(connect, reconnectDelay); reconnectDelay = Math.min(15000, reconnectDelay * 1.6); }

  function addPlayer(p) {
    const existing = players.get(p.id);
    if (existing) { Object.assign(existing, p); return existing; }
    p.rx = p.x * TILE; p.ry = p.y * TILE;
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
        me = players.get(myId); party = m.party;
        leaderboardList = m.leaderboard; renderLeaderboard();
        $('join-overlay').classList.add('hidden');
        setChatEnabled(true);
        renderMe(); renderParty();
        sysChat(`Welcome, ${me.name}! Walk into tall grass to find wild mons.`);
        toast('You entered the arena. WASD to move.', 'info');
        break;
      case 'player_join': addPlayer(m.player); sysChat(`${m.player.name} joined the arena.`); break;
      case 'player_leave': players.delete(m.id); bubbles.delete(m.id); sysChat(`${m.name} left.`); break;
      case 'player_update': {
        const p = addPlayer(m.player);
        if (p.id === myId) { me = p; renderMe(); }
        break;
      }
      case 'move': {
        const p = players.get(m.id);
        if (!p) break;
        p.x = m.x; p.y = m.y; p.dir = m.dir;
        break;
      }
      case 'chat': addChat(m); bubbles.set(m.id, { text: m.text, until: performance.now() + 5000 }); break;
      case 'wild_spawn': wilds.set(m.wild.id, Object.assign({ born: performance.now() }, m.wild)); break;
      case 'wild_remove': wilds.delete(m.id); break;
      case 'encounter': startEncounter(m); break;
      case 'catch_result': onCatchResult(m); break;
      case 'encounter_end': onEncounterEnd(m); break;
      case 'challenge_received': onChallengeReceived(m); break;
      case 'challenge_sent': toast(`Challenge sent to ${m.to.name}…`, 'battle'); break;
      case 'challenge_declined': toast(`${m.by.name} declined your challenge.`, 'info'); break;
      case 'battle_start': startBattle(m.battle); break;
      case 'battle_waiting': battleLog('Waiting for opponent…', 'sys'); break;
      case 'battle_opponent_ready': battleLog('Opponent has chosen a move!', 'sys'); break;
      case 'battle_turn': onBattleTurn(m); break;
      case 'battle_end': onBattleEnd(m); break;
      case 'leaderboard': leaderboardList = m.list; renderLeaderboard(); break;
      case 'announce': toast(m.text, m.kind); if (m.kind === 'legendary') sysChat(m.text); break;
      case 'active_set': if (me) { me.active = m.species; renderMe(); renderParty(); } break;
      case 'error': toast(m.msg, 'error'); if (!joined) $('join-error').textContent = m.msg; break;
      default: break;
    }
  }

  /* ---------- Join UI ---------- */
  let selectedStarter = 'embercub';
  (function buildStarterPicker() {
    const wrap = $('starter-picker');
    P.SPECIES.filter(s => s.starter).forEach(sp => {
      const el = document.createElement('div');
      el.className = 'starter' + (sp.id === selectedStarter ? ' selected' : '');
      el.dataset.id = sp.id;
      el.appendChild(P.spriteToCanvas(sp.pixels, 4));
      el.insertAdjacentHTML('beforeend', `<b>${esc(sp.name)}</b><small>${P.TYPES[sp.type].icon} ${sp.type}</small>`);
      el.addEventListener('click', () => {
        selectedStarter = sp.id;
        wrap.querySelectorAll('.starter').forEach(s => s.classList.toggle('selected', s.dataset.id === sp.id));
        FX.playCry(sp.id);
      });
      wrap.appendChild(el);
    });
    try { const saved = localStorage.getItem('cto-name'); if (saved) $('join-name').value = saved; const col = localStorage.getItem('cto-color'); if (col) $('join-color').value = col; } catch (e) { /* ignore */ }
  })();

  function join() {
    if (!connected) { $('join-error').textContent = 'Connecting to the arena… try again in a second.'; return; }
    const name = $('join-name').value.trim();
    const color = $('join-color').value;
    try { localStorage.setItem('cto-name', name); localStorage.setItem('cto-color', color); } catch (e) { /* ignore */ }
    send({ t: 'join', name, starter: selectedStarter, color });
  }
  $('join-btn').addEventListener('click', join);
  $('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  function hideAllOverlays() {
    $('encounter-overlay').classList.add('hidden');
    $('battle-overlay').classList.add('hidden');
    $('challenge-toast').classList.add('hidden');
  }

  /* ---------- Chat ---------- */
  function setChatEnabled(on) { $('chat-input').disabled = !on; $('chat-send').disabled = !on; }
  function addChat(m) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'msg';
    el.innerHTML = `<b style="color:${esc(m.color || '#fff')}">${esc(m.name)}:</b> ${esc(m.text)}`;
    log.appendChild(el);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function sysChat(text) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'sys'; el.textContent = text;
    log.appendChild(el);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  $('chat-form').addEventListener('submit', e => {
    e.preventDefault();
    const inp = $('chat-input');
    const text = inp.value.trim();
    if (!text || !joined) return;
    send({ t: 'chat', text });
    inp.value = '';
    inp.blur();
  });

  /* ---------- Toasts ---------- */
  function toast(text, kind) {
    const wrap = $('game-toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    wrap.appendChild(el);
    while (wrap.children.length > 4) wrap.removeChild(wrap.firstChild);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 400ms'; setTimeout(() => el.remove(), 400); }, 4200);
  }

  /* ---------- Side panels ---------- */
  function renderMe() {
    if (!me) return;
    const card = $('me-card');
    card.innerHTML = '';
    card.appendChild(speciesSprite(me.active, 3));
    card.insertAdjacentHTML('beforeend', `<div><div><b style="color:${esc(me.color)}">${esc(me.name)}</b> <small class="muted">Lv ${me.level}</small></div><div class="stats"><span>Score <b>${me.score}</b></span><span>Caught <b>${me.catches}</b></span><span>W/L <b>${me.wins}/${me.losses}</b></span></div></div>`);
  }
  function renderParty() {
    const wrap = $('party-list');
    wrap.innerHTML = '';
    party.forEach(id => {
      const sp = P.SPECIES_BY_ID[id];
      const el = document.createElement('div');
      el.className = 'party-mon' + (me && me.active === id ? ' active' : '');
      el.title = `${sp.name} — click to make active`;
      el.appendChild(speciesSprite(id, 2));
      el.insertAdjacentHTML('beforeend', `<small>${esc(sp.name)}</small>`);
      el.addEventListener('click', () => { if (!battle && !encounter) send({ t: 'set_active', species: id }); });
      wrap.appendChild(el);
    });
  }
  function renderLeaderboard() {
    const ol = $('leaderboard');
    ol.innerHTML = leaderboardList.length ? leaderboardList.map(p => `<li class="${p.id === myId ? 'me' : ''}"><span>${esc(p.name)}</span><span>${p.score} pts</span></li>`).join('') : '<li class="muted">Nobody yet — be first!</li>';
  }
  function renderHall() {
    const ol = $('hall-of-fame');
    ol.innerHTML = hallList.length ? hallList.map(p => `<li><span>${esc(p.name)}</span><span>${p.score} pts</span></li>`).join('') : '<li class="muted">No legends yet.</li>';
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
    if (!list.length) { wrap.innerHTML = '<span class="muted">Walk up to someone to challenge them.</span>'; return; }
    wrap.innerHTML = list.map(p => `<div class="nearby"><span><i class="sw" style="background:${esc(p.color)}"></i>${esc(p.name)} <small class="muted">Lv${p.level}</small></span><button class="btn btn-red btn-sm" data-id="${p.id}" ${p.busy ? 'disabled' : ''}>⚔ ${p.busy ? 'Busy' : 'Challenge'}</button></div>`).join('');
    wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => send({ t: 'challenge', id: b.dataset.id })));
  }

  /* ---------- Challenges ---------- */
  let challengeTimer = null;
  function onChallengeReceived(m) {
    pendingChallenge = m.from;
    $('challenge-text').textContent = `⚔️ ${m.from.name} (Lv${m.from.level}) challenges you!`;
    $('challenge-toast').classList.remove('hidden');
    clearTimeout(challengeTimer);
    challengeTimer = setTimeout(() => { $('challenge-toast').classList.add('hidden'); pendingChallenge = null; }, Math.max(1000, m.expiresAt - Date.now()));
  }
  $('challenge-accept').addEventListener('click', () => { if (pendingChallenge) send({ t: 'accept', id: pendingChallenge.id }); $('challenge-toast').classList.add('hidden'); pendingChallenge = null; });
  $('challenge-decline').addEventListener('click', () => { if (pendingChallenge) send({ t: 'decline', id: pendingChallenge.id }); $('challenge-toast').classList.add('hidden'); pendingChallenge = null; });

  function challengeNearest() {
    const list = nearbyPlayers().filter(p => !p.busy);
    if (!list.length) { toast('No trainer nearby. Walk up to someone!', 'info'); return; }
    list.sort((a, b) => (Math.abs(a.x - me.x) + Math.abs(a.y - me.y)) - (Math.abs(b.x - me.x) + Math.abs(b.y - me.y)));
    send({ t: 'challenge', id: list[0].id });
  }

  /* ---------- Encounter (catch minigame) ---------- */
  let encAnim = null, encT0 = 0, encPending = null;
  function startEncounter(m) {
    const sp = P.SPECIES_BY_ID[m.wild.species];
    encounter = { wild: m.wild, sp, throws: m.throws, speed: 1.6, locked: false };
    const spr = $('enc-sprite'); spr.innerHTML = ''; spr.className = 'enc-sprite'; spr.appendChild(speciesSprite(sp.id, 7));
    const ball = $('enc-ball'); ball.innerHTML = ''; ball.className = 'enc-ball'; ball.appendChild(ballSprite(3));
    $('enc-title').textContent = `A wild ${sp.name} appeared!`;
    $('enc-msg').textContent = sp.rarity === 'legendary' ? 'LEGENDARY! Nail the timing!' : 'Stop the cursor in the green zone!';
    $('enc-throws').textContent = `Pokéballs left: ${m.throws}`;
    $('enc-throw').disabled = false;
    $('encounter-overlay').classList.remove('hidden');
    FX.playCry(sp.id);
    encT0 = performance.now();
    cancelAnimationFrame(encAnim);
    const tick = () => {
      if (!encounter) return;
      if (!encounter.locked) {
        const t = (performance.now() - encT0) / 1000;
        const pos = (Math.sin(t * encounter.speed * Math.PI) + 1) / 2;
        encounter.pos = pos;
        $('enc-cursor').style.left = `calc(${(pos * 100).toFixed(2)}% - 3px)`;
      }
      encAnim = requestAnimationFrame(tick);
    };
    tick();
  }
  function throwBall() {
    if (!encounter || encounter.locked) return;
    encounter.locked = true;
    const d = Math.abs(encounter.pos - 0.5);
    let quality;
    if (d <= 0.03) quality = 1;
    else if (d <= 0.15) quality = 0.6 + ((0.15 - d) / 0.12) * 0.35;
    else quality = Math.max(0, 0.3 - (d - 0.15));
    encounter.lastQuality = quality;
    $('enc-throw').disabled = true;
    $('enc-msg').textContent = quality >= 1 ? 'PERFECT throw!' : quality >= 0.6 ? 'Nice throw!' : 'Weak throw…';
    const ball = $('enc-ball');
    ball.className = 'enc-ball throw';
    setTimeout(() => { ball.className = 'enc-ball wobble'; $('enc-sprite').classList.add('shake'); }, 550);
    encPending = null;
    send({ t: 'throw', quality });
    // Resolve after wobble animation, when the server result has arrived.
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
      $('enc-msg').textContent = `Gotcha! ${encounter.sp.name} was caught! +${r.points} pts${r.isNew ? ' (NEW!)' : ''}`;
      $('enc-throws').textContent = '';
      const rect = canvas.getBoundingClientRect();
      FX.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 90);
      party = r.party; renderParty();
      setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1800);
    } else {
      ball.className = 'enc-ball';
      $('enc-sprite').classList.remove('shake');
      if (r.fled) {
        $('enc-msg').textContent = `Oh no! ${encounter.sp.name} broke free and ran away!`;
        setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1500);
      } else {
        encounter.throws = r.throwsLeft;
        encounter.speed += 0.5;
        encounter.locked = false;
        $('enc-throws').textContent = `Pokéballs left: ${r.throwsLeft}`;
        $('enc-msg').textContent = 'It broke free! Try again — the cursor is faster now.';
        $('enc-throw').disabled = false;
        encT0 = performance.now();
      }
    }
  }
  function onCatchResult(m) { encPending = m; }
  function onEncounterEnd(m) {
    if (!encounter) return;
    if (m.reason === 'timeout') { $('enc-msg').textContent = 'Too slow — it wandered off.'; setTimeout(() => { $('encounter-overlay').classList.add('hidden'); encounter = null; }, 1200); }
    else if (m.reason === 'ran') { $('encounter-overlay').classList.add('hidden'); encounter = null; }
  }
  $('enc-throw').addEventListener('click', throwBall);
  $('enc-run').addEventListener('click', () => { if (encounter && !encounter.locked) send({ t: 'run' }); });

  /* ---------- Battle ---------- */
  let battleTimerInt = null;
  const currentHp = { me: 0, foe: 0 };
  function startBattle(b) {
    battle = { data: b, busy: false, over: false };
    currentHp.me = b.me.hp; currentHp.foe = b.foe.hp;
    hideChallenge();
    $('encounter-overlay').classList.add('hidden');
    const foeSp = P.SPECIES_BY_ID[b.foe.species], meSp = P.SPECIES_BY_ID[b.me.species];
    const foe = $('foe-sprite'); foe.innerHTML = ''; foe.className = 'battle-sprite'; foe.appendChild(speciesSprite(foeSp.id, 7));
    const mine = $('me-sprite'); mine.innerHTML = ''; mine.className = 'battle-sprite'; mine.appendChild(speciesSprite(meSp.id, 7, true));
    $('foe-name').textContent = `${b.foe.name}'s ${foeSp.name}`;
    $('me-name').textContent = `Your ${meSp.name}`;
    $('foe-level').textContent = `Lv${b.foe.level}`;
    $('me-level').textContent = `Lv${b.me.level}`;
    setHp('foe', b.foe.hp, b.foe.maxHp);
    setHp('me', b.me.hp, b.me.maxHp);
    $('battle-log').innerHTML = '';
    battleLog(`${b.foe.name} wants to battle!`, 'sys');
    battleLog(`Go, ${meSp.name}!`, 'sys');
    renderMoves(b.moves, true);
    $('battle-overlay').classList.remove('hidden');
    startTurnTimer(b.turnEndsAt);
    FX.playCry(meSp.id);
  }
  function renderMoves(moves, enabled) {
    const wrap = $('battle-moves');
    wrap.innerHTML = moves.map((mv, i) => {
      const col = P.TYPES[mv.type].color;
      const sub = mv.heal ? `Heals ${mv.heal} HP` : `PWR ${mv.power} · ACC ${mv.acc}%`;
      return `<button class="move-btn" data-i="${i}" style="border-color:${col}; box-shadow:0 3px 0 ${col}" ${enabled ? '' : 'disabled'}>${P.TYPES[mv.type].icon} ${esc(mv.name)}<small>${sub}</small></button>`;
    }).join('');
    wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => chooseMove(Number(b.dataset.i))));
  }
  function chooseMove(i) {
    if (!battle || battle.busy || battle.over) return;
    battle.busy = true;
    $('battle-moves').querySelectorAll('button').forEach(b => { b.disabled = true; });
    send({ t: 'battle_move', index: i });
    const mv = battle.data.moves[i];
    battleLog(`You chose ${mv.name}.`, 'sys');
  }
  function setHp(side, hp, max) {
    const pct = Math.max(0, hp / max * 100);
    const fill = $(`${side}-hp`);
    fill.style.width = pct + '%';
    fill.style.background = pct > 50 ? '#22c55e' : pct > 20 ? '#facc15' : '#ef4444';
    $(`${side}-hp-text`).textContent = `${hp} / ${max}`;
  }
  function battleLog(text, cls) {
    const log = $('battle-log');
    const el = document.createElement('div');
    el.className = 'ev ' + (cls || '');
    el.textContent = text;
    log.appendChild(el);
    while (log.children.length > 30) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function startTurnTimer(endsAt) {
    clearInterval(battleTimerInt);
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      $('battle-timer').textContent = `TURN ${battle ? battle.data.turn : ''} · ${left}s`;
    };
    tick();
    battleTimerInt = setInterval(tick, 500);
  }
  function onBattleTurn(m) {
    if (!battle) return;
    const b = battle.data;
    const foeName = b.foe.name;
    const nameOf = pid => pid === myId ? 'Your ' + P.SPECIES_BY_ID[b.me.species].name : `${foeName}'s ${P.SPECIES_BY_ID[b.foe.species].name}`;
    let delay = 200;
    m.events.forEach(ev => {
      setTimeout(() => {
        if (!battle) return;
        if (ev.kind === 'hit') {
          const effTxt = ev.eff >= 2 ? " It's super effective!" : ev.eff <= 0.5 ? " It's not very effective…" : '';
          battleLog(`${nameOf(ev.by)} used ${ev.move}! ${ev.dmg} dmg.${ev.crit ? ' Critical hit!' : ''}${effTxt}`, ev.eff >= 2 ? 'super' : ev.eff <= 0.5 ? 'weak' : '');
          const targetSide = ev.target === myId ? 'me' : 'foe';
          const el = $(`${targetSide}-sprite`); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
          // apply hp progressively: compute from snapshot
          const curMe = targetSide === 'me' ? Math.max(0, currentHp.me - ev.dmg) : currentHp.me;
          const curFoe = targetSide === 'foe' ? Math.max(0, currentHp.foe - ev.dmg) : currentHp.foe;
          currentHp.me = curMe; currentHp.foe = curFoe;
          setHp('me', curMe, b.me.maxHp); setHp('foe', curFoe, b.foe.maxHp);
        } else if (ev.kind === 'heal') {
          battleLog(`${nameOf(ev.by)} used ${ev.move} and recovered ${ev.amount} HP.`, '');
          const side = ev.by === myId ? 'me' : 'foe';
          currentHp[side] = Math.min(side === 'me' ? b.me.maxHp : b.foe.maxHp, currentHp[side] + ev.amount);
          setHp(side, currentHp[side], side === 'me' ? b.me.maxHp : b.foe.maxHp);
        } else if (ev.kind === 'miss') {
          battleLog(`${nameOf(ev.by)} used ${ev.move}… but it missed!`, 'weak');
        }
      }, delay);
      delay += 900;
    });
    setTimeout(() => {
      if (!battle) return;
      // sync to authoritative values
      currentHp.me = m.me.hp; currentHp.foe = m.foe.hp;
      setHp('me', m.me.hp, m.me.maxHp); setHp('foe', m.foe.hp, m.foe.maxHp);
      b.turn = m.turn;
      if (!battle.over) {
        battle.busy = false;
        renderMoves(b.moves, true);
        startTurnTimer(m.turnEndsAt);
      }
    }, delay);
  }
  function onBattleEnd(m) {
    if (!battle) return;
    battle.over = true;
    clearInterval(battleTimerInt);
    const won = m.winner === myId;
    // wait for any queued turn animations
    setTimeout(() => {
      if (!battle) return;
      const loserSide = won ? 'foe' : 'me';
      $(`${loserSide}-sprite`).classList.add('faint');
      battleLog(won ? `🏆 You won! +${m.winPoints} pts` : `You lost to ${m.winnerName}. +${m.lossPoints} pts for trying.`, won ? 'super' : 'weak');
      if (m.reason === 'forfeit') battleLog(`${m.loserName} forfeited.`, 'sys');
      if (m.reason === 'disconnect') battleLog(`${m.loserName} disconnected.`, 'sys');
      $('battle-moves').querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (won) { const rect = canvas.getBoundingClientRect(); FX.confetti(rect.left + rect.width / 2, rect.top + rect.height / 2, 120); }
      setTimeout(() => { $('battle-overlay').classList.add('hidden'); battle = null; }, 2600);
    }, m.reason === 'ko' ? 900 * 2 + 400 : 100);
  }
  $('battle-forfeit').addEventListener('click', () => { if (battle && !battle.over) send({ t: 'forfeit' }); });
  function hideChallenge() { $('challenge-toast').classList.add('hidden'); pendingChallenge = null; }

  /* ---------- Input ---------- */
  const keyDir = { w: 'up', a: 'left', s: 'down', d: 'right', arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right' };
  const isTyping = () => document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (isTyping()) {
      if (k === 'escape') document.activeElement.blur();
      return;
    }
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

  // Mobile
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) $('arena-screen').classList.add('touch');
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

  function tryMove(now) {
    if (!joined || !me || encounter || battle) return;
    const dir = heldDir || (keys.size ? [...keys][keys.size - 1] : null);
    if (!dir) return;
    if (now - lastMoveSent < 120) return;
    lastMoveSent = now;
    send({ t: 'move', dir });
    // Client-side prediction
    const d = DIRS[dir];
    me.dir = dir;
    if (walkable(me.x + d[0], me.y + d[1])) { me.x += d[0]; me.y += d[1]; }
  }

  /* ---------- Rendering ---------- */
  function drawIdle(now) {
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = '#131b3a';
    for (let y = 0; y < VIEW_H; y += 32) for (let x = 0; x < VIEW_W; x += 32) if (((x + y) / 32) % 2 === 0) ctx.fillRect(x, y, 32, 32);
    const t = now / 1000;
    P.SPECIES.forEach((sp, i) => {
      const x = 60 + i * 105, y = 300 + Math.sin(t * 2 + i) * 12;
      ctx.drawImage(speciesSprite(sp.id, 4), x, y);
    });
    ctx.fillStyle = '#ffcb05';
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CTO ARENA', VIEW_W / 2, 120);
    ctx.fillStyle = '#9aa3c7';
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillText(connected ? 'PRESS START ADVENTURE' : 'CONNECTING…', VIEW_W / 2, 160);
    ctx.textAlign = 'left';
  }

  function drawWorld(now, dt) {
    // Smooth positions
    for (const p of players.values()) {
      const tx = p.x * TILE, ty = p.y * TILE;
      const k = Math.min(1, dt * 14);
      p.rx += (tx - p.rx) * k; p.ry += (ty - p.ry) * k;
      if (Math.abs(tx - p.rx) < 0.5) p.rx = tx;
      if (Math.abs(ty - p.ry) < 0.5) p.ry = ty;
    }
    // Camera
    const camX = Math.round(Math.max(0, Math.min(map.w * TILE - VIEW_W, me.rx + TILE / 2 - VIEW_W / 2)));
    const camY = Math.round(Math.max(0, Math.min(map.h * TILE - VIEW_H, me.ry + TILE / 2 - VIEW_H / 2)));
    ctx.drawImage(mapCanvas, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    // Water shimmer
    const x0 = Math.floor(camX / TILE), y0 = Math.floor(camY / TILE);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let y = y0; y <= y0 + VIEW_H / TILE + 1 && y < map.h; y++) for (let x = x0; x <= x0 + VIEW_W / TILE + 1 && x < map.w; x++) {
      if (map.tiles[y][x] !== T.WATER) continue;
      const ph = (now / 600 + x * 0.7 + y * 1.3) % (Math.PI * 2);
      const sx = x * TILE - camX + 6 + Math.sin(ph) * 6, sy = y * TILE - camY + 14 + Math.cos(ph * 0.5) * 6;
      ctx.fillRect(sx, sy, 8, 2);
    }

    // Wilds
    for (const w of wilds.values()) {
      const bob = Math.sin(now / 250 + w.x) * 2;
      const sx = w.x * TILE - camX, sy = w.y * TILE - camY + bob;
      if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 30, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
      const sp = P.SPECIES_BY_ID[w.species];
      if (sp.rarity === 'legendary') { ctx.fillStyle = `rgba(103,232,249,${0.25 + Math.sin(now / 200) * 0.15})`; ctx.beginPath(); ctx.arc(sx + 16, sy + 16, 22, 0, Math.PI * 2); ctx.fill(); }
      ctx.drawImage(speciesSprite(w.species, 2), sx, sy);
      // '!' for tall grass hint
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px "Press Start 2P", monospace'; ctx.fillText('!', sx + 26, sy - 2);
    }

    // Players (sorted by y)
    const sorted = [...players.values()].sort((a, b) => a.ry - b.ry);
    ctx.font = 'bold 12px Nunito, sans-serif';
    ctx.textAlign = 'center';
    for (const p of sorted) {
      const sx = Math.round(p.rx - camX), sy = Math.round(p.ry - camY);
      if (sx < -TILE || sy < -TILE || sx > VIEW_W || sy > VIEW_H) continue;
      const moving = Math.abs(p.rx - p.x * TILE) > 0.5 || Math.abs(p.ry - p.y * TILE) > 0.5;
      const step = moving ? Math.round(Math.sin(now / 60) * 1.5) : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 31, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
      if (p.id === myId) { ctx.fillStyle = 'rgba(255,203,5,0.35)'; ctx.beginPath(); ctx.ellipse(sx + 16, sy + 31, 14, 6, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.drawImage(trainerSprite(p.color, 2, p.dir === 'left'), sx, sy - 6 + step);
      if (p.busy) { ctx.fillStyle = '#ef4444'; ctx.font = 'bold 9px "Press Start 2P", monospace'; ctx.fillText('!', sx + 30, sy - 8); ctx.font = 'bold 12px Nunito, sans-serif'; }
      // Name tag
      const label = p.name;
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(11,16,32,0.75)'; ctx.fillRect(sx + 16 - w / 2, sy - 22, w, 15);
      ctx.fillStyle = p.id === myId ? '#ffcb05' : '#fff'; ctx.fillText(label, sx + 16, sy - 10);
      // Bubble
      const b = bubbles.get(p.id);
      if (b && b.until > now) {
        const text = b.text.length > 38 ? b.text.slice(0, 36) + '…' : b.text;
        const bw = Math.min(260, ctx.measureText(text).width + 14);
        const bx = Math.max(4, Math.min(VIEW_W - bw - 4, sx + 16 - bw / 2)), by = sy - 44;
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b1b2f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(bx, by, bw, 20, 6); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx + 12, by + 20); ctx.lineTo(sx + 16, by + 26); ctx.lineTo(sx + 20, by + 20); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#1b1b2f'; ctx.fillText(text, bx + bw / 2, by + 14);
      } else if (b) bubbles.delete(p.id);
    }
    ctx.textAlign = 'left';

    // Minimap
    const mw = 96, mh = Math.round(96 * map.h / map.w), mx = VIEW_W - mw - 10, my = 10;
    ctx.fillStyle = 'rgba(11,16,32,0.8)'; ctx.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
    ctx.drawImage(mapCanvas, mx, my, mw, mh);
    for (const w of wilds.values()) { ctx.fillStyle = P.SPECIES_BY_ID[w.species].rarity === 'legendary' ? '#67e8f9' : '#fff'; ctx.fillRect(mx + w.x / map.w * mw - 1, my + w.y / map.h * mh - 1, 2, 2); }
    for (const p of players.values()) { ctx.fillStyle = p.id === myId ? '#ffcb05' : p.color; ctx.fillRect(mx + p.x / map.w * mw - 2, my + p.y / map.h * mh - 2, 4, 4); }
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + camX / (map.w * TILE) * mw, my + camY / (map.h * TILE) * mh, VIEW_W / (map.w * TILE) * mw, VIEW_H / (map.h * TILE) * mh);

    // HUD hints
    const near = nearbyPlayers().filter(p => !p.busy);
    let hint = '';
    if (near.length) hint = `SPACE: challenge ${near[0].name}`;
    else if (map.tiles[me.y][me.x] === T.TALL) hint = 'Tall grass… wild mons lurk here';
    if (hint) {
      ctx.font = '10px "Press Start 2P", monospace';
      const w = ctx.measureText(hint).width + 20;
      ctx.fillStyle = 'rgba(11,16,32,0.8)'; ctx.fillRect(VIEW_W / 2 - w / 2, VIEW_H - 34, w, 24);
      ctx.fillStyle = '#ffcb05'; ctx.textAlign = 'center'; ctx.fillText(hint, VIEW_W / 2, VIEW_H - 18); ctx.textAlign = 'left';
    }
    // Score HUD
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(11,16,32,0.8)'; ctx.fillRect(10, VIEW_H - 30, 250, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(`SCORE ${me.score}  CAUGHT ${me.catches}  W ${me.wins}`, 16, VIEW_H - 16);
  }

  let nearbyTick = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (joined && map && me) {
      tryMove(now);
      drawWorld(now, dt);
      if (now - nearbyTick > 300) { nearbyTick = now; renderNearby(); }
    } else drawIdle(now);
    requestAnimationFrame(loop);
  }

  // Boot
  connect();
  requestAnimationFrame(loop);
})();
