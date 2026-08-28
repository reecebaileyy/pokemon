# $POKEMON — community takeover site + multiplayer arena

Landing page for the `$POKEMON` community-takeover token on Solana, with **live on-chain metrics**,
a **native candlestick chart**, and a **real-time multiplayer Gen-1 Pokémon arena** that every visitor
shares (catch, battle, evolve).

## Run

```bash
npm install
npm start          # http://localhost:3000
```

`PORT=8080 npm start` changes the port. `npm run dev` restarts on file changes.
Open two browser tabs to see multiplayer.

## Live data

The server aggregates four free sources for the mint in `public/config.js` and caches them
(30 s metrics, 60 s candles) so visitors never hit third-party rate limits:

| Endpoint | Source | Gives |
| --- | --- | --- |
| `/api/token` | DexScreener | price, market cap, liquidity, volume, 24h change, buys/sells, pair, logo |
| | RugCheck | holder count, LP locked %, risk score, top-10 concentration |
| | pump.fun | launch time, bonded status, creator/CTO address |
| | Solana RPC | supply, mint authority, freeze authority (on-chain truth) |
| `/api/chart?tf=5m\|15m\|1h\|4h` | GeckoTerminal | OHLCV candles for the deepest pair |
| `/api/stats` | arena | players online, leaderboard, hall of fame |

Env: `TOKEN_MINT` overrides the config mint; `SOLANA_RPC` swaps the RPC (use Helius/QuickNode if the
public RPC rate-limits you).

## Rebrand

Edit **`public/config.js`**: name, ticker, contract, links (buy/chart/X/Telegram/pump.fun), fallback
stats, timeline copy, evolution milestones (`dex` numbers + market-cap targets). Colours are the
CSS variables at the top of `public/style.css`.

## Arena

Player-facing instructions live on the site itself: the **How to play** button in the Arena header (and on the
starter screen) opens a guide covering moving, catching, battling, items, evolution, accounts, staking, the prize
pool and deposits/withdrawals, with the live economy limits filled in from `config.js`.

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | WASD / arrows | D-pad |
| Throw ball / accept challenge / battle nearest trainer | Space or E | ● button |
| Chat | Enter, type, Enter | tap the box |

- Starters: Bulbasaur, Charmander, Squirtle, Pikachu. 19 wild Gen-1 species spawn in tall grass
  (rarity-weighted; Mewtwo/Mew legendary, 1/32 shiny for triple points).
- Catching is a timing minigame (three balls, faster each miss). Party holds six.
- Battles are turn-based with the full 18-type chart, STAB, crits, priority moves, immunities.
  Winner +25 pts, loser +5. 25 s turn timer, forfeit and disconnect handled.
- Level = 1 + catches/2 + wins/2. Starters, Magikarp and Eevee **evolve** at level thresholds
  (Charmander → Charmeleon → Charizard, Eevee → random Eeveelution).
- Leaderboard is live; hall of fame persists to `data/hall-of-fame.json`.
- All game logic is server-authoritative (`server.js`): clients only send intents.

Sprites, animated battle sprites, artwork and cries are bundled in `public/assets/pokemon`
(fetched once from PokeAPI with `npm run assets`).

## Economy: accounts, staking, prize pool

Everything below is server-authoritative (`server.js` + `wallet.js`), persisted to `data/ledger.json`
(put `data/` on a persistent disk), and configured in `public/config.js → economy`.

- **Accounts** — two kinds, both with saved party/bag/points/balance and a session token for silent resume:
  - *Wallet*: Phantom/Solflare signs a nonce message (`Sign in to $POKEMON Arena`). No transaction, no fee.
  - *Smart wallet*: username + passphrase (scrypt-hashed) — an account that lives inside the arena, for players
    without a browser wallet.
- **Deposits** — every account gets its own deposit address derived from the vault key. Send $POKEMON there from any
  wallet or exchange (or use "Deposit from wallet", which builds the Token-2022 transfer for Phantom to sign).
  The server polls the deposit accounts of active players, credits confirmed transfers, then sweeps them into the vault.
- **Withdrawals** — paid from the vault to any Solana address; `minWithdraw` / `maxWithdrawPerDay` apply.
  The vault needs a little SOL for fees and ATA rent (~0.003 SOL per new recipient).
- **Staked battles** — set a stake when challenging; both stakes are escrowed at battle start; the winner gets the pot
  minus `feePct`. Forfeit or disconnect loses the stake. Stakes need both players signed in.
- **Season prize pool** — `prizePoolShare`% of every fee accumulates in a pool; every `seasonHours` the pool pays the
  season's top 3 by points (50/30/20 %) and points reset. The remainder of the fee stays in the vault as treasury.
- **Items** — potions / X Attack / X Defend are battle turns, Great/Ultra Balls change catch odds. Bought with
  PokéCoins earned by catching and winning, so guests get the whole game too.

**Env vars**: `VAULT_SECRET_KEY` (base58 or JSON array; if unset a keypair is generated into `data/vault.json` — back it
up), `SOLANA_RPC` (use Helius/QuickNode in production), `TOKEN_MINT` / `TOKEN_DECIMALS` (default from config, 6),
`ADMIN_KEY` (enables `GET /api/admin/vault?key=…`), `ARENA_DEV_FAUCET=1` (non-production only: `dev_credit` message
adds balance for testing).

**Operator notes**: the vault is a hot wallet — keep only what withdrawals need and sweep the rest to cold storage;
`/api/admin/vault` shows liabilities (sum of balances) vs vault holdings. Token staking on a game with chance is
regulated as gambling in many places; that is a business/legal decision, not a technical one.

## Deploy

Single Node process serving static files + WebSockets. `render.yaml` is included — one click at
https://render.com/deploy?repo=https://github.com/reecebaileyy/pokemon — or use the `Dockerfile`
on Railway / Fly / any VPS. The client switches to `wss://` automatically behind HTTPS.
Render's free tier sleeps after 15 min idle; upgrade to Starter for always-on.

## Files

```
server.js              static server · metrics/chart API · WebSocket game server
public/index.html      page
public/style.css       styles
public/main.js         metrics, candlestick chart, proof tiles, roadmap, links
public/game.js         arena client (canvas overworld, catch, battle, evolution, chat)
public/pokedex.js      Gen-1 roster, moves, type chart, asset paths (shared with server)
public/sprites.js      pixel trainer + Poké Ball for the overworld
public/config.js       ← edit to rebrand
public/assets/pokemon  sprites · anim · shiny · art · cries
scripts/fetch-assets.js
```

## Disclaimer

Fan project. Not affiliated with Nintendo, Game Freak, Creatures Inc. or The Pokémon Company;
Pokémon names and sprites are their property. Memecoins are extremely risky.
