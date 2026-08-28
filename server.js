/* ============================================================
   $POKEMON — site + arena server
   - Serves ./public as a static site (with byte-range support for media)
   - Live token metrics (/api/token, /api/chart) with caching
   - Authoritative multiplayer game over WebSockets
   - Economy: persistent accounts (wallet sign-in or smart-wallet login),
     $POKEMON deposits/withdrawals via the vault, staked battles,
     PokéCoin item shop, and a season prize pool paid to the top 3.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const Dex = require('./public/pokedex.js');
const Vault = require('./wallet.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const HALL_FILE = path.join(DATA_DIR, 'hall-of-fame.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
const IS_PROD = process.env.NODE_ENV === 'production';

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
const DEPOSIT_POLL_MS = 20000;
const DEPOSIT_WATCH_MS = 45 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

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
const TOKEN_DECIMALS = Number(process.env.TOKEN_DECIMALS || 6);
const ECON = Object.assign({ stakes: true, minStake: 1000, maxStake: 5000000, feePct: 4, prizePoolShare: 75, seasonHours: 24, minWithdraw: 1000, maxWithdrawPerDay: 2000000, startingCoins: 100 }, SITE.economy || {});
const UNIT = 10n ** BigInt(TOKEN_DECIMALS);
const toBase = whole => BigInt(Math.floor(Number(whole))) * UNIT;
const toWhole = base => Number(BigInt(base) / UNIT) + Number(BigInt(base) % UNIT) / Number(UNIT);
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
    out.holders = r.totalHolders; out.rugScore = r.score_normalised;
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
    out.createdAt = p.created_timestamp || null; out.creator = p.creator || null; out.ctoAddress = p.cto_address || null;
    const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
    out.creatorBurned = p.creator === INCINERATOR || p.cto_address === INCINERATOR;
    out.bonded = !!p.complete; out.description = p.description || '';
    if (!out.marketCap && p.usd_market_cap) out.marketCap = Number(p.usd_market_cap);
    if (!out.imageUrl && p.image_uri) out.imageUrl = p.image_uri;
  } else out.sources.pumpfun = 'error';
  if (supply.status === 'fulfilled' && supply.value.result) { out.sources.rpc = 'ok'; out.supply = supply.value.result.value.uiAmount; out.decimals = supply.value.result.value.decimals; } else out.sources.rpc = 'error';
  if (mintInfo.status === 'fulfilled' && mintInfo.value.result && mintInfo.value.result.value) {
    const info = mintInfo.value.result.value.data && mintInfo.value.result.value.data.parsed && mintInfo.value.result.value.data.parsed.info;
    if (info) { out.mintAuthority = info.mintAuthority || null; out.freezeAuthority = info.freezeAuthority || null; out.tokenProgram = mintInfo.value.result.value.owner; }
  }
  return out;
}
function getTokenMetrics() {
  if (tokenCache.data && (Date.now() - tokenCache.at) < TOKEN_CACHE_MS) return Promise.resolve(tokenCache.data);
  if (tokenCache.pending) return tokenCache.pending;
  tokenCache.pending = buildTokenMetrics()
    .then(data => { tokenCache.data = data; tokenCache.at = Date.now(); return data; })
    .catch(err => tokenCache.data ? Object.assign({}, tokenCache.data, { stale: true }) : { mint: TOKEN_MINT, error: String(err && err.message || err), updatedAt: Date.now(), sources: {} })
    .finally(() => { tokenCache.pending = null; });
  return tokenCache.pending;
}
const chartCache = {};
const TIMEFRAMES = { '5m': ['minute', 5], '15m': ['minute', 15], '1h': ['hour', 1], '4h': ['hour', 4] };
async function buildChart(tf) {
  const metrics = await getTokenMetrics();
  const pool = metrics.pairAddress;
  if (!pool) return { error: 'No pair yet', candles: [] };
  const [unit, agg] = TIMEFRAMES[tf] || TIMEFRAMES['15m'];
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/${unit}?aggregate=${agg}&limit=300&currency=usd`, null, 10000);
  const list = (j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
  return { pool, tf, candles: list.slice().reverse().map(c => [c[0] * 1000, c[1], c[2], c[3], c[4], c[5]]), updatedAt: Date.now() };
}
function getChart(tf) {
  tf = TIMEFRAMES[tf] ? tf : '15m';
  const c = chartCache[tf] || (chartCache[tf] = { at: 0, data: null, pending: null });
  if (c.data && Date.now() - c.at < CHART_CACHE_MS) return Promise.resolve(c.data);
  if (c.pending) return c.pending;
  c.pending = buildChart(tf).then(d => { c.data = d; c.at = Date.now(); return d; })
    .catch(err => c.data ? Object.assign({}, c.data, { stale: true }) : { error: String(err && err.message || err), candles: [] })
    .finally(() => { c.pending = null; });
  return c.pending;
}
if (TOKEN_MINT) { getTokenMetrics().then(() => getChart('15m')); setInterval(getTokenMetrics, TOKEN_CACHE_MS); }

// ---------- Ledger (persistent accounts, balances, seasons) ----------
const now = () => Date.now();
let ledger = { accounts: {}, sessions: {}, processedSigs: {}, nextDepositIndex: 1, season: null, pool: '0', treasury: '0', withdrawals: [], deposits: [], prizes: [] };
try { if (fs.existsSync(LEDGER_FILE)) ledger = Object.assign(ledger, JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'))); } catch (e) { console.error('ledger load failed', e.message); }
let ledgerDirty = false, ledgerTimer = null;
function saveLedger(sync) {
  const write = () => {
    ledgerTimer = null; ledgerDirty = false;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = LEDGER_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(ledger));
      fs.renameSync(tmp, LEDGER_FILE);
    } catch (e) { console.error('ledger save failed', e.message); }
  };
  if (sync) return write();
  ledgerDirty = true;
  if (!ledgerTimer) ledgerTimer = setTimeout(write, 1500);
}
process.on('SIGTERM', () => { if (ledgerDirty) saveLedger(true); process.exit(0); });
process.on('SIGINT', () => { if (ledgerDirty) saveLedger(true); process.exit(0); });

const bal = acc => BigInt(acc.balance || '0');
const setBal = (acc, v) => { acc.balance = v.toString(); saveLedger(); };
function credit(acc, amount) { setBal(acc, bal(acc) + BigInt(amount)); }
function debit(acc, amount) { const a = BigInt(amount); if (bal(acc) < a) throw new Error('Insufficient balance'); setBal(acc, bal(acc) - a); }

// ---------- Vault (Solana) ----------
let vault = null;
try {
  if (TOKEN_MINT && !/REPLACE/i.test(TOKEN_MINT)) {
    vault = Vault.create({ rpcUrl: SOLANA_RPC, mint: TOKEN_MINT, decimals: TOKEN_DECIMALS, dataDir: DATA_DIR, secret: process.env.VAULT_SECRET_KEY, tokenProgram: process.env.TOKEN_PROGRAM || 'token2022' });
    if (vault.generated) console.warn('\n  ⚠ Generated a new vault keypair at data/vault.json — back it up and/or set VAULT_SECRET_KEY. Fund it with a little SOL for fees.\n');
  }
} catch (e) { console.error('vault init failed:', e.message); }

// ---------- Season prize pool ----------
function seasonLength() { return Math.max(1, Number(ECON.seasonHours) || 24) * 3600 * 1000; }
function ensureSeason() {
  if (!ledger.season || !ledger.season.end) { ledger.season = { start: now(), end: now() + seasonLength(), points: {}, number: (ledger.season && ledger.season.number || 0) + 1 }; saveLedger(); }
}
ensureSeason();
function seasonTop(n) {
  const pts = ledger.season.points || {};
  return Object.keys(pts).filter(id => pts[id] > 0 && ledger.accounts[id]).sort((a, b) => pts[b] - pts[a]).slice(0, n)
    .map(id => ({ id, name: ledger.accounts[id].name, points: pts[id], mon: accountMon(ledger.accounts[id]) }));
}
function accountMon(acc) { const m = (acc.party || [])[acc.active || 0] || acc.party && acc.party[0]; return m ? { dex: m.dex, shiny: !!m.shiny } : null; }
function seasonView(p) {
  return { number: ledger.season.number, endsAt: ledger.season.end, pool: toWhole(ledger.pool), top: seasonTop(10), mine: p && p.accountId ? (ledger.season.points[p.accountId] || 0) : 0, feePct: ECON.feePct, poolShare: ECON.prizePoolShare, seasonHours: ECON.seasonHours };
}
function addSeasonPoints(p, pts) {
  if (!p.accountId) return;
  ledger.season.points[p.accountId] = (ledger.season.points[p.accountId] || 0) + pts;
  saveLedger();
}
function distributePrizes() {
  const top = seasonTop(3);
  const pool = BigInt(ledger.pool || '0');
  const shares = [50n, 30n, 20n];
  const winners = [];
  let paid = 0n;
  top.forEach((w, i) => {
    const amt = pool * shares[i] / 100n;
    if (amt <= 0n) return;
    credit(ledger.accounts[w.id], amt); paid += amt;
    winners.push({ id: w.id, name: w.name, amount: toWhole(amt), points: w.points, place: i + 1 });
  });
  ledger.pool = (pool - paid).toString(); // unpaid shares roll over
  ledger.prizes.push({ at: now(), season: ledger.season.number, winners });
  ledger.prizes = ledger.prizes.slice(-50);
  ledger.season = { start: now(), end: now() + seasonLength(), points: {}, number: (ledger.season.number || 0) + 1 };
  saveLedger(true);
  if (winners.length) broadcast({ t: 'announce', kind: 'prize', text: `🏆 Season prizes paid: ${winners.map(w => `${w.name} +${fmt(w.amount)}`).join(' · ')}` });
  for (const p of players.values()) if (p.accountId) sendAccount(p);
  broadcastSeason();
}
setInterval(() => { if (now() >= ledger.season.end) distributePrizes(); }, 60000);
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function broadcastSeason() { for (const p of players.values()) send(p, { t: 'season', season: seasonView(p) }); }

// ---------- Accounts & auth ----------
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 32).toString('hex'); }
function newAccount(id, type, name, extra) {
  const acc = Object.assign({ id, type, name, balance: '0', coins: ECON.startingCoins, inventory: {}, party: null, active: 0, score: 0, catches: 0, wins: 0, losses: 0, createdAt: now(), lastSeen: now(), depositIndex: ledger.nextDepositIndex++, withdrawn: [] }, extra || {});
  ledger.accounts[id] = acc;
  saveLedger();
  return acc;
}
function issueSession(accId) {
  const token = crypto.randomBytes(24).toString('base64url');
  ledger.sessions[token] = { id: accId, expires: now() + SESSION_TTL_MS };
  // prune
  for (const [t, s] of Object.entries(ledger.sessions)) if (s.expires < now()) delete ledger.sessions[t];
  saveLedger();
  return token;
}
function accountView(p) {
  const acc = ledger.accounts[p.accountId];
  if (!acc) return null;
  const dayAgo = now() - 86400000;
  const withdrawnToday = (acc.withdrawn || []).filter(w => w.at > dayAgo).reduce((s, w) => s + w.amount, 0);
  return {
    id: acc.id, type: acc.type, name: acc.name, walletPubkey: acc.pubkey || null,
    balance: toWhole(bal(acc)), coins: acc.coins, inventory: acc.inventory || {},
    depositAddress: vault ? vault.depositAddress(acc.depositIndex) : null,
    seasonPoints: ledger.season.points[acc.id] || 0, score: acc.score, withdrawnToday, token: p.sessionToken || null
  };
}
function sendAccount(p) { const v = accountView(p); if (v) send(p, { t: 'account', account: v }); }

/** Copy the player's in-memory progress into their account record. */
function syncAccount(p) {
  const acc = p.accountId && ledger.accounts[p.accountId];
  if (!acc) return;
  acc.party = p.party; acc.active = p.active; acc.coins = p.coins; acc.inventory = p.inventory;
  acc.score = p.score; acc.catches = p.catches; acc.wins = p.wins; acc.losses = p.losses; acc.lastSeen = now();
  saveLedger();
}
/** Attach an account to a connected player: restore progress (or adopt the guest's progress into a fresh account). */
function attachAccount(p, acc) {
  for (const other of players.values()) if (other !== p && other.accountId === acc.id) { other.accountId = null; other.sessionToken = null; send(other, { t: 'account_error', msg: 'Signed in from another tab — this session is now a guest.' }); send(other, { t: 'account', account: null }); }
  p.accountId = acc.id;
  if (acc.party && acc.party.length) {
    p.party = acc.party; p.active = Math.min(acc.active || 0, acc.party.length - 1);
    p.coins = acc.coins; p.inventory = acc.inventory || {};
    p.score = acc.score; p.catches = acc.catches; p.wins = acc.wins; p.losses = acc.losses;
  } else { syncAccount(p); }
  if (acc.type === 'wallet' && !acc.name) acc.name = p.name;
  p.name = uniqueName(acc.name || p.name, p);
  acc.name = p.name;
  p.sessionToken = issueSession(acc.id);
  watchDeposits(acc);
  sendAccount(p);
  send(p, { t: 'season', season: seasonView(p) });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
  lbDirty = true;
}
function handleAuth(p, msg) {
  const fail = m => send(p, { t: 'account_error', msg: m });
  p.authAttempts = (p.authAttempts || 0) + 1;
  if (p.authAttempts > 12) return fail('Too many attempts. Reconnect and try again.');
  if (msg.type === 'token') {
    const s = ledger.sessions[String(msg.token || '')];
    if (!s || s.expires < now() || !ledger.accounts[s.id]) return send(p, { t: 'account', account: null });
    return attachAccount(p, ledger.accounts[s.id]);
  }
  if (msg.type === 'wallet') {
    if (!vault) return fail('Wallet sign-in is not available right now.');
    const pubkey = String(msg.pubkey || '');
    if (!p.authNonce || !vault.isValidPubkey(pubkey)) return fail('Invalid wallet sign-in.');
    const message = authMessage(p.authNonce);
    if (!vault.verifyWalletSignature(pubkey, message, String(msg.signature || ''))) return fail('Signature did not verify.');
    p.authNonce = null;
    const id = 'w:' + pubkey;
    const acc = ledger.accounts[id] || newAccount(id, 'wallet', p.name, { pubkey });
    return attachAccount(p, acc);
  }
  if (msg.type === 'smart') {
    const username = String(msg.username || '').trim();
    const password = String(msg.password || '');
    if (!USERNAME_RE.test(username)) return fail('Username: 3–16 letters, numbers or _');
    if (password.length < 8) return fail('Passphrase must be at least 8 characters.');
    const id = 's:' + username.toLowerCase();
    let acc = ledger.accounts[id];
    if (!acc) {
      if (!msg.create) return fail('No account with that name. Tick "create" to make one.');
      const salt = crypto.randomBytes(16).toString('hex');
      acc = newAccount(id, 'smart', username, { salt, passHash: hashPassword(password, salt) });
    } else if (hashPassword(password, acc.salt) !== acc.passHash) return fail('Wrong passphrase.');
    return attachAccount(p, acc);
  }
  fail('Unknown sign-in type.');
}
const authMessage = nonce => `Sign in to $POKEMON Arena\nNonce: ${nonce}`;
function handleLogout(p) {
  if (p.sessionToken) delete ledger.sessions[p.sessionToken];
  syncAccount(p);
  p.accountId = null; p.sessionToken = null;
  send(p, { t: 'account', account: null });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
  saveLedger();
}

// ---------- Deposits (poll deposit addresses of active accounts) ----------
const depositWatch = new Map(); // accountId -> until
function watchDeposits(acc) { depositWatch.set(acc.id, now() + DEPOSIT_WATCH_MS); }
const pendingSweeps = new Set();
let pollingDeposits = false;
async function pollDeposits() {
  if (!vault || pollingDeposits) return;
  pollingDeposits = true;
  try {
    const targets = [];
    for (const [id, until] of depositWatch) {
      if (until < now()) { depositWatch.delete(id); continue; }
      const acc = ledger.accounts[id];
      if (acc) targets.push({ index: acc.depositIndex, ata: vault.depositAta(acc.depositIndex), id });
    }
    if (!targets.length) return;
    const found = await vault.fetchDeposits(targets, sig => !!ledger.processedSigs[sig]);
    for (const d of found) {
      ledger.processedSigs[d.signature] = true;
      const t = targets.find(x => x.index === d.index);
      const acc = t && ledger.accounts[t.id];
      if (!acc || d.amount <= 0n) { saveLedger(); continue; }
      credit(acc, d.amount);
      ledger.deposits.push({ at: now(), id: acc.id, amount: d.amount.toString(), signature: d.signature, from: d.from });
      ledger.deposits = ledger.deposits.slice(-500);
      pendingSweeps.add(acc.depositIndex);
      const p = [...players.values()].find(x => x.accountId === acc.id);
      if (p) { send(p, { t: 'deposit_credited', amount: toWhole(d.amount), signature: d.signature }); sendAccount(p); }
      console.log(`deposit: ${acc.name} +${toWhole(d.amount)} (${d.signature.slice(0, 8)}…)`);
    }
    // keep processedSigs bounded
    const sigs = Object.keys(ledger.processedSigs);
    if (sigs.length > 5000) for (const s of sigs.slice(0, sigs.length - 4000)) delete ledger.processedSigs[s];
    saveLedger();
    for (const index of [...pendingSweeps]) {
      try { const sig = await vault.sweep(index); pendingSweeps.delete(index); if (sig) console.log(`swept deposit #${index} → vault (${sig.slice(0, 8)}…)`); }
      catch (e) { console.warn(`sweep #${index} failed (will retry): ${e.message}`); }
    }
  } catch (e) { console.warn('deposit poll error:', e.message); }
  finally { pollingDeposits = false; }
}
setInterval(pollDeposits, DEPOSIT_POLL_MS);

// ---------- Withdrawals ----------
const withdrawing = new Set();
async function handleWithdraw(p, msg) {
  const acc = p.accountId && ledger.accounts[p.accountId];
  const fail = m => send(p, { t: 'withdraw_result', ok: false, error: m });
  if (!acc) return fail('Sign in first.');
  if (!vault) return fail('Withdrawals are not available right now.');
  const amount = Math.floor(Number(msg.amount));
  const to = String(msg.to || acc.pubkey || '').trim();
  if (!Number.isFinite(amount) || amount < ECON.minWithdraw) return fail(`Minimum withdrawal is ${fmt(ECON.minWithdraw)} $POKEMON.`);
  if (!vault.isValidPubkey(to)) return fail('Enter a valid Solana wallet address.');
  const dayAgo = now() - 86400000;
  const today = (acc.withdrawn || []).filter(w => w.at > dayAgo).reduce((s, w) => s + w.amount, 0);
  if (today + amount > ECON.maxWithdrawPerDay) return fail(`Daily limit is ${fmt(ECON.maxWithdrawPerDay)} $POKEMON.`);
  if (p.battleId) return fail('Finish your battle first.');
  if (withdrawing.has(acc.id)) return fail('A withdrawal is already in progress.');
  const base = toBase(amount);
  if (bal(acc) < base) return fail('Insufficient balance.');
  withdrawing.add(acc.id);
  debit(acc, base);
  acc.withdrawn = (acc.withdrawn || []).filter(w => w.at > dayAgo - 86400000);
  acc.withdrawn.push({ at: now(), amount, to });
  saveLedger(true);
  sendAccount(p);
  try {
    const sig = await vault.withdraw(to, base);
    ledger.withdrawals.push({ at: now(), id: acc.id, amount, to, signature: sig });
    ledger.withdrawals = ledger.withdrawals.slice(-500);
    saveLedger(true);
    send(p, { t: 'withdraw_result', ok: true, amount, to, signature: sig });
    console.log(`withdraw: ${acc.name} -${amount} → ${to.slice(0, 6)}… (${sig.slice(0, 8)}…)`);
  } catch (e) {
    credit(acc, base);
    acc.withdrawn = acc.withdrawn.filter(w => !(w.amount === amount && w.to === to && now() - w.at < 60000));
    saveLedger(true);
    sendAccount(p);
    fail('Transfer failed: ' + (e.message || 'unknown error').slice(0, 120) + '. Your balance was not changed.');
    console.error('withdraw failed:', e.message);
  } finally { withdrawing.delete(acc.id); }
}

// ---------- Static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  let urlPath = decodeURIComponent(url.pathname);
  const json = (obj, cache) => { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': cache || 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  if (urlPath === '/api/stats') return json({ online: players.size, wilds: wilds.size, leaderboard: leaderboard(10), hallOfFame: hallOfFame(10), season: seasonView(null) });
  if (urlPath === '/api/token') return void getTokenMetrics().then(d => json(d, 'public, max-age=15'));
  if (urlPath === '/api/chart') return void getChart(url.searchParams.get('tf')).then(d => json(d, 'public, max-age=30'));
  if (urlPath === '/api/blockhash') return void rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]).then(r => json({ blockhash: r.result.value.blockhash, lastValidBlockHeight: r.result.value.lastValidBlockHeight })).catch(e => json({ error: e.message }));
  if (urlPath === '/api/admin/vault') {
    if (!process.env.ADMIN_KEY || url.searchParams.get('key') !== process.env.ADMIN_KEY) { res.writeHead(403); return res.end('forbidden'); }
    const total = Object.values(ledger.accounts).reduce((s, a) => s + bal(a), 0n);
    return void (vault ? vault.status() : Promise.resolve(null)).then(st => json({ vault: st, accounts: Object.keys(ledger.accounts).length, liabilities: toWhole(total), pool: toWhole(ledger.pool), treasury: toWhole(ledger.treasury), pendingSweeps: [...pendingSweeps], recentDeposits: ledger.deposits.slice(-10), recentWithdrawals: ledger.withdrawals.slice(-10), prizes: ledger.prizes.slice(-5) }));
  }
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404 — a wild 404 appeared!'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const isAsset = urlPath.startsWith('/assets/');
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : isAsset ? 'public, max-age=604800, immutable' : 'public, max-age=300', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
      return;
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
  });
});

// ---------- Deterministic map generation ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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

// ---------- Game state ----------
const players = new Map();
const wilds = new Map();
const battles = new Map();
let guestHall = [];
try { if (fs.existsSync(HALL_FILE)) guestHall = JSON.parse(fs.readFileSync(HALL_FILE, 'utf8')); } catch (e) { guestHall = []; }
let hallDirty = false;
function recordHall(p) {
  if (p.accountId || !p || p.score <= 0) return;
  const mon = activeMon(p);
  const existing = guestHall.find(h => h.name.toLowerCase() === p.name.toLowerCase());
  if (existing) { if (p.score > existing.score) { Object.assign(existing, { score: p.score, catches: p.catches, wins: p.wins, dex: mon.dex, shiny: !!mon.shiny }); hallDirty = true; } }
  else { guestHall.push({ name: p.name, score: p.score, catches: p.catches, wins: p.wins, dex: mon.dex, shiny: !!mon.shiny }); hallDirty = true; }
  guestHall.sort((a, b) => b.score - a.score); guestHall = guestHall.slice(0, 50);
}
setInterval(() => {
  if (!hallDirty) return; hallDirty = false;
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFile(HALL_FILE, JSON.stringify(guestHall, null, 2), () => {}); } catch (e) { /* ignore */ }
}, 5000);
function hallOfFame(n) {
  const accs = Object.values(ledger.accounts).filter(a => a.score > 0).map(a => ({ name: a.name, score: a.score, catches: a.catches, wins: a.wins, dex: (accountMon(a) || {}).dex, shiny: !!(accountMon(a) || {}).shiny, account: true }));
  return accs.concat(guestHall).sort((a, b) => b.score - a.score).slice(0, n);
}

const uid = () => crypto.randomBytes(6).toString('base64url');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function uniqueName(raw, self) {
  let n = String(raw || '').replace(/[^\w \-]/g, '').trim().slice(0, 14);
  if (n.length < 2) n = 'Trainer' + Math.floor(Math.random() * 900 + 100);
  const taken = new Set([...players.values()].filter(p => p !== self).map(p => p.name.toLowerCase()));
  let candidate = n, i = 2;
  while (taken.has(candidate.toLowerCase())) candidate = n.slice(0, 11) + '#' + (i++);
  return candidate;
}
const sanitizeColor = c => /^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c.toLowerCase() : '#e3350d';
const activeMon = p => p.party[p.active] || p.party[0];
const levelOf = p => 1 + Math.floor(p.catches / 2) + Math.floor(p.wins / 2);
function publicPlayer(p) {
  const mon = activeMon(p);
  return { id: p.id, name: p.name, x: p.x, y: p.y, dir: p.dir, color: p.color, mon: { dex: mon.dex, shiny: !!mon.shiny }, level: levelOf(p), score: p.score, catches: p.catches, wins: p.wins, losses: p.losses, busy: !!(p.battleId || p.encounter), account: !!p.accountId, canStake: !!(p.accountId && ECON.stakes) };
}
function send(p, msg) { if (!p || !p.ws || p.ws.readyState !== 1) return; try { p.ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
function sendWs(ws, msg) { if (ws.readyState !== 1) return; try { ws.send(JSON.stringify(msg)); } catch (e) { /* ignore */ } }
function broadcast(msg, exceptId) { const data = JSON.stringify(msg); for (const p of players.values()) { if (p.id === exceptId || p.ws.readyState !== 1) continue; try { p.ws.send(data); } catch (e) { /* ignore */ } } }
function broadcastAll(msg) { const data = JSON.stringify(msg); for (const ws of wss.clients) { if (ws.readyState !== 1) continue; try { ws.send(data); } catch (e) { /* ignore */ } } }
function leaderboard(n) {
  return [...players.values()].sort((a, b) => b.score - a.score || b.catches - a.catches).slice(0, n)
    .map(p => { const m = activeMon(p); return { id: p.id, name: p.name, score: p.score, catches: p.catches, wins: p.wins, dex: m.dex, shiny: !!m.shiny, account: !!p.accountId }; });
}
let lbDirty = true;
setInterval(() => { if (!lbDirty) return; lbDirty = false; broadcast({ t: 'leaderboard', list: leaderboard(10), hallOfFame: hallOfFame(10) }); broadcastSeason(); }, 2000);
setInterval(() => broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size }), 10000);

/** Award points: score (all-time), PokéCoins, and season points. */
function award(p, pts) { p.score += pts; p.coins += pts; addSeasonPoints(p, pts); lbDirty = true; }

// ---------- Evolution ----------
function checkEvolutions(p) {
  const level = levelOf(p);
  p.party.forEach((mon, index) => {
    const sp = Dex.BY_DEX[mon.dex];
    if (!sp || !sp.evolvesTo || level < sp.evolveLevel) return;
    const targets = [].concat(sp.evolvesTo);
    const to = targets[Math.floor(Math.random() * targets.length)];
    const from = mon.dex; mon.dex = to;
    send(p, { t: 'evolve', index, from, to, shiny: !!mon.shiny, party: p.party });
    broadcast({ t: 'announce', kind: 'evolve', text: `${p.name}'s ${Dex.BY_DEX[from].name} evolved into ${Dex.BY_DEX[to].name}!` }, p.id);
  });
}

// ---------- Wild spawns ----------
const WILD_TOTAL_WEIGHT = Dex.WILD.reduce((s, sp) => s + sp.weight, 0);
function pickSpecies() { let r = Math.random() * WILD_TOTAL_WEIGHT; for (const sp of Dex.WILD) { r -= sp.weight; if (r <= 0) return sp; } return Dex.WILD[0]; }
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
setInterval(() => { const t = now(); for (const w of wilds.values()) if (w.expires <= t) { wilds.delete(w.id); broadcast({ t: 'wild_remove', id: w.id }); } if (players.size > 0) spawnWild(); }, WILD_SPAWN_MS);
for (let i = 0; i < 8; i++) spawnWild();

// ---------- Encounters ----------
function startEncounter(p, w) {
  wilds.delete(w.id); broadcast({ t: 'wild_remove', id: w.id });
  p.encounter = { wild: w, throwsLeft: ENCOUNTER_THROWS, timer: setTimeout(() => endEncounter(p, 'timeout'), ENCOUNTER_TIMEOUT_MS) };
  send(p, { t: 'encounter', wild: w, throws: ENCOUNTER_THROWS });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
}
function endEncounter(p, reason) {
  if (!p.encounter) return;
  clearTimeout(p.encounter.timer);
  const w = p.encounter.wild; p.encounter = null;
  send(p, { t: 'encounter_end', reason, dex: w.dex });
  broadcast({ t: 'player_update', player: publicPlayer(p) });
}
function handleThrow(p, quality, ball) {
  const enc = p.encounter;
  if (!enc) return;
  quality = clamp(Number(quality) || 0, 0, 1);
  const sp = Dex.BY_DEX[enc.wild.dex];
  let mult = 1, ballUsed = 'pokeball';
  const item = Dex.ITEMS[ball];
  if (item && item.kind === 'ball' && (p.inventory[ball] || 0) > 0) { p.inventory[ball] -= 1; mult = item.mult; ballUsed = ball; syncAccount(p); }
  const chance = clamp(sp.catchRate * mult * (0.35 + 0.9 * quality), 0.05, 0.97);
  const success = Math.random() < chance;
  enc.throwsLeft -= 1;
  if (success) {
    const isNew = !p.party.some(m => m.dex === sp.dex);
    const mon = { dex: sp.dex, shiny: !!enc.wild.shiny };
    if (p.party.length < 6) p.party.push(mon); else p.party[5] = mon;
    const points = sp.points * (mon.shiny ? 3 : 1) + (isNew ? 5 : 0);
    award(p, points); p.catches += 1;
    clearTimeout(enc.timer); p.encounter = null;
    send(p, { t: 'catch_result', success: true, mon, points, isNew, quality, ball: ballUsed, party: p.party, coins: p.coins, inventory: p.inventory });
    checkEvolutions(p); syncAccount(p); recordHall(p);
    broadcast({ t: 'player_update', player: publicPlayer(p) });
    if (sp.rarity === 'legendary') broadcast({ t: 'announce', kind: 'legendary', text: `${p.name} caught a legendary ${sp.name}!` });
    else if (mon.shiny) broadcast({ t: 'announce', kind: 'shiny', text: `✨ ${p.name} caught a shiny ${sp.name}!` });
    else if (sp.rarity === 'rare' || sp.rarity === 'epic') broadcast({ t: 'announce', kind: 'catch', text: `${p.name} caught a ${sp.name}!` }, p.id);
  } else if (enc.throwsLeft <= 0) { send(p, { t: 'catch_result', success: false, dex: sp.dex, throwsLeft: 0, fled: true, ball: ballUsed, inventory: p.inventory }); endEncounter(p, 'fled'); }
  else send(p, { t: 'catch_result', success: false, dex: sp.dex, throwsLeft: enc.throwsLeft, fled: false, ball: ballUsed, inventory: p.inventory });
}

// ---------- Shop ----------
function handleBuy(p, msg) {
  const item = Dex.ITEMS[msg.item];
  const qty = clamp(Math.floor(Number(msg.qty) || 1), 1, 10);
  if (!item) return send(p, { t: 'shop_result', ok: false, error: 'Unknown item.' });
  const cost = item.cost * qty;
  if (p.coins < cost) return send(p, { t: 'shop_result', ok: false, error: `Not enough PokéCoins (${cost} needed).` });
  p.coins -= cost; p.inventory[item.id] = (p.inventory[item.id] || 0) + qty;
  syncAccount(p);
  send(p, { t: 'shop_result', ok: true, item: item.id, qty, coins: p.coins, inventory: p.inventory });
}

// ---------- Battles (with optional $POKEMON stakes) ----------
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function makeSide(p) {
  const mon = activeMon(p); const sp = Dex.BY_DEX[mon.dex]; const level = levelOf(p);
  const maxHp = 100 + level * 6 + sp.stage * 15 + (sp.bulky ? 20 : 0);
  return { pid: p.id, name: p.name, dex: sp.dex, shiny: !!mon.shiny, level, stage: sp.stage, hp: maxHp, maxHp, action: null, color: p.color, atk: null, def: null };
}
function battleView(b, forPid) {
  const me = b.a.pid === forPid ? b.a : b.b, foe = b.a.pid === forPid ? b.b : b.a;
  const strip = s => ({ pid: s.pid, name: s.name, dex: s.dex, shiny: s.shiny, level: s.level, hp: s.hp, maxHp: s.maxHp, color: s.color, types: Dex.BY_DEX[s.dex].types });
  const mePlayer = players.get(me.pid);
  return { id: b.id, turn: b.turn, me: strip(me), foe: strip(foe), moves: Dex.BY_DEX[me.dex].moves, turnEndsAt: b.turnEndsAt, stake: toWhole(b.stake), pot: toWhole(b.pot), inventory: mePlayer ? mePlayer.inventory : {} };
}
function startBattle(p1, p2, stakeBase) {
  if (stakeBase > 0n) {
    const a1 = ledger.accounts[p1.accountId], a2 = ledger.accounts[p2.accountId];
    if (!a1 || !a2 || bal(a1) < stakeBase || bal(a2) < stakeBase) { send(p1, { t: 'error', msg: 'Stake failed: insufficient balance.' }); send(p2, { t: 'error', msg: 'Stake failed: insufficient balance.' }); return; }
    debit(a1, stakeBase); debit(a2, stakeBase);
    sendAccount(p1); sendAccount(p2);
  }
  const b = { id: uid(), a: makeSide(p1), b: makeSide(p2), turn: 1, timer: null, turnEndsAt: now() + BATTLE_TURN_MS, stake: stakeBase, pot: stakeBase * 2n, aAcc: p1.accountId, bAcc: p2.accountId };
  battles.set(b.id, b);
  p1.battleId = b.id; p2.battleId = b.id; p1.pendingChallenge = null; p2.pendingChallenge = null;
  send(p1, { t: 'battle_start', battle: battleView(b, p1.id) });
  send(p2, { t: 'battle_start', battle: battleView(b, p2.id) });
  broadcast({ t: 'player_update', player: publicPlayer(p1) }); broadcast({ t: 'player_update', player: publicPlayer(p2) });
  broadcast({ t: 'announce', kind: 'battle', text: stakeBase > 0n ? `⚔️ ${p1.name} vs ${p2.name} — ${fmt(toWhole(b.pot))} $POKEMON on the line` : `${p1.name} vs ${p2.name} — battle started` });
  armTurnTimer(b);
}
function armTurnTimer(b) {
  clearTimeout(b.timer);
  b.turnEndsAt = now() + BATTLE_TURN_MS;
  b.timer = setTimeout(() => { if (!battles.has(b.id)) return; for (const side of [b.a, b.b]) if (side.action == null) side.action = { move: Math.floor(Math.random() * 4) }; resolveTurn(b); }, BATTLE_TURN_MS);
}
function chooseAction(p, action) {
  const b = battles.get(p.battleId);
  if (!b) return;
  const side = b.a.pid === p.id ? b.a : b.b;
  if (side.action != null) return;
  if (action.item) {
    const item = Dex.ITEMS[action.item];
    if (!item || item.kind === 'ball' || (p.inventory[item.id] || 0) <= 0) return send(p, { t: 'error', msg: "You don't have that item." });
    p.inventory[item.id] -= 1; syncAccount(p);
    side.action = { item: item.id };
    send(p, { t: 'wallet_state', coins: p.coins, inventory: p.inventory });
  } else {
    const index = Number(action.move);
    if (!Number.isInteger(index) || index < 0 || index > 3) return;
    side.action = { move: index };
  }
  const other = side === b.a ? b.b : b.a;
  if (other.action != null) resolveTurn(b);
  else { send(p, { t: 'battle_waiting' }); send(players.get(other.pid), { t: 'battle_opponent_ready' }); }
}
function resolveTurn(b) {
  clearTimeout(b.timer);
  const spA = Dex.BY_DEX[b.a.dex], spB = Dex.BY_DEX[b.b.dex];
  const prio = (side, sp) => side.action.item ? 1000 : ((sp.moves[side.action.move] || sp.moves[0]).priority || 0) * 100 + sp.speed + Math.random() * 2;
  const order = prio(b.a, spA) >= prio(b.b, spB) ? [b.a, b.b] : [b.b, b.a];
  const events = [];
  let winner = null;
  for (const attacker of order) {
    const defender = attacker === b.a ? b.b : b.a;
    if (attacker.hp <= 0) continue;
    const sp = Dex.BY_DEX[attacker.dex], defSp = Dex.BY_DEX[defender.dex];
    if (attacker.action.item) {
      const item = Dex.ITEMS[attacker.action.item];
      if (item.kind === 'heal') { const before = attacker.hp; attacker.hp = Math.min(attacker.maxHp, attacker.hp + item.amount); events.push({ kind: 'item', by: attacker.pid, item: item.id, name: item.name, amount: attacker.hp - before }); }
      else if (item.kind === 'boost') { attacker.atk = { mult: item.mult, turns: item.turns }; events.push({ kind: 'item', by: attacker.pid, item: item.id, name: item.name, effect: 'attack up' }); }
      else if (item.kind === 'guard') { attacker.def = { mult: item.mult, turns: item.turns }; events.push({ kind: 'item', by: attacker.pid, item: item.id, name: item.name, effect: 'defense up' }); }
      continue;
    }
    const mv = sp.moves[attacker.action.move] || sp.moves[0];
    if (mv.heal) { const before = attacker.hp; attacker.hp = Math.min(attacker.maxHp, attacker.hp + mv.heal + attacker.level * 2); events.push({ kind: 'heal', by: attacker.pid, move: mv.name, type: mv.type, amount: attacker.hp - before }); continue; }
    if (Math.random() * 100 >= mv.acc) { events.push({ kind: 'miss', by: attacker.pid, move: mv.name, type: mv.type }); continue; }
    const eff = Dex.effectiveness(mv.type, defSp.types);
    if (eff === 0) { events.push({ kind: 'immune', by: attacker.pid, target: defender.pid, move: mv.name, type: mv.type }); continue; }
    const stab = sp.types.includes(mv.type) ? 1.2 : 1;
    const crit = Math.random() < 0.08 ? 1.6 : 1;
    const roll = 0.85 + Math.random() * 0.3;
    const atkMult = attacker.atk && attacker.atk.turns > 0 ? attacker.atk.mult : 1;
    const defMult = defender.def && defender.def.turns > 0 ? defender.def.mult : 1;
    const dmg = Math.max(1, Math.round(mv.power * (1 + attacker.level * 0.06 + attacker.stage * 0.15) * eff * stab * crit * roll * atkMult * defMult));
    defender.hp = Math.max(0, defender.hp - dmg);
    events.push({ kind: 'hit', by: attacker.pid, target: defender.pid, move: mv.name, type: mv.type, dmg, eff, crit: crit > 1, boosted: atkMult > 1, guarded: defMult < 1 });
    if (defender.hp <= 0) { winner = attacker; break; }
  }
  for (const side of [b.a, b.b]) { if (side.atk && side.atk.turns > 0) side.atk.turns--; if (side.def && side.def.turns > 0) side.def.turns--; }
  b.a.action = null; b.b.action = null; b.turn += 1;
  const pA = players.get(b.a.pid), pB = players.get(b.b.pid);
  const payload = side => { const other = side === b.a ? b.b : b.a; return { t: 'battle_turn', events, me: { hp: side.hp, maxHp: side.maxHp, atk: side.atk, def: side.def }, foe: { hp: other.hp, maxHp: other.maxHp, atk: other.atk, def: other.def }, turn: b.turn, turnEndsAt: now() + BATTLE_TURN_MS }; };
  send(pA, payload(b.a)); send(pB, payload(b.b));
  if (winner) endBattle(b, winner.pid, (winner === b.a ? b.b : b.a).pid, 'ko'); else armTurnTimer(b);
}
function endBattle(b, winnerId, loserId, reason) {
  clearTimeout(b.timer);
  battles.delete(b.id);
  const w = players.get(winnerId), l = players.get(loserId);
  let payout = 0, fee = 0n;
  if (b.pot > 0n) {
    fee = b.pot * BigInt(Math.round(ECON.feePct * 100)) / 10000n;
    const toPool = fee * BigInt(Math.round(ECON.prizePoolShare)) / 100n;
    ledger.pool = (BigInt(ledger.pool || '0') + toPool).toString();
    ledger.treasury = (BigInt(ledger.treasury || '0') + (fee - toPool)).toString();
    const winnings = b.pot - fee;
    // Pay the account recorded at battle start, so a winner who dropped mid-battle is still credited.
    const acc = ledger.accounts[b.a.pid === winnerId ? b.aAcc : b.bAcc];
    if (acc) { credit(acc, winnings); payout = toWhole(winnings); }
    else ledger.treasury = (BigInt(ledger.treasury) + winnings).toString();
    saveLedger(true);
  }
  if (w) { award(w, WIN_POINTS); w.wins += 1; w.battleId = null; }
  if (l) { award(l, LOSS_POINTS); l.losses += 1; l.battleId = null; }
  const msg = { t: 'battle_end', winner: winnerId, loser: loserId, reason, winnerName: w ? w.name : b.a.pid === winnerId ? b.a.name : b.b.name, loserName: l ? l.name : b.a.pid === loserId ? b.a.name : b.b.name, winPoints: WIN_POINTS, lossPoints: LOSS_POINTS, stake: toWhole(b.stake), payout, fee: toWhole(fee) };
  send(w, msg); send(l, msg);
  if (w) { checkEvolutions(w); syncAccount(w); recordHall(w); sendAccount(w); broadcast({ t: 'player_update', player: publicPlayer(w) }); }
  if (l) { syncAccount(l); recordHall(l); sendAccount(l); broadcast({ t: 'player_update', player: publicPlayer(l) }); }
  broadcast({ t: 'announce', kind: 'battle', text: `${msg.winnerName} defeated ${msg.loserName}${b.pot > 0n ? ` and won ${fmt(payout)} $POKEMON` : ''}${reason === 'forfeit' ? ' (forfeit)' : reason === 'disconnect' ? ' (disconnect)' : ''}` });
  if (b.pot > 0n) broadcastSeason();
}
function parseStake(p, target, stake) {
  stake = Math.floor(Number(stake) || 0);
  if (stake <= 0) return { base: 0n };
  if (!ECON.stakes) return { error: 'Staked battles are disabled.' };
  if (!p.accountId) return { error: 'Sign in to stake $POKEMON.' };
  if (!target.accountId) return { error: `${target.name} isn't signed in, so they can't stake.` };
  if (stake < ECON.minStake || stake > ECON.maxStake) return { error: `Stake must be between ${fmt(ECON.minStake)} and ${fmt(ECON.maxStake)} $POKEMON.` };
  const base = toBase(stake);
  if (bal(ledger.accounts[p.accountId]) < base) return { error: 'Insufficient balance for that stake.' };
  return { base };
}
function handleChallenge(p, targetId, stake) {
  const target = players.get(targetId);
  if (!target || target.id === p.id) return send(p, { t: 'error', msg: 'That trainer is not here.' });
  if (p.battleId || p.encounter) return send(p, { t: 'error', msg: 'You are busy.' });
  if (target.battleId || target.encounter) return send(p, { t: 'error', msg: `${target.name} is busy right now.` });
  if (distance(p, target) > CHALLENGE_RANGE) return send(p, { t: 'error', msg: 'Get closer to challenge them.' });
  const s = parseStake(p, target, stake);
  if (s.error) return send(p, { t: 'error', msg: s.error });
  if (target.pendingChallenge && target.pendingChallenge.from === p.id) return;
  if (p.pendingChallenge && p.pendingChallenge.from === target.id && p.pendingChallenge.stake === s.base) return handleAccept(p, target.id);
  target.pendingChallenge = { from: p.id, stake: s.base, expires: now() + CHALLENGE_TIMEOUT_MS };
  send(target, { t: 'challenge_received', from: publicPlayer(p), stake: toWhole(s.base), expiresAt: target.pendingChallenge.expires });
  send(p, { t: 'challenge_sent', to: publicPlayer(target), stake: toWhole(s.base) });
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
  if (pc.stake > 0n) {
    if (!p.accountId || bal(ledger.accounts[p.accountId]) < pc.stake) return send(p, { t: 'error', msg: `You need ${fmt(toWhole(pc.stake))} $POKEMON to accept this stake.` });
    if (!from.accountId || bal(ledger.accounts[from.accountId]) < pc.stake) { send(p, { t: 'error', msg: 'Challenger can no longer cover the stake.' }); return send(from, { t: 'error', msg: 'Your balance dropped below the stake.' }); }
  }
  startBattle(from, p, pc.stake);
}
function handleDecline(p, fromId) { const pc = p.pendingChallenge; if (!pc || pc.from !== fromId) return; p.pendingChallenge = null; send(players.get(fromId), { t: 'challenge_declined', by: publicPlayer(p) }); }

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
const economyView = () => ({ stakes: !!(ECON.stakes && vault), minStake: ECON.minStake, maxStake: ECON.maxStake, feePct: ECON.feePct, prizePoolShare: ECON.prizePoolShare, seasonHours: ECON.seasonHours, minWithdraw: ECON.minWithdraw, maxWithdrawPerDay: ECON.maxWithdrawPerDay, walletAuth: !!vault, mint: TOKEN_MINT, decimals: TOKEN_DECIMALS, tokenProgram: vault ? vault.tokenProgram : null, devFaucet: !IS_PROD && process.env.ARENA_DEV_FAUCET === '1' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let player = null;
  sendWs(ws, { t: 'stats', online: players.size, wilds: wilds.size, leaderboard: leaderboard(10), hallOfFame: hallOfFame(10), season: seasonView(null) });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'join') {
      if (player) return;
      if (players.size >= MAX_PLAYERS) return sendWs(ws, { t: 'error', msg: 'The arena is full. Try again soon.' });
      const starterDex = Dex.STARTERS.some(s => s.dex === Number(msg.starter)) ? Number(msg.starter) : Dex.STARTERS[0].dex;
      player = {
        id: uid(), ws, name: uniqueName(msg.name), color: sanitizeColor(msg.color),
        x: SPAWN.x + Math.floor(Math.random() * 6) - 3, y: SPAWN.y + Math.floor(Math.random() * 4) - 2, dir: 'down',
        party: [{ dex: starterDex, shiny: Math.random() < SHINY_CHANCE }], active: 0, coins: ECON.startingCoins, inventory: {},
        score: 0, catches: 0, wins: 0, losses: 0, lastMove: 0, lastChat: 0, battleId: null, encounter: null, pendingChallenge: null, accountId: null, sessionToken: null, authNonce: null
      };
      if (!walkable(player.x, player.y)) { player.x = SPAWN.x; player.y = SPAWN.y; }
      players.set(player.id, player);
      if (msg.token && ledger.sessions[msg.token] && ledger.sessions[msg.token].expires > now() && ledger.accounts[ledger.sessions[msg.token].id]) {
        const acc = ledger.accounts[ledger.sessions[msg.token].id];
        for (const other of players.values()) if (other !== player && other.accountId === acc.id) { other.accountId = null; other.sessionToken = null; send(other, { t: 'account', account: null }); }
        player.accountId = acc.id;
        if (acc.party && acc.party.length) { player.party = acc.party; player.active = Math.min(acc.active || 0, acc.party.length - 1); player.coins = acc.coins; player.inventory = acc.inventory || {}; player.score = acc.score; player.catches = acc.catches; player.wins = acc.wins; player.losses = acc.losses; }
        player.name = uniqueName(acc.name || player.name, player); acc.name = player.name;
        player.sessionToken = msg.token; watchDeposits(acc);
      }
      sendWs(ws, {
        t: 'welcome', id: player.id, you: publicPlayer(player), party: player.party, active: player.active, coins: player.coins, inventory: player.inventory,
        map: { w: MAP_W, h: MAP_H, tiles: map, seed: MAP_SEED }, players: [...players.values()].map(publicPlayer), wilds: [...wilds.values()],
        leaderboard: leaderboard(10), hallOfFame: hallOfFame(10), economy: economyView(), season: seasonView(player), account: player.accountId ? accountView(player) : null
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
      case 'throw': handleThrow(player, msg.quality, msg.ball); break;
      case 'run': endEncounter(player, 'ran'); break;
      case 'challenge': handleChallenge(player, String(msg.id || ''), msg.stake); break;
      case 'accept': handleAccept(player, String(msg.id || '')); break;
      case 'decline': handleDecline(player, String(msg.id || '')); break;
      case 'battle_move': chooseAction(player, { move: msg.index }); break;
      case 'battle_item': chooseAction(player, { item: String(msg.item || '') }); break;
      case 'forfeit': { const b = battles.get(player.battleId); if (b) endBattle(b, b.a.pid === player.id ? b.b.pid : b.a.pid, player.id, 'forfeit'); break; }
      case 'set_active': {
        if (player.battleId || player.encounter) return;
        const i = Number(msg.index);
        if (Number.isInteger(i) && i >= 0 && i < player.party.length) { player.active = i; syncAccount(player); send(player, { t: 'active_set', index: i }); broadcast({ t: 'player_update', player: publicPlayer(player) }); }
        break;
      }
      case 'buy_item': handleBuy(player, msg); break;
      case 'auth_nonce': player.authNonce = crypto.randomBytes(16).toString('hex'); send(player, { t: 'auth_challenge', nonce: player.authNonce, message: authMessage(player.authNonce) }); break;
      case 'auth': handleAuth(player, msg); break;
      case 'logout': handleLogout(player); break;
      case 'deposit_watch': { const acc = player.accountId && ledger.accounts[player.accountId]; if (acc) { watchDeposits(acc); pollDeposits(); } break; }
      case 'withdraw': handleWithdraw(player, msg); break;
      case 'dev_credit': {
        if (IS_PROD || process.env.ARENA_DEV_FAUCET !== '1') return;
        const acc = player.accountId && ledger.accounts[player.accountId];
        if (acc) { credit(acc, toBase(clamp(Number(msg.amount) || 0, 0, 1e9))); sendAccount(player); }
        break;
      }
      case 'ping': send(player, { t: 'pong', at: msg.at }); break;
      default: break;
    }
  });

  ws.on('close', () => {
    if (!player) return;
    const p = player; player = null;
    players.delete(p.id);
    if (p.encounter) clearTimeout(p.encounter.timer);
    const b = battles.get(p.battleId);
    if (b) endBattle(b, b.a.pid === p.id ? b.b.pid : b.a.pid, p.id, 'disconnect');
    syncAccount(p); recordHall(p);
    broadcast({ t: 'player_leave', id: p.id, name: p.name });
    broadcastAll({ t: 'stats', online: players.size, wilds: wilds.size });
    lbDirty = true;
  });
  ws.on('error', () => { /* handled by close */ });
});
setInterval(() => { for (const ws of wss.clients) { if (ws.isAlive === false) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch (e) { /* ignore */ } } }, 30000);

server.listen(PORT, () => {
  console.log(`\n  $POKEMON arena live →  http://localhost:${PORT}`);
  console.log(`  map ${MAP_W}x${MAP_H} · ${tallTiles.length} tall-grass tiles · ${wilds.size} wilds pre-spawned · mint ${TOKEN_MINT || '(none)'}`);
  if (vault) console.log(`  vault ${vault.vaultPubkey} (${vault.keySource}) · rpc ${vault.rpcUrl} · accounts ${Object.keys(ledger.accounts).length} · season #${ledger.season.number} pool ${toWhole(ledger.pool)}\n`);
  else console.log('  vault: disabled (no mint configured)\n');
});
