# POKÉCTO — Community Takeover site + multiplayer arena

A Pokémon-inspired memecoin landing page for a CTO'd (community take over) token, with a
built-in **real-time multiplayer mini-game** ("CTO Arena") where everyone on the page shares
one world: walk around, catch wild mons in tall grass, and battle other trainers.

Everything is original pixel art defined as data (`public/sprites.js`) — no ripped Nintendo assets.

## Run it

```bash
npm install
npm start          # http://localhost:3000
```

`PORT=8080 npm start` to change the port. `npm run dev` restarts on file changes.

Open the URL in two browser tabs (or two devices) to see multiplayer working.

## Rebrand it

Edit **`public/config.js`** only:

| Key | What it drives |
| --- | --- |
| `name`, `ticker`, `tagline`, `chain` | Every place the brand appears |
| `contract` | The CA box + copy button |
| `links.*` | Buy / chart / socials buttons (empty string hides one) |
| `stats.marketCap`, `holders` | Hero counters and the evolution-roadmap progress bar |
| `tokenomics` | Donut chart + stat cards |
| `timeline` | The CTO story |
| `milestones` | Evolution-chain roadmap (market-cap targets) |
| `team`, `howToBuy`, `marquee` | Gym leaders, buy steps, scrolling ticker |

Colours live at the top of `public/style.css` (`--red`, `--yellow`, `--blue`, …).

## The game

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | WASD / arrows | On-screen D-pad |
| Chat | Enter, type, Enter | Tap the chat box |
| Challenge nearby trainer / throw ball / accept challenge | Space or E | ⚔ button |

- **Wild mons** spawn in tall grass. Step on one to start an encounter. Stop the moving cursor
  in the green zone (gold = perfect) for the best catch odds. Three balls per encounter.
- **Battles** are turn-based with a type chart (fire > grass > water > fire, electric > water,
  rock > fire, etc.). Both players pick a move; the server resolves speed, accuracy, crits and
  STAB. Winner +25 pts, loser +5.
- **Levels** rise with catches and wins and boost HP/damage. Switch your active mon in the
  Party panel.
- **Leaderboard** is live; **Hall of Fame** persists to `data/hall-of-fame.json`.
- Moonwhale is legendary (1 in ~39 spawns, 15% base catch rate, 100 pts).

All game logic is authoritative on the server (`server.js`): movement, encounters, catch rolls,
damage, rate limits and input sanitising. Clients only send intents.

## Deploy

It's a single Node process serving static files + WebSockets, so any Node host works
(Railway, Render, Fly.io, a VPS behind nginx/Caddy with WebSocket proxying). Put it behind
HTTPS and the client automatically switches to `wss://`.

## Files

```
server.js            HTTP static server + WebSocket game server
public/index.html    Landing page + arena markup
public/style.css     Styles (Pokédex red/yellow/blue theme, responsive)
public/config.js     ← edit this to rebrand
public/sprites.js    Creature data: pixel art, types, moves, type chart (shared client/server)
public/main.js       Landing interactivity: hero ball, confetti, chart, roadmap, quiz, cries
public/game.js       Game client: rendering, input, catch minigame, battle UI, chat
data/                Hall-of-fame persistence (auto-created)
```

## Disclaimer

Fan-made. Not affiliated with, endorsed by, or connected to Nintendo, Game Freak, Creatures Inc.
or The Pokémon Company. Memecoins are extremely risky.
