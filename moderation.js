/* ============================================================
   Chat / name moderation.
   - censor(text): blocked words become asterisks (leet-speak and stretched letters are caught: "sh1t", "fuuuck")
   - isClean(name): false if a trainer name / username contains a blocked word
   Strong terms are matched anywhere inside a word; milder ones only as whole words so "class", "assassin",
   "Cocktail" or "Dickens" are left alone. Site config can add words (moderation.extra) or allow some (moderation.allow).
   ============================================================ */
'use strict';

const STRONG = ['fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'motherfucker', 'asshole', 'bitch', 'whore', 'slut', 'pussy', 'wanker', 'tranny', 'kike', 'porn', 'retard', 'bastard', 'jackass', 'dumbass', 'asshat', 'twat'];
const MILD = ['ass', 'damn', 'crap', 'piss', 'tits', 'prick', 'douche', 'hoe', 'arse', 'dick', 'cock', 'fag', 'spic', 'chink', 'dyke', 'penis', 'vagina', 'cum', 'jerkoff', 'goddamn', 'bollocks', 'wank', 'coon', 'gook', 'homo'];

const LEET = { '@': 'a', '4': 'a', '$': 's', '5': 's', '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '7': 't', '+': 't', '€': 'e', '¢': 'c' };

function create(opts) {
  const allow = new Set((opts && opts.allow || []).map(w => String(w).toLowerCase()));
  const strong = STRONG.concat(opts && opts.extraStrong || []).filter(w => !allow.has(w));
  const mild = MILD.concat(opts && opts.extra || []).filter(w => !allow.has(w));
  const strongRe = new RegExp(strong.map(esc).join('|'));
  const mildRe = new RegExp(`^(?:${mild.map(esc).join('|')})(?:s|es|ed|ing|er|ers)?$`);

  /** lowercase, un-leet, keep letters only */
  const normalize = s => String(s).toLowerCase().replace(/[@45$0!|137+€¢]/g, c => LEET[c] || c).replace(/[^a-z]/g, '');
  const collapse = s => s.replace(/(.)\1+/g, '$1'); // "fuuuck" -> "fuck"

  function wordIsBad(rawToken) {
    const n = normalize(rawToken);
    if (!n) return false;
    const c = collapse(n);
    if (strongRe.test(n) || strongRe.test(c)) return true;
    return mildRe.test(n) || mildRe.test(c);
  }

  /** Replace every blocked word in `text` with asterisks (punctuation and spacing are kept). */
  function censor(text) {
    return String(text).split(/(\s+)/).map(tok => {
      if (!tok || /^\s+$/.test(tok)) return tok;
      if (!wordIsBad(tok)) return tok;
      return tok.replace(/[A-Za-z0-9@$!|+€¢]/g, '*');
    }).join('');
  }

  /** True if a trainer name / username has no blocked words (checked as a whole and per word). */
  function isClean(name) {
    const s = String(name || '');
    if (!s.trim()) return true;
    const whole = normalize(s);
    if (strongRe.test(whole) || strongRe.test(collapse(whole))) return false;
    return !s.split(/[^A-Za-z0-9@$!|+€¢]+/).some(tok => tok && wordIsBad(tok));
  }

  return { censor, isClean, hasProfanity: text => censor(text) !== String(text) };
}
function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { create };
