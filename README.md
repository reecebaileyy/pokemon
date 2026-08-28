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
