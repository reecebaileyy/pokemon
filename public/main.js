/* ============================================================
   Landing page interactivity (config binding, hero ball,
   confetti, tokenomics chart, evolution roadmap, pokedex,
   quiz, reveal-on-scroll). The game lives in game.js.
   ============================================================ */
(function () {
  const C = window.SITE_CONFIG;
  const P = window.PokeData;
  const $ = id => document.getElementById(id);
  const fmtUsd = n => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? '$' + Math.round(n / 1e3) + 'K' : '$' + n;
  const fmtNum = n => n.toLocaleString('en-US');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Config binding ---------- */
  document.querySelectorAll('[data-cfg]').forEach(el => {
    const key = el.getAttribute('data-cfg');
    if (C[key] != null) el.textContent = C[key];
  });
  document.title = `${C.name} — Community Takeover · Gotta Pump ’Em All`;
  $('year').textContent = new Date().getFullYear();

  const setLink = (id, url) => { const el = $(id); if (!el) return; if (url) el.href = url; else el.style.display = 'none'; };
  setLink('buy-btn', C.links.buy);
  setLink('nav-buy', C.links.buy);
  setLink('chart-btn', C.links.chart);

  $('contract-address').textContent = C.contract;
  $('copy-ca').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(C.contract);
      $('copy-ca').textContent = 'Copied!';
      confetti(window.innerWidth / 2, 120, 40);
      setTimeout(() => { $('copy-ca').textContent = 'Copy'; }, 1500);
    } catch (e) {
      const r = document.createRange(); r.selectNode($('contract-address'));
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  });

  /* ---------- Hero stats (count-up) ---------- */
  function countUp(el, target, fmt, ms) {
    const start = performance.now();
    const step = t => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  countUp($('stat-mcap'), C.stats.marketCap, fmtUsd, 1600);
  countUp($('stat-holders'), C.stats.holders, fmtNum, 1600);

  /* ---------- Marquee ---------- */
  const track = $('marquee');
  const items = C.marquee.concat(C.marquee);
  track.innerHTML = items.map(m => `<span>${esc(m)}</span>`).join('');

  /* ---------- Floating sprites in the hero ---------- */
  (function heroSprites() {
    const wrap = $('hero-sprites');
    const spots = [
      { x: 4, y: 12, s: 4, dur: 9 }, { x: 88, y: 8, s: 5, dur: 11 }, { x: 70, y: 70, s: 4, dur: 8 },
      { x: 20, y: 78, s: 3, dur: 10 }, { x: 50, y: 4, s: 3, dur: 12 }, { x: 92, y: 55, s: 4, dur: 9 }, { x: 36, y: 60, s: 3, dur: 13 }
    ];
    P.SPECIES.forEach((sp, i) => {
      const spot = spots[i % spots.length];
      const cv = P.spriteToCanvas(sp.pixels, spot.s);
      cv.style.left = spot.x + '%'; cv.style.top = spot.y + '%';
      cv.style.setProperty('--dur', spot.dur + 's');
      cv.style.animationDelay = (-i * 1.7) + 's';
      wrap.appendChild(cv);
    });
  })();

  /* ---------- Confetti / FX canvas ---------- */
  const fx = $('fx-canvas');
  const fctx = fx.getContext('2d');
  let parts = [];
  function sizeFx() { fx.width = window.innerWidth; fx.height = window.innerHeight; }
  sizeFx(); window.addEventListener('resize', sizeFx);
  const COLORS = ['#ffcb05', '#e3350d', '#3b4cca', '#22c55e', '#ffffff', '#f97316'];
  function confetti(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4, g: 0.22, life: 70 + Math.random() * 40, size: 4 + Math.random() * 6, c: COLORS[i % COLORS.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, shape: (opts && opts.shape) || (Math.random() < 0.5 ? 'rect' : 'circle') });
    }
    if (!fxRunning) loopFx();
  }
  let fxRunning = false;
  function loopFx() {
    fxRunning = true;
    fctx.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.99; p.life--; p.rot += p.vr;
      fctx.save(); fctx.translate(p.x, p.y); fctx.rotate(p.rot); fctx.globalAlpha = Math.min(1, p.life / 30); fctx.fillStyle = p.c;
      if (p.shape === 'rect') fctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      else { fctx.beginPath(); fctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); fctx.fill(); }
      fctx.restore();
    }
    if (parts.length) requestAnimationFrame(loopFx); else { fxRunning = false; fctx.clearRect(0, 0, fx.width, fx.height); }
  }

  /* ---------- Cursor trail (desktop only, throttled) ---------- */
  (function trail() {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    const wrap = $('cursor-trail'); let last = 0;
    window.addEventListener('mousemove', e => {
      const t = performance.now(); if (t - last < 45) return; last = t;
      const s = document.createElement('span'); s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px';
      wrap.appendChild(s); setTimeout(() => s.remove(), 700);
    }, { passive: true });
  })();

  /* ---------- Hero Pokéball ---------- */
  (function heroBall() {
    const ball = $('hero-ball'), hint = $('ball-hint'), catches = $('ball-catches');
    let busy = false, total = 0;
    const lines = [`Gotcha! ${C.ticker} was caught!`, 'Critical catch! Diamond hands confirmed.', `${C.ticker} refuses to be rugged again.`, 'The ball shakes… once… twice… three times!', 'You caught the whole community.'];
    const go = () => {
      if (busy) return; busy = true;
      ball.classList.remove('caught', 'open');
      ball.classList.add('shake');
      hint.textContent = 'Shaking…';
      setTimeout(() => {
        ball.classList.remove('shake');
        ball.classList.add('caught');
        const r = ball.getBoundingClientRect();
        confetti(r.left + r.width / 2, r.top + r.height / 2, 120);
        total++;
        hint.textContent = lines[Math.floor(Math.random() * lines.length)];
        catches.textContent = `CAUGHT x${total}`;
        playCry('embercub');
        setTimeout(() => { busy = false; ball.classList.remove('caught'); hint.textContent = 'Throw again?'; }, 1500);
      }, 1500);
    };
    ball.addEventListener('click', go);
    ball.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  })();

  /* ---------- Timeline ---------- */
  $('timeline').innerHTML = C.timeline.map((t, i) => `
    <div class="tl-item reveal ${i < C.timeline.length - 1 ? 'done' : ''}">
      <div class="tl-date">${esc(t.date)}</div>
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.text)}</p>
    </div>`).join('');

  /* ---------- Tokenomics ---------- */
  (function tokenomics() {
    const cv = $('tokenomics-chart'), ctx = cv.getContext('2d');
    const dist = C.tokenomics.distribution;
    $('tokenomics-legend').innerHTML = dist.map(d => `<li><span class="sw" style="background:${d.color}"></span>${esc(d.label)}<span class="pct">${d.pct}%</span></li>`).join('');
    const tk = C.tokenomics;
    const cards = [
      ['Total supply', tk.totalSupply, '🧬'], ['Buy / sell tax', `${tk.buyTax} / ${tk.sellTax}`, '🧾'],
      ['Liquidity', tk.liquidity, '🔥'], ['Mint authority', tk.mintAuthority, '🔒'],
      ['Freeze authority', tk.freezeAuthority, '❄️'], ['Chain', C.chain, '⛓️']
    ];
    $('tokenomics-cards').innerHTML = cards.map(([k, v, ic]) => `<div class="stat-card reveal"><span class="ic">${ic}</span><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');

    let drawn = false;
    function draw(progress) {
      const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W * 0.42, r = W * 0.27;
      ctx.clearRect(0, 0, W, H);
      let a = -Math.PI / 2;
      const totalAngle = Math.PI * 2 * progress;
      for (const d of dist) {
        const span = Math.PI * 2 * (d.pct / 100);
        const end = Math.min(a + span, -Math.PI / 2 + totalAngle);
        if (end <= a) break;
        ctx.beginPath(); ctx.arc(cx, cy, R, a, end); ctx.arc(cx, cy, r, end, a, true); ctx.closePath();
        ctx.fillStyle = d.color; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#1b1b2f'; ctx.stroke();
        a += span;
      }
    }
    function animate() {
      if (drawn) return; drawn = true;
      const t0 = performance.now();
      const step = t => { const k = Math.min(1, (t - t0) / 1400); draw(1 - Math.pow(1 - k, 3)); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
    new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) animate(); }, { threshold: 0.3 }).observe(cv);
  })();

  /* ---------- Evolution roadmap ---------- */
  (function evolution() {
    const ms = C.milestones, cur = C.stats.marketCap;
    let done = ms.filter(m => cur >= m.mcap).length;
    const next = ms[done];
    const prevMcap = done > 0 ? ms[done - 1].mcap : 0;
    const partial = next ? Math.max(0, Math.min(1, (cur - prevMcap) / (next.mcap - prevMcap))) : 0;
    const progress = next ? (done + partial) / ms.length : 1;
    $('evo-chain').innerHTML = ms.map((m, i) => {
      const cls = i < done ? 'done' : i === done ? 'current' : 'locked';
      const tag = i < done ? 'EVOLVED' : i === done ? 'EVOLVING…' : 'LOCKED';
      return `<div class="evo-stage reveal ${cls}" data-species="${m.species}"><span class="evo-tag">${tag}</span><div class="evo-art"></div><h3>${esc(m.label)}</h3><div class="evo-mcap">${fmtUsd(m.mcap)} MCAP</div><p class="evo-perk">${esc(m.perk)}</p>${i < ms.length - 1 ? '<span class="evo-arrow">▶</span>' : ''}</div>`;
    }).join('');
    document.querySelectorAll('.evo-stage').forEach(el => {
      const sp = P.SPECIES_BY_ID[el.dataset.species] || P.SPECIES[0];
      el.querySelector('.evo-art').appendChild(P.spriteToCanvas(sp.pixels, 6));
    });
    const label = next ? `${fmtUsd(cur)} market cap · ${Math.round(partial * 100)}% of the way to <b>${esc(next.label)}</b> (${fmtUsd(next.mcap)})` : `${fmtUsd(cur)} market cap · fully evolved. Legendary status reached.`;
    $('evo-progress-label').innerHTML = label;
    new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) $('evo-progress').style.width = (progress * 100).toFixed(1) + '%'; }, { threshold: 0.4 }).observe($('evo-progress'));
  })();

  /* ---------- Creature cries (Web Audio, no assets) ---------- */
  let actx = null;
  function playCry(speciesId) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const sp = P.SPECIES_BY_ID[speciesId] || P.SPECIES[0];
      const waves = { fire: 'sawtooth', water: 'sine', grass: 'triangle', electric: 'square', rock: 'square', ghost: 'sine', ice: 'triangle' };
      let hash = 0; for (const ch of sp.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const base = 180 + (hash % 400);
      const t = actx.currentTime;
      const osc = actx.createOscillator(), gain = actx.createGain();
      osc.type = waves[sp.type] || 'square';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * (sp.type === 'rock' ? 0.5 : 2.2), t + 0.12);
      osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.32);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      osc.connect(gain).connect(actx.destination);
      osc.start(t); osc.stop(t + 0.4);
    } catch (e) { /* audio blocked */ }
  }

  /* ---------- Pokédex grid ---------- */
  $('dex-grid').innerHTML = P.SPECIES.map((sp, i) => {
    const tcol = P.TYPES[sp.type].color;
    return `<div class="dex-card reveal" data-id="${sp.id}" style="--type:${tcol}"><span class="rarity ${sp.rarity}">${sp.rarity.toUpperCase()}</span><div class="art"></div><h3>#00${i + 1} ${esc(sp.name)}</h3><span class="type-badge">${P.TYPES[sp.type].icon} ${sp.type}</span><p>${esc(sp.dex)}</p></div>`;
  }).join('');
  document.querySelectorAll('.dex-card').forEach(el => {
    const sp = P.SPECIES_BY_ID[el.dataset.id];
    el.querySelector('.art').appendChild(P.spriteToCanvas(sp.pixels, 6));
    el.addEventListener('click', () => {
      playCry(sp.id);
      el.classList.remove('cry'); void el.offsetWidth; el.classList.add('cry');
      const r = el.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 3, 18, { shape: 'circle' });
    });
  });

  /* ---------- Who's that mon? quiz ---------- */
  (function quiz() {
    const cv = $('quiz-canvas'), ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const opts = $('quiz-options'), result = $('quiz-result'), streakEl = $('quiz-streak');
    let answer = null, streak = 0, locked = false;
    function next() {
      locked = false;
      answer = P.SPECIES[Math.floor(Math.random() * P.SPECIES.length)];
      const names = P.SPECIES.filter(s => s !== answer).sort(() => Math.random() - 0.5).slice(0, 3).concat(answer).sort(() => Math.random() - 0.5);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(P.silhouetteToCanvas(answer.pixels, 12, '#1b1b2f'), 0, 0);
      opts.innerHTML = names.map(s => `<button class="btn btn-sm" data-id="${s.id}">${esc(s.name)}</button>`).join('');
      result.textContent = 'Who’s that mon?';
      opts.querySelectorAll('button').forEach(b => b.addEventListener('click', () => guess(b)));
    }
    function guess(btn) {
      if (locked) return; locked = true;
      const correct = btn.dataset.id === answer.id;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(P.spriteToCanvas(answer.pixels, 12), 0, 0);
      btn.classList.add(correct ? 'correct' : 'wrong');
      if (correct) {
        streak++; result.textContent = `It’s ${answer.name}! +1 streak`;
        const r = cv.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top + r.height / 2, 40);
        playCry(answer.id);
      } else { streak = 0; result.textContent = `Nope — it was ${answer.name}. Streak reset.`; }
      streakEl.textContent = streak;
      setTimeout(next, 1500);
    }
    next();
  })();

  /* ---------- Team / steps / socials ---------- */
  $('team-grid').innerHTML = C.team.map(t => `<div class="team-card reveal" data-species="${t.species}"><div class="art"></div><div><b>${esc(t.name)}</b><span>${esc(t.role)}</span><span>${esc(t.handle)}</span></div></div>`).join('');
  document.querySelectorAll('.team-card').forEach(el => el.querySelector('.art').appendChild(P.spriteToCanvas((P.SPECIES_BY_ID[el.dataset.species] || P.SPECIES[0]).pixels, 4)));

  $('steps').innerHTML = C.howToBuy.map(s => `<div class="step reveal"><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></div>`).join('');

  const socials = [
    ['telegram', '✈️', 'Telegram', 'Where the trainers hang out'],
    ['twitter', '🐦', 'X / Twitter', 'Memes, raids, announcements'],
    ['dexscreener', '📈', 'DexScreener', 'Live chart & trades'],
    ['buy', '🛒', `Buy ${C.ticker}`, `Swap on ${C.chain}`],
    ['community', '🏠', 'Community hub', 'Discord / forum']
  ].filter(([k]) => C.links[k]);
  $('social-grid').innerHTML = socials.map(([k, ic, name, sub]) => `<a class="social reveal" href="${esc(C.links[k])}" target="_blank" rel="noopener"><span class="ic">${ic}</span><div><span>${esc(name)}</span><small>${esc(sub)}</small></div></a>`).join('');

  /* ---------- Reveal on scroll ---------- */
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));

  /* ---------- Nav ---------- */
  $('nav-toggle').addEventListener('click', () => $('nav-links').classList.toggle('open'));
  $('nav-links').querySelectorAll('a').forEach(a => a.addEventListener('click', () => $('nav-links').classList.remove('open')));

  /* ---------- Shared FX for game.js ---------- */
  window.SiteFX = {
    confetti, playCry,
    setOnline(n) { $('online-count').textContent = n; $('stat-online').textContent = n; }
  };
})();
