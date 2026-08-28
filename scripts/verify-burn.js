#!/usr/bin/env node
/*
  Independently verify that a PokéStore burn really destroyed tokens on Solana.

    node scripts/verify-burn.js <signature>                 # one transaction
    node scripts/verify-burn.js --site https://www.pokemoncto.com   # every burn the site reports

  No dependencies: talks JSON-RPC directly (SOLANA_RPC env var optional, defaults to the public mainnet endpoint).
  For each signature it prints the burn instruction the chain recorded (program, mint, amount, authority) and the
  token-balance change of the vault account, then checks it against the site's own ledger when --site is given.
*/
'use strict';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const DEFAULT_MINT = 'EhCzWhMyUAo87bQ663fV2A6reLhXgdhdcf9ynJV8pump';

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const ui = (base, dec) => (Number(base) / 10 ** dec).toLocaleString('en-US', { maximumFractionDigits: dec });

async function verify(signature, expect) {
  const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  if (!tx) return { ok: false, why: 'transaction not found (wrong signature or not confirmed yet)' };
  if (tx.meta.err) return { ok: false, why: 'transaction FAILED on-chain: ' + JSON.stringify(tx.meta.err) };
  const ixs = [].concat(tx.transaction.message.instructions, ...(tx.meta.innerInstructions || []).map(i => i.instructions));
  const burns = ixs.filter(ix => ix.parsed && /^burn(Checked)?$/.test(ix.parsed.type)).map(ix => ({
    program: ix.programId, type: ix.parsed.type, mint: ix.parsed.info.mint, account: ix.parsed.info.account, authority: ix.parsed.info.authority,
    amount: ix.parsed.info.tokenAmount ? ix.parsed.info.tokenAmount.amount : ix.parsed.info.amount, decimals: ix.parsed.info.tokenAmount ? ix.parsed.info.tokenAmount.decimals : null
  }));
  if (!burns.length) return { ok: false, why: 'no Burn / BurnChecked instruction in this transaction' };
  const keys = tx.transaction.message.accountKeys.map(k => k.pubkey);
  const deltas = (tx.meta.postTokenBalances || []).map(post => {
    const pre = (tx.meta.preTokenBalances || []).find(p => p.accountIndex === post.accountIndex);
    return { account: keys[post.accountIndex], mint: post.mint, delta: BigInt(post.uiTokenAmount.amount) - BigInt(pre ? pre.uiTokenAmount.amount : '0'), decimals: post.uiTokenAmount.decimals };
  }).filter(d => d.delta !== 0n);
  const b = burns[0];
  const checks = [
    ['burn instruction present', true],
    ['program is Token-2022', b.program === TOKEN_2022],
    ['mint is $POKEMON', b.mint === (expect.mint || DEFAULT_MINT)],
    ['tokens left the vault account', deltas.some(d => d.account === b.account && d.delta < 0n)],
    ['no account received them', !deltas.some(d => d.delta > 0n)]
  ];
  if (expect.vault) checks.push(['burn authority is the site vault', b.authority === expect.vault]);
  if (expect.amount != null) checks.push(['amount matches the site ledger', Number(b.amount) === Math.round(expect.amount * 10 ** (b.decimals || 6))]);
  return { ok: checks.every(c => c[1]), checks, burn: b, deltas, slot: tx.slot, time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null };
}

(async () => {
  const args = process.argv.slice(2);
  const siteIdx = args.indexOf('--site');
  let targets = [], expect = {};
  if (siteIdx >= 0) {
    const site = args[siteIdx + 1].replace(/\/$/, '');
    const log = await (await fetch(site + '/api/burns')).json();
    expect = { mint: log.mint, vault: log.vault };
    console.log(`${site}: ${log.count} burns recorded, ${log.totalBurned} burned, ${log.pendingBurn} queued · vault ${log.vault}\n`);
    targets = log.burns.map(b => ({ signature: b.signature, amount: b.amount }));
  } else {
    targets = args.filter(a => !a.startsWith('--')).map(signature => ({ signature }));
  }
  if (!targets.length) { console.log('usage: node scripts/verify-burn.js <signature> | --site <url>'); process.exit(1); }
  const supply = await rpc('getTokenSupply', [expect.mint || DEFAULT_MINT]);
  console.log(`current $POKEMON supply: ${supply.value.uiAmountString}\n`);
  let bad = 0;
  for (const t of targets) {
    let r;
    try { r = await verify(t.signature, Object.assign({}, expect, { amount: t.amount })); } catch (e) { r = { ok: false, why: e.message }; }
    console.log(`${r.ok ? 'VERIFIED' : 'NOT VERIFIED'}  ${t.signature}`);
    if (r.why) console.log('   ' + r.why);
    if (r.burn) console.log(`   ${r.time} · slot ${r.slot} · ${r.burn.type} of ${ui(r.burn.amount, r.burn.decimals || 6)} from ${r.burn.account} by ${r.burn.authority}`);
    if (r.checks) for (const [name, pass] of r.checks) console.log(`   ${pass ? '✓' : '✗'} ${name}`);
    console.log(`   https://solscan.io/tx/${t.signature}`);
    if (!r.ok) bad++;
  }
  console.log(`\n${targets.length - bad}/${targets.length} burns verified on-chain`);
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(2); });
