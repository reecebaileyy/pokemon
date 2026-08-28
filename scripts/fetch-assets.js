/* Downloads the sprites, animated battle sprites, artwork and cries for every
   roster Pokémon from PokeAPI into public/assets/pokemon. Run once: `npm run assets`.
   Skips files that already exist. */
'use strict';
const fs = require('fs');
const path = require('path');
const Dex = require('../public/pokedex.js');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'pokemon');
const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const CRY = 'https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest';
const ART_FOR = new Set([1, 4, 7, 25, 3, 6, 9, 26, 5, 133, 150, 151, 149, 143, 94, 130, 129]);

const jobs = [];
for (const p of Dex.ROSTER) {
  const d = p.dex;
  jobs.push([`${SPR}/${d}.png`, `${d}.png`]);
  jobs.push([`${SPR}/back/${d}.png`, `back/${d}.png`]);
  jobs.push([`${SPR}/shiny/${d}.png`, `shiny/${d}.png`]);
  jobs.push([`${SPR}/versions/generation-v/black-white/animated/${d}.gif`, `anim/${d}.gif`]);
  jobs.push([`${SPR}/versions/generation-v/black-white/animated/back/${d}.gif`, `anim/back/${d}.gif`]);
  jobs.push([`${CRY}/${d}.ogg`, `cries/${d}.ogg`]);
  if (ART_FOR.has(d)) jobs.push([`${SPR}/other/official-artwork/${d}.png`, `art/${d}.png`]);
}

async function run() {
  let done = 0, skipped = 0, failed = 0;
  const queue = jobs.slice();
  async function worker() {
    while (queue.length) {
      const [url, rel] = queue.shift();
      const dest = path.join(OUT, rel);
      if (fs.existsSync(dest)) { skipped++; continue; }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        done++;
      } catch (e) { failed++; console.error('FAILED', rel, e.message); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`assets: ${done} downloaded, ${skipped} already present, ${failed} failed → ${OUT}`);
  if (failed) process.exitCode = 1;
}
run();
