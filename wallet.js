/* ============================================================
   Solana vault for the arena economy.
   - Vault keypair (env VAULT_SECRET_KEY, or generated once into data/vault.json)
   - Per-account deposit addresses derived from the vault secret
   - Deposit detection (token balance deltas on the deposit ATAs)
   - Sweeps deposits into the vault, pays withdrawals from it
   - Wallet sign-in verification (ed25519 message signatures)
   No external SPL library: the two token instructions we need are encoded by hand.
   ============================================================ */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');

const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const TOKEN_LEGACY = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const decodeBs58 = s => (bs58.decode ? bs58.decode(s) : bs58.default.decode(s));
const encodeBs58 = b => (bs58.encode ? bs58.encode(b) : bs58.default.encode(b));

function loadOrCreateVault(dataDir, envSecret) {
  if (envSecret) {
    const raw = envSecret.trim();
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : decodeBs58(raw);
    return { keypair: Keypair.fromSecretKey(bytes), source: 'env' };
  }
  const file = path.join(dataDir, 'vault.json');
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { keypair: Keypair.fromSecretKey(Uint8Array.from(j.secretKey)), source: file };
  }
  const kp = Keypair.generate();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ publicKey: kp.publicKey.toBase58(), secretKey: Array.from(kp.secretKey) }), { mode: 0o600 });
  return { keypair: kp, source: file, generated: true };
}

function ata(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];
}

function ixCreateAtaIdempotent(payer, ataAddress, owner, mint, tokenProgram) {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ataAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false }
    ],
    data: Buffer.from([1])
  });
}

function ixTransferChecked(source, mint, dest, owner, amount, decimals, tokenProgram) {
  const data = Buffer.alloc(10);
  data[0] = 12; // TransferChecked
  data.writeBigUInt64LE(BigInt(amount), 1);
  data[9] = decimals;
  return new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false }
    ],
    data
  });
}

function create(opts) {
  const rpcUrl = opts.rpcUrl || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const mint = new PublicKey(opts.mint);
  const decimals = opts.decimals;
  const tokenProgram = opts.tokenProgram === 'legacy' ? TOKEN_LEGACY : TOKEN_2022;
  const { keypair: vault, source, generated } = loadOrCreateVault(opts.dataDir, opts.secret);
  const vaultAta = ata(vault.publicKey, mint, tokenProgram);
  const secretHex = Buffer.from(vault.secretKey).toString('hex');
  const depositCache = new Map();

  function depositKeypair(index) {
    if (!depositCache.has(index)) {
      const seed = crypto.createHash('sha256').update(`arena-deposit|${index}|${secretHex}`).digest();
      depositCache.set(index, Keypair.fromSeed(seed));
    }
    return depositCache.get(index);
  }
  const depositAddress = index => depositKeypair(index).publicKey.toBase58();
  const depositAta = index => ata(depositKeypair(index).publicKey, mint, tokenProgram);

  function verifyWalletSignature(pubkey, message, signature) {
    try {
      const pk = new PublicKey(pubkey).toBytes();
      const sig = decodeBs58(signature);
      return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
    } catch (e) { return false; }
  }

  /** Token balance change of `ataAddress` in a parsed transaction (base units, may be 0). */
  function deltaFor(tx, ataAddress) {
    if (!tx || !tx.meta || tx.meta.err) return { delta: 0n, from: null };
    const keys = tx.transaction.message.accountKeys.map(k => (k.pubkey ? k.pubkey.toBase58() : String(k)));
    const idx = keys.indexOf(ataAddress);
    if (idx < 0) return { delta: 0n, from: null };
    const bal = list => (list || []).find(b => b.accountIndex === idx && b.mint === mint.toBase58());
    const pre = bal(tx.meta.preTokenBalances), post = bal(tx.meta.postTokenBalances);
    const delta = BigInt(post ? post.uiTokenAmount.amount : '0') - BigInt(pre ? pre.uiTokenAmount.amount : '0');
    let from = null;
    const all = [].concat(tx.transaction.message.instructions || [], ...((tx.meta.innerInstructions || []).map(i => i.instructions)));
    for (const ix of all) {
      const p = ix.parsed;
      if (p && (p.type === 'transfer' || p.type === 'transferChecked') && p.info && p.info.destination === ataAddress) from = p.info.authority || p.info.multisigAuthority || null;
    }
    return { delta, from };
  }

  /** Check a list of deposit accounts for new confirmed inbound transfers. */
  async function fetchDeposits(targets, isProcessed) {
    const found = [];
    for (const t of targets) {
      let sigs;
      try { sigs = await connection.getSignaturesForAddress(t.ata, { limit: 20 }, 'confirmed'); } catch (e) { continue; }
      for (const s of sigs) {
        if (s.err || isProcessed(s.signature)) continue;
        let tx;
        try { tx = await connection.getParsedTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); } catch (e) { continue; }
        const { delta, from } = deltaFor(tx, t.ata.toBase58());
        found.push({ index: t.index, signature: s.signature, amount: delta > 0n ? delta : 0n, from, blockTime: s.blockTime });
      }
    }
    return found;
  }

  async function tokenBalance(ataAddress) {
    try { const r = await connection.getTokenAccountBalance(ataAddress, 'confirmed'); return BigInt(r.value.amount); } catch (e) { return 0n; }
  }

  async function sendTx(ixs, signers) {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = vault.publicKey;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }

  /** Move everything in a deposit account into the vault (vault pays the fee). */
  async function sweep(index) {
    const kp = depositKeypair(index);
    const src = depositAta(index);
    const amount = await tokenBalance(src);
    if (amount <= 0n) return null;
    const ixs = [ixCreateAtaIdempotent(vault.publicKey, vaultAta, vault.publicKey, mint, tokenProgram), ixTransferChecked(src, mint, vaultAta, kp.publicKey, amount, decimals, tokenProgram)];
    return sendTx(ixs, [vault, kp]);
  }

  /** Pay `amount` (base units) from the vault to an arbitrary wallet. */
  async function withdraw(toPubkey, amount) {
    const to = new PublicKey(toPubkey);
    const dest = ata(to, mint, tokenProgram);
    const ixs = [ixCreateAtaIdempotent(vault.publicKey, dest, to, mint, tokenProgram), ixTransferChecked(vaultAta, mint, dest, vault.publicKey, amount, decimals, tokenProgram)];
    return sendTx(ixs, [vault]);
  }

  async function status() {
    let sol = null, tokens = null;
    try { sol = (await connection.getBalance(vault.publicKey, 'confirmed')) / 1e9; } catch (e) { /* ignore */ }
    tokens = await tokenBalance(vaultAta);
    return { vault: vault.publicKey.toBase58(), vaultAta: vaultAta.toBase58(), sol, tokens: tokens.toString(), rpc: rpcUrl, keySource: source };
  }

  return {
    vaultPubkey: vault.publicKey.toBase58(), vaultAta: vaultAta.toBase58(), generated, keySource: source, rpcUrl,
    mint: mint.toBase58(), decimals, tokenProgram: tokenProgram.toBase58(),
    depositAddress, depositAta, verifyWalletSignature, fetchDeposits, sweep, withdraw, status, tokenBalance,
    isValidPubkey: s => { try { return PublicKey.isOnCurve(new PublicKey(s).toBytes()); } catch (e) { return false; } },
    encodeBs58
  };
}

module.exports = { create };
