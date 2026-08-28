/* ============================================================
   Browser wallet helper: Phantom / Solflare connect, message
   signing for sign-in, and one-click $POKEMON deposits
   (Token-2022 TransferChecked built by hand; the wallet signs).
   The Solana library is only downloaded when a deposit is made.
   ============================================================ */
window.ArenaWallet = (function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.98.4/lib/index.iife.min.js';
  const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function b58encode(bytes) {
    const digits = [0];
    for (const b of bytes) {
      let carry = b;
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '';
    for (const b of bytes) { if (b === 0) out += '1'; else break; }
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
    const cands = [window.phantom && window.phantom.solana, window.solflare, window.solana];
    for (const c of cands) if (c && typeof c.connect === 'function') return c;
    return null;
  }
  const available = () => !!getProvider();
  const providerName = () => { const p = getProvider(); return !p ? null : p.isPhantom ? 'Phantom' : p.isSolflare ? 'Solflare' : 'Wallet'; };

  async function connect() {
    const p = getProvider();
    if (!p) throw new Error('No Solana wallet found. Install Phantom or Solflare, or use a smart wallet account.');
    const r = await p.connect();
    const pk = (r && r.publicKey) || p.publicKey;
    if (!pk) throw new Error('Wallet did not return a public key.');
    return { provider: p, pubkey: pk.toString() };
  }

  async function signMessage(provider, message) {
    const enc = new TextEncoder().encode(message);
    const r = await provider.signMessage(enc, 'utf8');
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
    const res = await provider.signAndSendTransaction(tx);
    return typeof res === 'string' ? res : res.signature;
  }

  return { available, providerName, connect, signMessage, deposit, loadLib };
})();
