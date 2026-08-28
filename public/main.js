/* ============================================================
   Site: config binding, live metrics, native candlestick chart,
   on-chain proof, evolution roadmap, community links.
   The arena lives in game.js.
   ============================================================ */
(function () {
  const C = window.SITE_CONFIG;
  const D = window.Pokedex;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUsd = n => n == null || isNaN(n) ? '—' : n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K' : '$' + Math.round(n);
  const fmtNum = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US');
  const fmtPrice = p => p == null || isNaN(p) ? '—' : '$' + (p < 1 ? Number(p.toPrecision(4)).toString() : p.toFixed(2));
  const fmtPct = v => v == null || isNaN(v) ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';
  const dirCls = v => v == null || isNaN(v) ? '' : v >= 0 ? 'up' : 'down';
  const ageOf = ts => { const h = Math.max(0, (Date.now() - ts) / 36e5); return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`; };
  const pal = () => ({ grid: 'rgba(255,255,255,0.06)', text: '#8b8b95', up: '#34d399', down: '#f87171', volUp: 'rgba(52,211,153,0.28)', volDown: 'rgba(248,113,113,0.28)', last: '#ffcb05', lastText: '#1a1400', lastLine: 'rgba(255,203,5,0.6)', cross: 'rgba(255,255,255,0.25)', sparkUp: '#34d399', sparkDown: '#f87171', sparkFillUp: 'rgba(52,211,153,0.25)', sparkFillDown: 'rgba(248,113,113,0.25)', hollowUp: false, bg: '#131316' });

  /* ---------- Config binding ---------- */
  document.querySelectorAll('[data-cfg]').forEach(el => { const k = el.getAttribute('data-cfg'); if (C[k] != null) el.textContent = C[k]; });
  document.title = `${C.ticker} — community takeover on ${C.chain}`;
  $('year').textContent = new Date().getFullYear();
  const setLink = (id, url) => { const el = $(id); if (!el) return; if (url) el.href = url; else el.style.display = 'none'; };
  setLink('buy-btn', C.links.buy); setLink('nav-buy', C.links.buy); setLink('chart-btn', C.links.chart); setLink('chart-link', C.links.chart);
  $('contract-address').textContent = C.contract;
  $('copy-ca').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(C.contract); $('copy-ca').textContent = 'Copied'; setTimeout(() => { $('copy-ca').textContent = 'Copy'; }, 1400); }
    catch (e) { const r = document.createRange(); r.selectNode($('contract-address')); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  });

  /* ---------- Confetti (used by the arena) ---------- */
  const fx = $('fx-canvas'), fctx = fx.getContext('2d');
  let parts = [], fxRunning = false;
  const sizeFx = () => { fx.width = window.innerWidth; fx.height = window.innerHeight; };
  sizeFx(); window.addEventListener('resize', sizeFx);
  const COLORS = ['#ffcb05', '#f4f4f5', '#34d399', '#6390F0', '#EE8130'];
  function confetti(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, life: 60 + Math.random() * 30, size: 3 + Math.random() * 4, c: COLORS[i % COLORS.length] });
    }
    if (!fxRunning) loopFx();
  }
  function loopFx() {
    fxRunning = true;
    fctx.clearRect(0, 0, fx.width, fx.height);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.vx *= 0.99; p.life--; fctx.globalAlpha = Math.min(1, p.life / 25); fctx.fillStyle = p.c; fctx.fillRect(p.x, p.y, p.size, p.size); }
    fctx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(loopFx); else { fxRunning = false; fctx.clearRect(0, 0, fx.width, fx.height); }
  }

  /* ---------- Sparkline ---------- */
  function drawSparkline(closes) {
    const cv = $('sparkline'); if (!cv || closes.length < 2) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const lo = Math.min(...closes), hi = Math.max(...closes), span = hi - lo || 1;
    const up = closes[closes.length - 1] >= closes[0];
    const P = pal();
    const col = up ? P.sparkUp : P.sparkDown;
    const pts = closes.map((v, i) => [i / (closes.length - 1) * W, 4 + (1 - (v - lo) / span) * (H - 8)]);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, up ? P.sparkFillUp : P.sparkFillDown); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.beginPath(); c.moveTo(pts[0][0], H); pts.forEach(p => c.lineTo(p[0], p[1])); c.lineTo(W, H); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.strokeStyle = col; c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
  }

  /* ---------- Candlestick chart ---------- */
  const chart = { candles: [], tf: '15m', hover: -1 };
  const ccv = $('chart-canvas'), cctx = ccv.getContext('2d');
  function layout() {
    const W = ccv.clientWidth, H = ccv.clientHeight;
    return { W, H, L: 10, R: 74, T: 14, B: 26, volH: Math.round((H - 40) * 0.16) };
  }
  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const { W, H, L, R, T, B, volH } = layout();
    ccv.width = W * dpr; ccv.height = H * dpr;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, W, H);
    const P = pal();
    const cs = chart.candles, n = cs.length;
    $('chart-empty').classList.toggle('hidden', n > 0);
    if (!n) return;
    const priceH = H - T - B - volH - 8;
    // Scale on candle bodies (opens/closes) so a single launch wick can't flatten the whole chart; wicks are clipped.
    let bodyLo = Infinity, bodyHi = -Infinity, maxV = 0;
    for (const c of cs) { bodyLo = Math.min(bodyLo, c[1], c[4]); bodyHi = Math.max(bodyHi, c[1], c[4]); maxV = Math.max(maxV, c[5] || 0); }
    let lo = bodyLo, hi = bodyHi;
    for (const c of cs) { if (c[2] <= bodyHi * 1.35) hi = Math.max(hi, c[2]); if (c[3] >= bodyLo * 0.65) lo = Math.min(lo, c[3]); }
    const pad = (hi - lo) * 0.06 || hi * 0.02; lo = Math.max(0, lo - pad); hi += pad;
    const plotW = W - L - R, xw = plotW / n;
    const y = p => T + (hi - p) / (hi - lo) * priceH;
    const x = i => L + i * xw + xw / 2;
    // grid
    cctx.font = '11px "JetBrains Mono", ui-monospace, monospace'; cctx.textBaseline = 'middle'; cctx.textAlign = 'left';
    for (let k = 0; k <= 4; k++) {
      const p = lo + (hi - lo) * k / 4, yy = y(p);
      cctx.strokeStyle = P.grid; cctx.beginPath(); cctx.moveTo(L, yy); cctx.lineTo(W - R + 4, yy); cctx.stroke();
      cctx.fillStyle = P.text; cctx.fillText(fmtPrice(p).replace('$', ''), W - R + 10, yy);
    }
    // x labels
    cctx.textAlign = 'center'; cctx.textBaseline = 'alphabetic';
    const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(plotW / 110))));
    const spanMs = cs[n - 1][0] - cs[0][0];
    for (let i = 0; i < n; i += step) {
      const d = new Date(cs[i][0]);
      const label = spanMs > 36e5 * 36 ? d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      cctx.fillStyle = P.text; cctx.fillText(label, x(i), H - 8);
    }
    // volume
    const volTop = T + priceH + 8;
    for (let i = 0; i < n; i++) {
      const c = cs[i], up = c[4] >= c[1], h = maxV ? (c[5] / maxV) * volH : 0;
      cctx.fillStyle = up ? P.volUp : P.volDown;
      cctx.fillRect(x(i) - Math.max(1, xw * 0.35), volTop + volH - h, Math.max(2, xw * 0.7), h);
    }
    // candles
    for (let i = 0; i < n; i++) {
      const c = cs[i], up = c[4] >= c[1], col = up ? P.up : P.down, cx = x(i);
      cctx.strokeStyle = col; cctx.lineWidth = 1;
      cctx.beginPath(); cctx.moveTo(cx, Math.max(T, y(c[2]))); cctx.lineTo(cx, Math.min(T + priceH, y(c[3]))); cctx.stroke();
      const top = y(Math.max(c[1], c[4])), bot = y(Math.min(c[1], c[4]));
      const bx = cx - Math.max(1, xw * 0.35), bw = Math.max(2, xw * 0.7), bh = Math.max(1, bot - top);
      if (P.hollowUp && up && bw >= 4) { cctx.fillStyle = P.bg; cctx.fillRect(bx, top, bw, bh); cctx.strokeStyle = col; cctx.strokeRect(bx + 0.5, top + 0.5, bw - 1, Math.max(1, bh - 1)); }
      else { cctx.fillStyle = col; cctx.fillRect(bx, top, bw, bh); }
    }
    // last price line
    const last = cs[n - 1][4], ly = y(last);
    cctx.setLineDash([3, 3]); cctx.strokeStyle = P.lastLine; cctx.beginPath(); cctx.moveTo(L, ly); cctx.lineTo(W - R + 4, ly); cctx.stroke(); cctx.setLineDash([]);
    const tag = fmtPrice(last).replace('$', ''), tw = cctx.measureText(tag).width + 10;
    cctx.fillStyle = P.last; cctx.fillRect(W - R + 6, ly - 9, tw, 18);
    cctx.fillStyle = P.lastText; cctx.textAlign = 'left'; cctx.textBaseline = 'middle'; cctx.fillText(tag, W - R + 11, ly);
    // hover
    if (chart.hover >= 0 && chart.hover < n) {
      const i = chart.hover, cx = x(i);
      cctx.strokeStyle = P.cross; cctx.setLineDash([2, 3]); cctx.beginPath(); cctx.moveTo(cx, T); cctx.lineTo(cx, H - B); cctx.stroke(); cctx.setLineDash([]);
      const c = cs[i], d = new Date(c[0]);
      const chg = ((c[4] - c[1]) / c[1]) * 100;
      $('chart-tooltip').innerHTML = `<div>${d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div><div><b>O</b>${fmtPrice(c[1])} <b>H</b>${fmtPrice(c[2])}</div><div><b>L</b>${fmtPrice(c[3])} <b>C</b>${fmtPrice(c[4])}</div><div><b>Vol</b>${fmtUsd(c[5])} <span class="${dirCls(chg)}">${fmtPct(chg)}</span></div>`;
      $('chart-tooltip').classList.remove('hidden');
    } else $('chart-tooltip').classList.add('hidden');
  }
  ccv.addEventListener('mousemove', e => {
    const { L, R, W } = layout(); const n = chart.candles.length; if (!n) return;
    const r = ccv.getBoundingClientRect(); const px = e.clientX - r.left;
    const i = Math.floor((px - L) / ((W - L - R) / n));
    chart.hover = i >= 0 && i < n ? i : -1; drawChart();
  });
  ccv.addEventListener('mouseleave', () => { chart.hover = -1; drawChart(); });
  const redraw = () => { drawChart(); if (chart.candles.length) drawSparkline(chart.candles.slice(-48).map(c => c[4])); };
  window.addEventListener('resize', redraw);
  async function loadChart() {
    try {
      const r = await fetch(`/api/chart?tf=${chart.tf}`, { cache: 'no-store' });
      const j = await r.json();
      chart.candles = j.candles || [];
      if (!chart.candles.length) $('chart-empty').textContent = j.error ? 'Chart unavailable' : 'No candles yet';
      drawChart();
      if (chart.tf === '15m' || chart.tf === '5m') drawSparkline(chart.candles.slice(-48).map(c => c[4]));
    } catch (e) { $('chart-empty').textContent = 'Chart unavailable'; }
  }
  $('chart-tabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    $('chart-tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    chart.tf = b.dataset.tf; chart.candles = []; $('chart-empty').textContent = 'Loading…'; drawChart(); loadChart();
  }));
  loadChart(); setInterval(loadChart, 60000);

  /* ---------- Live metrics ---------- */
  let first = true;
  function markOffline(msg) { $('live-dot').classList.add('off'); $('updated').textContent = msg || 'live feed offline'; }
  function applyMetrics(m) {
    if (!m || m.error || m.marketCap == null) return markOffline(m && m.error ? 'feed error' : undefined);
    $('live-dot').classList.toggle('off', !!m.stale);
    $('updated').textContent = (m.stale ? 'stale · ' : 'live · ') + new Date(m.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (m.symbol) { $('tok-name').textContent = '$' + m.symbol; }
    if (m.imageUrl) { $('tok-logo').src = m.imageUrl; $('tok-logo-nav').src = m.imageUrl; $('tok-logo').referrerPolicy = 'no-referrer'; }
    $('stat-price').textContent = fmtPrice(m.priceUsd);
    const ch = m.priceChange && m.priceChange.h24;
    const chip = $('stat-change'); chip.textContent = fmtPct(ch) + ' 24h'; chip.className = 'chip ' + dirCls(ch);
    $('stat-mcap').textContent = fmtUsd(m.marketCap);
    $('stat-liq').textContent = fmtUsd(m.liquidityUsd);
    $('stat-vol').textContent = fmtUsd(m.volume && m.volume.h24);
    $('stat-holders').textContent = m.holders != null ? fmtNum(m.holders) : '—';
    // proof row
    // Proof row: only checks that pass are shown — it's reassurance for buyers, not a risk report.
    const proofs = [];
    const rpcOk = m.sources && m.sources.rpc === 'ok';
    if (rpcOk && !m.mintAuthority) proofs.push(['Mint authority revoked', 'Supply is fixed forever']);
    if (rpcOk && !m.freezeAuthority) proofs.push(['Freeze authority revoked', 'Wallets can never be frozen']);
    if (m.lpLockedPct != null && m.lpLockedPct >= 90) proofs.push(['Liquidity locked', `${Math.round(m.lpLockedPct)}% of LP${m.dexId ? ' · ' + esc(m.dexId) : ''}`]);
    if (m.rugScore != null && m.rugScore <= 20 && !(m.risks && m.risks.length)) proofs.push(['RugCheck clean', `Risk score ${m.rugScore}/100 · no flags`]);
    if (m.creatorBurned) proofs.push(['Creator rights burned', 'Sent to the incinerator']);
    if (m.bonded) proofs.push(['Bonded', `Trading on ${esc(m.dexId || 'PumpSwap')}`]);
    $('proof-grid').innerHTML = proofs.map(([k, v]) => `<div class="proof ok"><i>✓</i><div><b>${esc(k)}</b><span>${v}</span></div></div>`).join('');
    renderEvolution(m.marketCap, true);
    first = false;
  }
  async function pollMetrics() {
    try { const r = await fetch('/api/token', { cache: 'no-store' }); applyMetrics(await r.json()); } catch (e) { markOffline(); }
  }
  pollMetrics(); setInterval(pollMetrics, 30000);

  /* ---------- Evolution roadmap ---------- */
  function renderEvolution(cur, live) {
    const ms = C.milestones;
    const done = ms.filter(m => cur >= m.mcap).length;
    const next = ms[done];
    const prev = done > 0 ? ms[done - 1].mcap : 0;
    const partial = next ? Math.max(0, Math.min(1, (cur - prev) / (next.mcap - prev))) : 1;
    $('evo-row').innerHTML = ms.map((m, i) => {
      const cls = i < done ? 'done' : i === done ? 'current' : 'locked';
      const tag = i < done ? 'reached' : i === done ? 'in progress' : 'locked';
      const bar = i === done ? `<div class="evo-bar"><i style="width:${(partial * 100).toFixed(1)}%"></i></div>` : '';
      return `<div class="evo-stage ${cls}"><span class="tag">${tag}</span><img src="${D.assets.art(m.dex)}" alt="${esc(m.label)}"><b>${esc(m.label)}</b><div class="mcap">${fmtUsd(m.mcap)} mcap</div><p>${esc(m.perk)}</p>${bar}</div>`;
    }).join('');
    $('evo-note').textContent = next ? `${fmtUsd(cur)} now · ${Math.round(partial * 100)}% of the way to ${next.label} (${fmtUsd(next.mcap)})${live ? '' : ' · last known'}` : `${fmtUsd(cur)} — fully evolved.`;
  }
  renderEvolution(C.stats.marketCap, false);

  /* ---------- Community ---------- */
  const socials = [
    ['twitter', '𝕏', 'X community', 'Announcements, raids, memes'],
    ['telegram', '✈', 'Telegram', 'Holder chat'],
    ['dexscreener', '📈', 'DexScreener', 'Chart and trades'],
    ['pumpfun', '💊', 'pump.fun', 'Token page'],
    ['buy', '⇄', 'Jupiter', 'Swap SOL for ' + C.ticker]
  ].filter(([k]) => C.links[k]);
  $('social-grid').innerHTML = socials.map(([k, ic, name, sub]) => `<a class="social" href="${esc(C.links[k])}" target="_blank" rel="noopener"><span class="ic">${ic}</span><div><b>${esc(name)}</b><span>${esc(sub)}</span></div></a>`).join('');

  /* ---------- Shared ---------- */
  window.SiteFX = { confetti, setOnline(n) { $('online-count').textContent = n; $('arena-online').textContent = n; } };
})();
