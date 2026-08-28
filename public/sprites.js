/* ============================================================
   PokeData — small pixel-art helpers for the arena overworld:
   the trainer sprite and the Poké Ball. Pokémon sprites come
   from /assets/pokemon (see pokedex.js + scripts/fetch-assets.js).
   ============================================================ */
(function () {
  const PALETTE = {
    k: '#1b1b2f', w: '#ffffff', r: '#ef4444', n: '#fed7aa', B: '#1e40af', C: '#f8fafc', A: '#e3350d'
  };

  // 'A' = cap colour (per player), 'C' = shirt, 'B' = trousers
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

  function drawSprite(ctx, pixels, x, y, scale, tint, flip) {
    for (let r = 0; r < pixels.length; r++) {
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

  function spriteToCanvas(pixels, scale, tint, flip) {
    const cv = document.createElement('canvas');
    cv.width = pixels[0].length * scale;
    cv.height = pixels.length * scale;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    drawSprite(ctx, pixels, 0, 0, scale, tint, flip);
    return cv;
  }

  const PokeData = { PALETTE, TRAINER, POKEBALL, drawSprite, spriteToCanvas };
  if (typeof module !== 'undefined' && module.exports) module.exports = PokeData;
  else window.PokeData = PokeData;
})();
