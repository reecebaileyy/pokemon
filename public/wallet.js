/* ============================================================
   Browser wallet helper: Phantom / Solflare / any injected
   Solana wallet. Connect, message signing for sign-in, and
   one-click $POKEMON deposits (Token-2022 TransferChecked built
   by hand; the wallet signs). On phones, wallets only exist inside
   their own in-app browser, so we offer deep links into them.
   The Solana library is only downloaded when a deposit is made.
   ============================================================ */
window.ArenaWallet = (function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/lib/index.iife.min.js';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function b58encode(bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    const digits = [];
    for (let i = zeros; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  let libPromise = null;
  function loadLib() {
    if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3);
    if (!libPromise) libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN; s.async = true;
      s.onload = () => resolve(window.solanaWeb3);
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the Solana library.')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function getProvider() {
    const cands = [window.phantom && window.phantom.solana, window.solflare, window.backpack, window.solana];
    for (const c of cands) if (c && typeof c.connect === 'function' && typeof c.signMessage === 'function') return c;
    return null;
  }
  /** Wallets inject asynchronously; give them a moment before deciding none is installed. */
  async function waitForProvider(ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 800)) { const p = getProvider(); if (p) return p; await new Promise(r => setTimeout(r, 100)); }
    return getProvider();
  }
  const available = () => !!getProvider();
  const providerName = () => { const p = getProvider(); return !p ? null : p.isPhantom ? 'Phantom' : p.isSolflare ? 'Solflare' : p.isBackpack ? 'Backpack' : 'Wallet'; };
  const isMobile = () => /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  /** Deep links that reopen this page inside a wallet's in-app browser (where the wallet is injected). */
  function deepLinks() {
    const url = encodeURIComponent(location.href.split('#')[0]);
    const ref = encodeURIComponent(location.origin);
    return [
      { name: 'Phantom', href: `https://phantom.app/ul/browse/${url}?ref=${ref}` },
      { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` }
    ];
  }

  async function connect() {
    const p = await waitForProvider(800);
    if (!p) {
      const err = new Error(isMobile()
        ? 'No wallet is injected in this browser. Open the site inside your wallet app (buttons below), or use a smart wallet account.'
        : 'No Solana wallet found. Install Phantom or Solflare, refresh, or use a smart wallet account.');
      err.code = 'NO_WALLET';
      throw err;
    }
    let r;
    try { r = await p.connect(); }
    catch (e) { const err = new Error(/reject|denied|cancel/i.test(String(e && e.message)) ? 'Connection request was rejected in the wallet.' : 'Wallet connection failed: ' + (e && e.message || e)); err.code = 'CONNECT'; throw err; }
    const pk = (r && r.publicKey) || p.publicKey;
    if (!pk) throw new Error('Wallet did not return a public key.');
    return { provider: p, pubkey: pk.toString() };
  }

  async function signMessage(provider, message) {
    const enc = new TextEncoder().encode(message);
    let r;
    try { r = await provider.signMessage(enc, 'utf8'); }
    catch (e) { const err = new Error(/reject|denied|cancel/i.test(String(e && e.message)) ? 'Signature was rejected in the wallet.' : 'Signing failed: ' + (e && e.message || e)); err.code = 'SIGN'; throw err; }
    const sig = r && r.signature ? r.signature : r;
    return b58encode(sig instanceof Uint8Array ? sig : new Uint8Array(sig));
  }

  /** Build + sign + send a TransferChecked of `amount` whole tokens to `to` (owner address). */
  async function deposit({ provider, pubkey, to, amount, mint, decimals, tokenProgram }) {
    const w = await loadLib();
    const { PublicKey, Transaction, TransactionInstruction, SystemProgram } = w;
    const TOKEN = new PublicKey(tokenProgram), ATA = new PublicKey(ATA_PROGRAM);
    const mintPk = new PublicKey(mint), owner = new PublicKey(pubkey), dest = new PublicKey(to);
    const ata = o => PublicKey.findProgramAddressSync([o.toBuffer(), TOKEN.toBuffer(), mintPk.toBuffer()], ATA)[0];
    const src = ata(owner), dst = ata(dest);
    const base = BigInt(Math.floor(amount)) * (10n ** BigInt(decimals));
    const data = new Uint8Array(10); data[0] = 12; new DataView(data.buffer).setBigUint64(1, base, true); data[9] = decimals;
    const ixCreate = new TransactionInstruction({ programId: ATA, keys: [
      { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: dest, isSigner: false, isWritable: false },
      { pubkey: mintPk, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN, isSigner: false, isWritable: false }
    ], data: new Uint8Array([1]) });
    const ixTransfer = new TransactionInstruction({ programId: TOKEN, keys: [
      { pubkey: src, isSigner: false, isWritable: true }, { pubkey: mintPk, isSigner: false, isWritable: false }, { pubkey: dst, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }
    ], data });
    const bh = await fetch('/api/blockhash', { cache: 'no-store' }).then(r => r.json());
    if (!bh.blockhash) throw new Error('Could not fetch a recent blockhash.');
    const tx = new Transaction().add(ixCreate, ixTransfer);
    tx.feePayer = owner; tx.recentBlockhash = bh.blockhash;
    let res;
    try { res = await provider.signAndSendTransaction(tx); }
    catch (e) { throw new Error(/reject|denied|cancel/i.test(String(e && e.message)) ? 'Transaction was rejected in the wallet.' : 'Transaction failed: ' + (e && e.message || e)); }
    return typeof res === 'string' ? res : res.signature;
  }

  return { available, providerName, isMobile, deepLinks, connect, signMessage, deposit, loadLib, waitForProvider };
})();
