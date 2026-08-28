/* ============================================================
   SITE CONFIG — edit this file, nothing else, to rebrand.
   ============================================================ */
window.SITE_CONFIG = {
  name: 'POKÉCTO',
  ticker: '$PKCTO',
  tagline: 'The dev rugged. The community caught the ball.',
  chain: 'Solana',
  contract: 'REPLACE_WITH_YOUR_CONTRACT_ADDRESS',

  // Links (leave empty string to hide a button)
  links: {
    buy: 'https://jup.ag/',
    chart: 'https://dexscreener.com/',
    telegram: 'https://t.me/',
    twitter: 'https://x.com/',
    dexscreener: 'https://dexscreener.com/',
    community: ''
  },

  // Live-ish numbers shown in the hero / roadmap. Update by hand or wire an API later.
  stats: {
    marketCap: 185000,      // USD
    holders: 2140,
    liquidityUsd: 62000
  },

  tokenomics: {
    totalSupply: '1,000,000,000',
    buyTax: '0%',
    sellTax: '0%',
    liquidity: 'Burned 🔥',
    mintAuthority: 'Revoked',
    freezeAuthority: 'Revoked',
    // Donut chart slices (must sum to 100)
    distribution: [
      { label: 'Circulating (community)', pct: 88, color: '#ffcb05' },
      { label: 'CTO treasury (multisig)', pct: 6, color: '#3b4cca' },
      { label: 'Marketing / raids', pct: 4, color: '#e3350d' },
      { label: 'Burned', pct: 2, color: '#4b5563' }
    ]
  },

  // The CTO story, newest last.
  timeline: [
    { date: 'Day 0', title: 'Launch', text: 'A Pokémon-themed memecoin launches. Hype, memes, and a suspiciously quiet dev.' },
    { date: 'Day 3', title: 'The Rug', text: 'Dev dumps and vanishes. Socials go dark. Chart nukes. Classic.' },
    { date: 'Day 4', title: 'Community Takeover', text: 'Holders refuse to let it die. A multisig is formed, socials are reclaimed, and a new Telegram is born.' },
    { date: 'Day 7', title: 'LP Burned, Authorities Revoked', text: 'The community proves the contract is safe: no mint, no freeze, LP gone forever.' },
    { date: 'Now', title: 'Gotta Pump ’Em All', text: 'New site, new game, new energy. This is a community project — no dev, just trainers.' }
  ],

  // Evolution roadmap — market cap milestones as evolution stages
  milestones: [
    { mcap: 100000,   label: 'Hatchling',  species: 'leafling',  perk: 'CTO complete · socials reclaimed' },
    { mcap: 500000,   label: 'Evolved',    species: 'voltmouse', perk: 'CEX listings · DEX trending pushes' },
    { mcap: 1000000,  label: 'Champion',   species: 'embercub',  perk: 'Merch drop · Arena tournaments with prizes' },
    { mcap: 5000000,  label: 'Legendary',  species: 'moonwhale', perk: 'Tier-1 CEX · the whale surfaces' }
  ],

  // "Gym leaders" — the community mods / core contributors
  team: [
    { name: 'Ash-ley', role: 'Multisig signer', species: 'embercub', handle: '@replace_me' },
    { name: 'Brock-chain', role: 'Community lead', species: 'rockroll', handle: '@replace_me' },
    { name: 'Misty-fi', role: 'Raid captain', species: 'aquafin', handle: '@replace_me' },
    { name: 'Prof. Pump', role: 'Dev (volunteer)', species: 'voltmouse', handle: '@replace_me' }
  ],

  // How-to-buy steps — customise for your chain
  howToBuy: [
    { title: 'Get a wallet', text: 'Install Phantom or Solflare, back up your seed phrase somewhere safe (not in Telegram).' },
    { title: 'Load up on SOL', text: 'Buy SOL on any exchange and send it to your wallet address.' },
    { title: 'Swap for the token', text: 'Open Jupiter or Raydium, paste the contract address above, and swap. Set slippage 1–3%.' },
    { title: 'Join the arena', text: 'Hop in Telegram, then scroll down and play the multiplayer arena with the rest of the community.' }
  ],

  // Marquee messages
  marquee: [
    'COMMUNITY TAKEOVER', 'LP BURNED', 'MINT REVOKED', '0/0 TAX', 'NO DEV — ONLY TRAINERS',
    'MULTIPLAYER ARENA LIVE', 'GOTTA PUMP ’EM ALL', 'DIAMOND HANDS EVOLVE'
  ]
};
