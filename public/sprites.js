/* ============================================================
   PokeData — original pixel-art creatures, types & moves.
   Shared by the browser (window.PokeData) and the server
   (require('./public/sprites.js')). No copyrighted sprites.
   ============================================================ */
(function () {
  const PALETTE = {
    k: '#1b1b2f', w: '#ffffff', x: '#e5e7eb', s: '#9ca3af', S: '#4b5563', d: '#0f172a',
    o: '#fb923c', O: '#c2410c', y: '#fde047', Y: '#ca8a04', r: '#ef4444', R: '#991b1b',
    b: '#3b82f6', B: '#1e40af', c: '#bae6fd', g: '#4ade80', G: '#15803d', l: '#bbf7d0',
    p: '#a855f7', P: '#6b21a8', i: '#e9d5ff', n: '#fed7aa', m: '#78350f', e: '#f9a8d4',
    t: '#fbbf24'
  };

  const TYPES = {
    fire:     { color: '#f97316', icon: '🔥' },
    water:    { color: '#3b82f6', icon: '💧' },
    grass:    { color: '#22c55e', icon: '🌿' },
    electric: { color: '#facc15', icon: '⚡' },
    rock:     { color: '#a8a29e', icon: '🪨' },
    ghost:    { color: '#a855f7', icon: '👻' },
    ice:      { color: '#67e8f9', icon: '❄️' },
    normal:   { color: '#d6d3d1', icon: '⭐' }
  };

  // attacker -> defender -> multiplier (missing = 1)
  const TYPE_CHART = {
    fire:     { grass: 2, ice: 2, water: 0.5, rock: 0.5, fire: 0.5 },
    water:    { fire: 2, rock: 2, grass: 0.5, water: 0.5 },
    grass:    { water: 2, rock: 2, fire: 0.5, grass: 0.5 },
    electric: { water: 2, ice: 1.5, grass: 0.5, electric: 0.5, rock: 0.5 },
    rock:     { fire: 2, ice: 2, electric: 1.5, grass: 0.5, water: 0.5 },
    ghost:    { ghost: 2, rock: 0.5 },
    ice:      { grass: 2, rock: 1.5, ice: 0.5, fire: 0.5, water: 0.5 },
    normal:   { rock: 0.5, ghost: 0.5 }
  };

  function effectiveness(attackType, defendType) {
    const row = TYPE_CHART[attackType];
    if (!row) return 1;
    return row[defendType] == null ? 1 : row[defendType];
  }

  const SPECIES = [
    {
      id: 'embercub', name: 'Embercub', type: 'fire', starter: true, rarity: 'common',
      speed: 6, catchRate: 0.55, points: 10, weight: 10,
      dex: 'A hot-headed cub that naps in campfire ashes. The flame on its brow flares when the chart goes green.',
      moves: [
        { name: 'Ember', type: 'fire', power: 22, acc: 100 },
        { name: 'Flame Claw', type: 'fire', power: 34, acc: 80 },
        { name: 'Scratch', type: 'normal', power: 18, acc: 100 },
        { name: 'Cozy Nap', type: 'normal', heal: 30, acc: 100 }
      ],
      pixels: [
        "....kk..y..kk...",
        "...kook.ry.kook.",
        "..koooookrkoook.",
        "..koooooooooook.",
        ".kooooooooooook.",
        ".kokkooooookkok.",
        ".kooooooooooook.",
        ".koooooonnooook.",
        ".k" + "oooo" + "n" + "kk" + "n" + "oooo" + "k.",
        ".kooooooooooook.",
        "..kooooooooook..",
        "..kooOOOOOOook..",
        "...kkoooooookk..",
        "...kOOk..kOOk...",
        "...kkkk..kkkk...",
        "................"
      ]
    },
    {
      id: 'aquafin', name: 'Aquafin', type: 'water', starter: true, rarity: 'common',
      speed: 5, catchRate: 0.55, points: 10, weight: 10,
      dex: 'A cheerful axolotl-like mon. Its gills glow blue when liquidity is deep.',
      moves: [
        { name: 'Bubble', type: 'water', power: 22, acc: 100 },
        { name: 'Tidal Slap', type: 'water', power: 34, acc: 80 },
        { name: 'Tackle', type: 'normal', power: 18, acc: 100 },
        { name: 'Soak', type: 'normal', heal: 30, acc: 100 }
      ],
      pixels: [
        "................",
        "....kkkkkkkk....",
        "..kkbbbbbbbbkk..",
        ".kcbbbbbbbbbbck.",
        "kcckbbbbbbbbkcck",
        ".kkbwkbbbbwkbkk.",
        "..kbbbbbbbbbbk..",
        "..kbbbkkkkbbbk..",
        "..kbbbbbbbbbbk..",
        "..kBbbbbbbbbBk..",
        "..kkBBBBBBBBkk..",
        "...kkBBBBBBkk...",
        "....kBBBBBBk....",
        "....kBkkkkBk....",
        "...kkk....kkk...",
        "................"
      ]
    },
    {
      id: 'leafling', name: 'Leafling', type: 'grass', starter: true, rarity: 'common',
      speed: 4, catchRate: 0.55, points: 10, weight: 10,
      dex: 'A sprout mon that photosynthesizes pure hopium. Grows a new leaf every time a holder diamond-hands a dip.',
      moves: [
        { name: 'Vine Whip', type: 'grass', power: 22, acc: 100 },
        { name: 'Leaf Storm', type: 'grass', power: 34, acc: 80 },
        { name: 'Headbutt', type: 'normal', power: 18, acc: 100 },
        { name: 'Photosynth', type: 'normal', heal: 30, acc: 100 }
      ],
      pixels: [
        ".......gg.......",
        "......kggk......",
        ".....kgGGgk.....",
        "......kGGk......",
        "....kkkkkkkk....",
        "...kllllllllk...",
        ".klkkllllllkklk.",
        ".kllllllllllllk.",
        ".klllllkklllllk.",
        ".kllllllllllllk.",
        "..kllllllllllk..",
        "..kggggggggggk..",
        "...kggggggggk...",
        "....kGGGGGGk....",
        "...kkk....kkk...",
        "................"
      ]
    },
    {
      id: 'voltmouse', name: 'Voltmouse', type: 'electric', rarity: 'uncommon',
      speed: 9, catchRate: 0.4, points: 15, weight: 6,
      dex: 'Stores static in its cheeks. Zaps paper hands on contact.',
      moves: [
        { name: 'Spark', type: 'electric', power: 22, acc: 100 },
        { name: 'Thunder Zap', type: 'electric', power: 34, acc: 80 },
        { name: 'Quick Nip', type: 'normal', power: 18, acc: 100 },
        { name: 'Recharge', type: 'normal', heal: 30, acc: 100 }
      ],
      pixels: [
        "..kk........kk..",
        ".kykk......kkyk.",
        ".kyykk....kkyyk.",
        ".kkyyykkkkyyykk.",
        "..kyyyyyyyyyyk..",
        ".kykkyyyyyykkyk.",
        ".kyyyyyyyyyyyyk.",
        ".krryyyykkyyrrk.",
        ".krryyyyyyyyrrk.",
        ".kyyyyyyyyyyyyk.",
        "..kyyyyyyyyyyk..",
        "..kyyyyyyyyyykk.",
        "...kyyyyyyyykYYk",
        "...kYYk..kYYkYk.",
        "...kkkk..kkkkk..",
        "................"
      ]
    },
    {
      id: 'rockroll', name: 'Rockroll', type: 'rock', rarity: 'uncommon',
      speed: 2, catchRate: 0.4, points: 15, weight: 6,
      dex: 'A living boulder with an unshakeable floor. Literally cannot be rugged.',
      moves: [
        { name: 'Pebble Toss', type: 'rock', power: 22, acc: 100 },
        { name: 'Boulder Roll', type: 'rock', power: 36, acc: 75 },
        { name: 'Slam', type: 'normal', power: 18, acc: 100 },
        { name: 'Harden', type: 'normal', heal: 32, acc: 100 }
      ],
      pixels: [
        "................",
        ".....kkkkkk.....",
        "...kksssssssskk.",
        "..ksssSSSSSsssk.",
        ".kssSSSSSSSSSssk",
        ".ksSSSSSSSSSSSsk",
        ".kkkkkkkkkkkkkk.",
        ".kxxkkxxxxkkxxk.",
        ".kxxxxxxxxxxxxk.",
        ".kxxxxxkkxxxxxk.",
        "..kxxxxxxxxxxk..",
        "..kkxxxxxxxxkk..",
        "...kSSk..kSSk...",
        "...kkkk..kkkk...",
        "................",
        "................"
      ]
    },
    {
      id: 'spooklet', name: 'Spooklet', type: 'ghost', rarity: 'uncommon',
      speed: 7, catchRate: 0.38, points: 15, weight: 5,
      dex: 'The ghost of the old dev wallet. Now it haunts the chart for the community.',
      moves: [
        { name: 'Spook', type: 'ghost', power: 22, acc: 100 },
        { name: 'Shadow Sneak', type: 'ghost', power: 34, acc: 80 },
        { name: 'Lick', type: 'normal', power: 18, acc: 100 },
        { name: 'Moonlight', type: 'normal', heal: 30, acc: 100 }
      ],
      pixels: [
        "......kkkk......",
        "....kkppppkk....",
        "...kppppppppk...",
        "..kppppppppppk..",
        ".kppppppppppppk.",
        ".kpwwkppppwwkpk.",
        ".kpwkkppppwkkpk.",
        ".kppppppppppppk.",
        ".kppppkkkkppppk.",
        ".kpppppkkpppppk.",
        ".kppppppppppppk.",
        ".kPpppPPppppPpk.",
        ".kPPkkPPPPkkPPk.",
        ".kPk..kPPk..kPk.",
        ".kk...kkkk...kk.",
        "................"
      ]
    },
    {
      id: 'moonwhale', name: 'Moonwhale', type: 'ice', rarity: 'legendary',
      speed: 5, catchRate: 0.15, points: 100, weight: 1,
      dex: 'A legendary whale said to appear only at the bottom. Catching one is the ultimate flex.',
      moves: [
        { name: 'Frost Spray', type: 'ice', power: 24, acc: 100 },
        { name: 'Lunar Beam', type: 'ice', power: 38, acc: 75 },
        { name: 'Body Slam', type: 'normal', power: 20, acc: 100 },
        { name: 'Tide Rest', type: 'normal', heal: 35, acc: 100 }
      ],
      pixels: [
        "..............t.",
        ".....kkkkkk..tt.",
        "...kkccccccckk..",
        "..kcccccccccccck",
        ".kccccccccccccck",
        ".kckkccccccccck.",
        ".kcccccccccccck.",
        ".kcccccccccccck.",
        ".kwwwwwwwwwwwwk.",
        ".kkwwwwwwwwwwkk.",
        "..kkwwwwwwwwkk..",
        "...kkkkkkkkkk...",
        ".......kk.......",
        "....kkkkkkkk....",
        "...kccck..kccck.",
        "...kkkk...kkkk.."
      ]
    }
  ];

  // Trainer: 'A' = primary colour (player picked), 'C' = shirt, 'B' = pants
  const TRAINER = [
    ".....kkkkkk.....",
    "....kAAAAAAk....",
    "...kAAAAAAAAk...",
    "...kAAAAAAAAkkk.",
    "...kkkkkkkkkkkk.",
    "...knnnnnnnnk...",
    "...knkknnkknk...",
    "...knnnnnnnnk...",
    "....knnkknnk....",
    ".....kkkkkk.....",
    "...kCCCCCCCCk...",
    "..knCCCCCCCCnk..",
    "..kkCCCCCCCCkk..",
    "....kBBBBBBk....",
    "....kBBkkBBk....",
    "....kkk..kkk...."
  ];

  const POKEBALL = [
    ".....kkkkkk.....",
    "...kkrrrrrrkk...",
    "..krrrrrrrrrrk..",
    ".krrrrrrrrrrrrk.",
    ".krrrrrrrrrrrrk.",
    "krrrrrrrrrrrrrrk",
    "krrrrrrrrrrrrrrk",
    "kkkkkkkkkkkkkkkk",
    "kwwwwkkwwkkwwwwk",
    "kwwwwwkkkkwwwwwk",
    ".kwwwwwwwwwwwwk.",
    ".kwwwwwwwwwwwwk.",
    "..kwwwwwwwwwwk..",
    "...kkwwwwwwkk...",
    ".....kkkkkk.....",
    "................"
  ];

  const SPECIES_BY_ID = {};
  SPECIES.forEach(s => { SPECIES_BY_ID[s.id] = s; });

  /** Draw a pixel sprite on a 2D context. tint maps extra letters to colours. */
  function drawSprite(ctx, pixels, x, y, scale, tint, flip) {
    const size = pixels.length;
    for (let r = 0; r < size; r++) {
      const row = pixels[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const col = (tint && tint[ch]) || PALETTE[ch];
        if (!col) continue;
        ctx.fillStyle = col;
        const cx = flip ? (row.length - 1 - c) : c;
        ctx.fillRect(x + cx * scale, y + r * scale, scale, scale);
      }
    }
  }

  /** Render a sprite to a standalone canvas element (browser only). */
  function spriteToCanvas(pixels, scale, tint, flip) {
    const cv = document.createElement('canvas');
    cv.width = pixels[0].length * scale;
    cv.height = pixels.length * scale;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSprite(ctx, pixels, 0, 0, scale, tint, flip);
    return cv;
  }

  /** Silhouette version (for the "Who's that mon?" quiz). */
  function silhouetteToCanvas(pixels, scale, color) {
    const tint = {};
    Object.keys(PALETTE).forEach(k => { tint[k] = color || '#0b1020'; });
    return spriteToCanvas(pixels, scale, tint);
  }

  const PokeData = {
    PALETTE, TYPES, TYPE_CHART, SPECIES, SPECIES_BY_ID, TRAINER, POKEBALL,
    effectiveness, drawSprite, spriteToCanvas, silhouetteToCanvas
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PokeData;
  else window.PokeData = PokeData;
})();
