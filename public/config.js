/* ============================================================
   SITE CONFIG — edit this file, nothing else, to rebrand.
   Live numbers (price, mcap, holders, liquidity, volume, chart)
   are pulled automatically for `contract` — see /api/token.
   ============================================================ */
window.SITE_CONFIG = {
  name: 'POKÉMONC',
  ticker: '$POKEMON',
  tagline: 'The dev rugged. The community caught the ball.',
  chain: 'Solana',
  contract: 'EhCzWhMyUAo87bQ663fV2A6reLhXgdhdcf9ynJV8pump',

  // Links (leave empty string to hide a button)
  links: {
    buy: 'https://jup.ag/swap/SOL-EhCzWhMyUAo87bQ663fV2A6reLhXgdhdcf9ynJV8pump',
    chart: 'https://dexscreener.com/solana/4qg7fcgscjzpurfwf8snd93zu9yfqdqku67pmfuhaxag',
    pumpfun: 'https://pump.fun/coin/EhCzWhMyUAo87bQ663fV2A6reLhXgdhdcf9ynJV8pump',
    telegram: '',
    twitter: 'https://x.com/i/communities/1997051552910266854',
    dexscreener: 'https://dexscreener.com/solana/EhCzWhMyUAo87bQ663fV2A6reLhXgdhdcf9ynJV8pump',
    community: ''
  },

  // Background music (YouTube video id). Streams through the official YouTube player; toggle in the nav.
  music: { youtubeId: 'YMEblRM4pGc', title: 'Chill & Relaxing Pokémon Music Mix', volume: 35 },

  // Lore section. `tweetUrl` makes the screenshot clickable — paste the link to the post.
  lore: {
    image: 'assets/lore/pokemon-tweet.jpg',
    imageAlt: 'Post from the verified @Pokemon account introducing $POKEMON with the contract address',
    imageCaption: '@Pokemon · 27 Aug 2026 · the only contract address the account has ever posted',
    tweetUrl: '',
    // Short clip shown under the chapters (leave `src` empty to hide).
    video: {
      src: 'assets/lore/fee-burn-proof.mp4',
      title: 'Receipts',
      caption: 'pump.fun confirming the creator fees go to the incinerator.'
    },
    chapters: [
      {
        title: 'Posted by Pokémon itself',
        text: 'On 27 August 2026, during the Pokémon 30 celebration, the verified @Pokemon account posted a contract address for the first and only time. "Introducing $POKEMON," it read — and the address it published is the one at the top of this page.'
      },
      {
        title: 'The community took the wheel',
        text: 'The original deployer walked away. Holders refused to let it die: they reclaimed the socials, built this site and the arena, and run everything themselves. No team, no insider allocation, no dev wallet.'
      },
      {
        title: 'Trading feeds the fire',
        text: 'The creator wallet is the Solana incinerator. The creator fee from every trade is sent there, where no one can ever claim it — volume doesn\'t enrich a dev, it disappears. Minting is revoked, so supply only moves one way: <b id="lore-burned">4.7M</b> $POKEMON has already been burned — and 40% of every token spent in the arena\'s PokéStore is burned too, while the other 60% feeds the season prize pool.'
      }
    ]
  },

  // Arena economy: staking $POKEMON on battles, the season prize pool, deposits and withdrawals.
  // Amounts are in whole tokens. Server-side settings; the browser only uses them for display.
  // Chat + name moderation (see moderation.js): add words to block, or allow ones the community is fine with.
  moderation: { extra: [], extraStrong: [], allow: [] },
  economy: {
    storeBurnPct: 40,          // share of every PokéStore purchase that is burned on-chain; the rest (60%) goes straight into the season prize pool
    stakes: true,             // allow staked battles
    minStake: 1000,
    maxStake: 5000000,
    feePct: 4,                // % of every pot kept as fee
    prizePoolShare: 75,       // % of the fee that feeds the season prize pool (rest stays in the vault treasury)
    seasonHours: 24,          // prize pool pays the season's top 3 (50 / 30 / 20 %) every N hours
    minWithdraw: 1000,
    maxWithdrawPerDay: 2000000,
    // PokéStore prices in whole $POKEMON (defaults live in pokedex.js). Purchases are split: storeBurnPct% burned from the vault, the rest to the prize pool.
    itemPrices: { potion: 500, superpotion: 1200, hyperpotion: 2800, fullrestore: 5000, xattack: 1800, xdefend: 1800, greatball: 1000, ultraball: 2500 }
  },

  // Fallback numbers, only shown if the live feed is unreachable.
  stats: {
    marketCap: 171000,      // USD
    holders: 5199,
    liquidityUsd: 38784
  },

  tokenomics: {
    totalSupply: '1,000,000,000',
    buyTax: '0%',
    sellTax: '0%',
    liquidity: 'Locked (PumpSwap)',
    mintAuthority: 'Revoked',
    freezeAuthority: 'Revoked',
    // Donut chart slices (must sum to 100)
    distribution: [
      { label: 'Circulating (community)', pct: 88, color: '#ffcb05' },
      { label: 'Liquidity pool', pct: 12, color: '#3b4cca' }
    ]
  },

  // The CTO story, newest last.
  timeline: [
    { date: 'Launch', title: 'Born on pump.fun', text: '$POKEMON launches on the pump.fun bonding curve. Memes fly, the chart goes vertical.' },
    { date: 'Bonded', title: 'Graduated to PumpSwap', text: 'The curve fills and the token bonds. Liquidity moves to the PumpSwap AMM and is locked.' },
    { date: 'The rug', title: 'Dev walks', text: 'The original deployer bails and goes silent. Socials go dark. Holders are left holding the ball.' },
    { date: 'CTO', title: 'Community takeover', text: 'Holders refuse to let it die. A new X community forms, a CTO address is set, and the project is run by trainers, not a dev.' },
    { date: 'Now', title: 'Gotta Pump ’Em All', text: 'New site, live stats, and a multiplayer arena. Mint and freeze authorities are revoked on-chain — nobody can print or freeze your tokens.' }
  ],

  // Evolution roadmap — market cap milestones as evolution stages
  milestones: [
    { mcap: 100000,   label: 'Charmander', dex: 4,   perk: 'Takeover complete, socials reclaimed' },
    { mcap: 500000,   label: 'Charmeleon', dex: 5,   perk: 'DEX trending, first CEX listing' },
    { mcap: 1000000,  label: 'Charizard',  dex: 6,   perk: 'Arena tournaments with prizes' },
    { mcap: 5000000,  label: 'Mewtwo',     dex: 150, perk: 'Tier-1 CEX' }
  ],

  // "Gym leaders" — the community mods / core contributors
  team: [
    { name: 'Ash-ley', role: 'CTO lead', species: 'embercub', handle: '@replace_me' },
    { name: 'Brock-chain', role: 'Community mod', species: 'rockroll', handle: '@replace_me' },
    { name: 'Misty-fi', role: 'Raid captain', species: 'aquafin', handle: '@replace_me' },
    { name: 'Prof. Pump', role: 'Dev (volunteer)', species: 'voltmouse', handle: '@replace_me' }
  ],

  // How-to-buy steps — customise for your chain
  howToBuy: [
    { title: 'Get a wallet', text: 'Install Phantom or Solflare, back up your seed phrase somewhere safe (not in Telegram).' },
    { title: 'Load up on SOL', text: 'Buy SOL on any exchange and send it to your wallet address.' },
    { title: 'Swap for $POKEMON', text: 'Hit the Buy button (Jupiter) or paste the contract address above into Jupiter / pump.fun. Set slippage 2–5% — it moves fast.' },
    { title: 'Join the arena', text: 'Join the X community, then scroll down and play the multiplayer arena with the rest of the holders.' }
  ],

  // Marquee messages
  marquee: [
    'COMMUNITY TAKEOVER', 'LP LOCKED', 'MINT REVOKED', 'FREEZE REVOKED', 'NO DEV — ONLY TRAINERS',
    'MULTIPLAYER ARENA LIVE', 'GOTTA PUMP ’EM ALL', 'DIAMOND HANDS EVOLVE'
  ]
};
