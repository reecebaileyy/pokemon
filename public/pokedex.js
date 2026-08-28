/* ============================================================
   Pokedex — Gen-1 roster used by the arena (shared client/server).
   Sprites/cries are bundled under /assets/pokemon (see scripts/fetch-assets.js).
   ============================================================ */
(function () {
  const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
  const TYPE_COLORS = {
    normal: '#A8A77A', fire: '#EE8130', water: '#6390F0', electric: '#F7D02C', grass: '#7AC74C', ice: '#96D9D6',
    fighting: '#C22E28', poison: '#A33EA1', ground: '#E2BF65', flying: '#A98FF3', psychic: '#F95587', bug: '#A6B91A',
    rock: '#B6A136', ghost: '#735797', dragon: '#6F35FC', dark: '#705746', steel: '#B7B7CE', fairy: '#D685AD'
  };

  // attacker -> defender -> multiplier (missing = 1). Standard chart.
  const TYPE_CHART = {
    normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
    fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
    dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
  };

  /** Multiplier of an attack type against a (possibly dual-typed) defender. */
  function effectiveness(attackType, defenderTypes) {
    const row = TYPE_CHART[attackType] || {};
    let m = 1;
    for (const t of defenderTypes) m *= row[t] == null ? 1 : row[t];
    return m;
  }

  const M = {}; // move library
  const mv = (name, type, power, acc, extra) => { M[name] = Object.assign({ name, type, power, acc }, extra || {}); };
  const heal = (name, type, amount) => { M[name] = { name, type, heal: amount, acc: 100 }; };
  mv('Tackle', 'normal', 18, 100); mv('Scratch', 'normal', 18, 100); mv('Pound', 'normal', 18, 100); mv('Quick Attack', 'normal', 20, 100, { priority: 1 });
  mv('Swift', 'normal', 24, 100); mv('Take Down', 'normal', 30, 85); mv('Body Slam', 'normal', 30, 90); mv('Slash', 'normal', 28, 95);
  mv('Hyper Fang', 'normal', 32, 90); mv('Hyper Beam', 'normal', 46, 75); mv('Double Slap', 'normal', 22, 90); mv('Pay Day', 'normal', 22, 100);
  mv('Fury Swipes', 'normal', 24, 85); mv('Flail', 'normal', 32, 80); mv('Bite', 'dark', 24, 100); mv('Crunch', 'dark', 32, 90);
  mv('Vine Whip', 'grass', 22, 100); mv('Razor Leaf', 'grass', 32, 85); mv('Solar Beam', 'grass', 44, 70); mv('Acid', 'poison', 22, 100);
  mv('Sludge Bomb', 'poison', 34, 85); mv('Poison Sting', 'poison', 20, 100); mv('Leech Life', 'bug', 22, 100);
  mv('Ember', 'fire', 22, 100); mv('Flame Wheel', 'fire', 26, 100); mv('Fire Fang', 'fire', 26, 95); mv('Flamethrower', 'fire', 34, 85); mv('Fire Blast', 'fire', 44, 70);
  mv('Water Gun', 'water', 22, 100); mv('Bubble Beam', 'water', 28, 95); mv('Surf', 'water', 34, 90); mv('Waterfall', 'water', 32, 90); mv('Hydro Pump', 'water', 44, 70);
  mv('Thunder Shock', 'electric', 22, 100); mv('Thunderbolt', 'electric', 34, 85); mv('Thunder', 'electric', 44, 70); mv('Iron Tail', 'steel', 34, 75);
  mv('Gust', 'flying', 22, 100); mv('Wing Attack', 'flying', 28, 95); mv('Bounce', 'flying', 26, 85); mv('Hurricane', 'flying', 44, 70);
  mv('Rock Throw', 'rock', 24, 95); mv('Rock Slide', 'rock', 32, 85); mv('Magnitude', 'ground', 28, 95); mv('Earthquake', 'ground', 36, 90);
  mv('Confusion', 'psychic', 22, 100); mv('Psybeam', 'psychic', 28, 95); mv('Psychic', 'psychic', 36, 90);
  mv('Lick', 'ghost', 20, 100); mv('Night Shade', 'ghost', 26, 100); mv('Shadow Ball', 'ghost', 34, 90);
  mv('Aurora Beam', 'ice', 26, 95); mv('Ice Beam', 'ice', 34, 90); mv('Blizzard', 'ice', 44, 70);
  mv('Dragon Claw', 'dragon', 32, 95); mv('Outrage', 'dragon', 44, 75); mv('Play Rough', 'fairy', 34, 85);
  heal('Synthesis', 'grass', 30); heal('Rest', 'psychic', 36); heal('Roost', 'flying', 30); heal('Recover', 'normal', 36);
  heal('Moonlight', 'fairy', 30); heal('Wish', 'normal', 30); heal('Soft-Boiled', 'normal', 36); heal('Splash', 'water', 4);

  // rarity -> spawn weight & points
  const RARITY = { common: { weight: 10, points: 10 }, uncommon: { weight: 5, points: 15 }, rare: { weight: 2, points: 30 }, epic: { weight: 0.8, points: 60 }, legendary: { weight: 0.35, points: 100 } };

  const R = [];
  const add = (dex, name, types, o) => R.push(Object.assign({ dex, name, types, speed: 5, catchRate: 0.5, rarity: 'uncommon', wild: true, starter: false, stage: 0 }, o));
  // Starters + evolution lines (not wild)
  add(1, 'Bulbasaur', ['grass', 'poison'], { starter: true, wild: false, speed: 4, moves: ['Vine Whip', 'Razor Leaf', 'Tackle', 'Synthesis'], evolvesTo: 2, evolveLevel: 4 });
  add(2, 'Ivysaur', ['grass', 'poison'], { wild: false, stage: 1, speed: 5, moves: ['Razor Leaf', 'Sludge Bomb', 'Take Down', 'Synthesis'], evolvesTo: 3, evolveLevel: 8 });
  add(3, 'Venusaur', ['grass', 'poison'], { wild: false, stage: 2, speed: 6, moves: ['Razor Leaf', 'Solar Beam', 'Sludge Bomb', 'Synthesis'] });
  add(4, 'Charmander', ['fire'], { starter: true, wild: false, speed: 6, moves: ['Ember', 'Flamethrower', 'Scratch', 'Rest'], evolvesTo: 5, evolveLevel: 4 });
  add(5, 'Charmeleon', ['fire'], { wild: false, stage: 1, speed: 7, moves: ['Flamethrower', 'Slash', 'Fire Fang', 'Rest'], evolvesTo: 6, evolveLevel: 8 });
  add(6, 'Charizard', ['fire', 'flying'], { wild: false, stage: 2, speed: 9, moves: ['Flamethrower', 'Fire Blast', 'Wing Attack', 'Roost'] });
  add(7, 'Squirtle', ['water'], { starter: true, wild: false, speed: 4, moves: ['Water Gun', 'Bubble Beam', 'Tackle', 'Rest'], evolvesTo: 8, evolveLevel: 4 });
  add(8, 'Wartortle', ['water'], { wild: false, stage: 1, speed: 5, moves: ['Bubble Beam', 'Surf', 'Bite', 'Rest'], evolvesTo: 9, evolveLevel: 8 });
  add(9, 'Blastoise', ['water'], { wild: false, stage: 2, speed: 6, moves: ['Surf', 'Hydro Pump', 'Ice Beam', 'Rest'] });
  add(25, 'Pikachu', ['electric'], { starter: true, wild: false, speed: 8, moves: ['Thunder Shock', 'Thunderbolt', 'Quick Attack', 'Rest'], evolvesTo: 26, evolveLevel: 6 });
  add(26, 'Raichu', ['electric'], { wild: false, stage: 2, speed: 9, moves: ['Thunderbolt', 'Thunder', 'Iron Tail', 'Rest'] });
  // Wild — common
  add(16, 'Pidgey', ['normal', 'flying'], { rarity: 'common', speed: 6, catchRate: 0.6, moves: ['Gust', 'Quick Attack', 'Wing Attack', 'Roost'] });
  add(19, 'Rattata', ['normal'], { rarity: 'common', speed: 7, catchRate: 0.6, moves: ['Quick Attack', 'Bite', 'Hyper Fang', 'Rest'] });
  add(129, 'Magikarp', ['water'], { rarity: 'common', speed: 7, catchRate: 0.7, moves: ['Splash', 'Tackle', 'Flail', 'Bounce'], evolvesTo: 130, evolveLevel: 5 });
  add(41, 'Zubat', ['poison', 'flying'], { rarity: 'common', speed: 6, catchRate: 0.6, moves: ['Leech Life', 'Wing Attack', 'Poison Sting', 'Roost'] });
  add(43, 'Oddish', ['grass', 'poison'], { rarity: 'common', speed: 3, catchRate: 0.6, moves: ['Acid', 'Razor Leaf', 'Sludge Bomb', 'Synthesis'] });
  // Wild — uncommon
  add(54, 'Psyduck', ['water'], { speed: 5, catchRate: 0.45, moves: ['Water Gun', 'Confusion', 'Surf', 'Rest'] });
  add(74, 'Geodude', ['rock', 'ground'], { speed: 2, catchRate: 0.45, moves: ['Rock Throw', 'Magnitude', 'Rock Slide', 'Rest'] });
  add(39, 'Jigglypuff', ['normal', 'fairy'], { speed: 3, catchRate: 0.45, moves: ['Pound', 'Double Slap', 'Play Rough', 'Rest'] });
  add(52, 'Meowth', ['normal'], { speed: 7, catchRate: 0.45, moves: ['Pay Day', 'Fury Swipes', 'Bite', 'Rest'] });
  add(58, 'Growlithe', ['fire'], { speed: 6, catchRate: 0.4, moves: ['Ember', 'Flame Wheel', 'Bite', 'Rest'] });
  add(63, 'Abra', ['psychic'], { speed: 9, catchRate: 0.35, moves: ['Confusion', 'Psybeam', 'Psychic', 'Recover'] });
  // Wild — rare
  add(133, 'Eevee', ['normal'], { rarity: 'rare', speed: 6, catchRate: 0.3, moves: ['Quick Attack', 'Swift', 'Bite', 'Wish'], evolvesTo: [134, 135, 136], evolveLevel: 5 });
  add(134, 'Vaporeon', ['water'], { wild: false, stage: 1, speed: 6, moves: ['Water Gun', 'Surf', 'Aurora Beam', 'Wish'] });
  add(135, 'Jolteon', ['electric'], { wild: false, stage: 1, speed: 10, moves: ['Thunder Shock', 'Thunderbolt', 'Quick Attack', 'Wish'] });
  add(136, 'Flareon', ['fire'], { wild: false, stage: 1, speed: 6, moves: ['Ember', 'Flamethrower', 'Bite', 'Wish'] });
  add(94, 'Gengar', ['ghost', 'poison'], { rarity: 'rare', speed: 10, catchRate: 0.25, moves: ['Lick', 'Shadow Ball', 'Sludge Bomb', 'Moonlight'] });
  add(143, 'Snorlax', ['normal'], { rarity: 'rare', speed: 2, catchRate: 0.25, moves: ['Body Slam', 'Hyper Beam', 'Crunch', 'Rest'], bulky: true });
  add(131, 'Lapras', ['water', 'ice'], { rarity: 'rare', speed: 4, catchRate: 0.3, moves: ['Surf', 'Ice Beam', 'Body Slam', 'Rest'], bulky: true });
  add(130, 'Gyarados', ['water', 'flying'], { rarity: 'rare', speed: 8, catchRate: 0.25, moves: ['Waterfall', 'Hydro Pump', 'Crunch', 'Rest'] });
  // Wild — epic / legendary
  add(149, 'Dragonite', ['dragon', 'flying'], { rarity: 'epic', speed: 8, catchRate: 0.2, moves: ['Dragon Claw', 'Outrage', 'Hurricane', 'Roost'], bulky: true });
  add(150, 'Mewtwo', ['psychic'], { rarity: 'legendary', speed: 10, catchRate: 0.12, moves: ['Psybeam', 'Psychic', 'Shadow Ball', 'Recover'], bulky: true });
  add(151, 'Mew', ['psychic'], { rarity: 'legendary', speed: 10, catchRate: 0.12, moves: ['Psychic', 'Flamethrower', 'Thunderbolt', 'Soft-Boiled'], bulky: true });

  const BY_DEX = {};
  R.forEach(p => { p.moves = p.moves.map(n => M[n]); p.points = RARITY[p.rarity].points; p.weight = p.wild ? RARITY[p.rarity].weight : 0; BY_DEX[p.dex] = p; });
  const STARTERS = R.filter(p => p.starter);
  const WILD = R.filter(p => p.wild);

  // Items — sold in the PokéStore for $POKEMON (whole tokens; override per item in config.js → economy.itemPrices).
  // Everything spent is burned on-chain. Balls are used in encounters, everything else is a battle turn.
  const ITEMS = {
    potion:      { id: 'potion',      name: 'Potion',       kind: 'heal',  amount: 20,   price: 500,  icon: '🧪', desc: 'Restores 20 HP.' },
    superpotion: { id: 'superpotion', name: 'Super Potion', kind: 'heal',  amount: 50,   price: 1200, icon: '🧴', desc: 'Restores 50 HP.' },
    hyperpotion: { id: 'hyperpotion', name: 'Hyper Potion', kind: 'heal',  amount: 120,  price: 2800, icon: '💊', desc: 'Restores 120 HP.' },
    fullrestore: { id: 'fullrestore', name: 'Full Restore', kind: 'heal',  amount: 9999, price: 5000, icon: '✨', desc: 'Fully restores HP.' },
    xattack:     { id: 'xattack',     name: 'X Attack',     kind: 'boost', mult: 1.5, turns: 3, price: 1800, icon: '⚔️', desc: '+50% damage for 3 turns.' },
    xdefend:     { id: 'xdefend',     name: 'X Defend',     kind: 'guard', mult: 0.7, turns: 3, price: 1800, icon: '🛡️', desc: 'Take 30% less damage for 3 turns.' },
    greatball:   { id: 'greatball',   name: 'Great Ball',   kind: 'ball',  mult: 1.5, price: 1000, icon: '🔵', desc: '1.5× catch rate.' },
    ultraball:   { id: 'ultraball',   name: 'Ultra Ball',   kind: 'ball',  mult: 2.2, price: 2500, icon: '🟡', desc: '2.2× catch rate.' }
  };
  const ITEM_LIST = Object.values(ITEMS);

  const ASSET = 'assets/pokemon';
  const assets = {
    front: (dex, shiny) => `${ASSET}/${shiny ? 'shiny/' : ''}${dex}.png`,
    back: dex => `${ASSET}/back/${dex}.png`,
    anim: (dex, back) => `${ASSET}/anim/${back ? 'back/' : ''}${dex}.gif`,
    art: dex => `${ASSET}/art/${dex}.png`,
    cry: dex => `${ASSET}/cries/${dex}.ogg`
  };

  const Pokedex = { TYPES, TYPE_COLORS, TYPE_CHART, MOVES: M, RARITY, ROSTER: R, BY_DEX, STARTERS, WILD, ITEMS, ITEM_LIST, effectiveness, assets };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pokedex;
  else window.Pokedex = Pokedex;
})();
