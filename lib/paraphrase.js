// Paraphrasing cards. Claude rewrites ONLY what the card's highlighting says, and code then checks
// the paraphrase stays faithful: no new numbers, hedges kept, no new absolutes, author and year named.
'use strict';

// Words in the card that mark uncertainty, and words that count as keeping it in the paraphrase.
const HEDGES = ['may', 'might', 'could', 'likely', 'possibly', 'perhaps', 'suggests', 'probably', 'potentially', 'unlikely'];
const SOFTENERS = HEDGES.concat(['can', 'would', 'risk', 'risks', 'risking', 'chance', 'possible', 'threatens', 'threaten']);
const ABSOLUTES = ['always', 'never', 'guarantees', 'guaranteed', 'certainly', 'definitely', 'proves', 'proven', 'all', 'every', 'inevitably', 'impossible', 'completely', 'undeniably'];

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '');
const yy = (date) => (String(date || '').match(/(\d{4})/) || ['', ''])[1];

// Card text with the highlighted (read) parts wrapped in [[ ]], so Claude sees what was read and the context around it.
function markedText(card) {
  return (card.paragraphs || []).map((p) => String(p).replace(/<h>/gi, '[[').replace(/<\/h>/gi, ']]').replace(/<[^>]+>/g, '').replace(/\]\]\s*\[\[/g, ' ')).join('\n');
}
function highlighted(card) {
  return ((card.paragraphs || []).join(' ').match(/<h>[\s\S]*?<\/h>/gi) || []).map(strip).join(' ').replace(/\s+/g, ' ').trim();
}

// Target length: a paraphrase should always be quicker to read than the card's highlighting.
function maxWords(card) {
  const hw = (highlighted(card).match(/\S+/g) || []).length;
  return Math.max(20, Math.min(card.mode === 'Rebuttal' ? 35 : 70, Math.round(hw * 0.85)));
}

function paraphrasePrompt(card, opts = {}) {
  const c = card.cite || {};
  const short = opts.mode === 'Rebuttal' || card.mode === 'Rebuttal';
  return `Paraphrase this Public Forum evidence card so a debater can read it out loud.
TAG: ${strip(card.tag)}
AUTHOR: ${c.authorFull || c.authorLast} (${c.credentials || 'no credentials listed'}), ${c.publication || ''}, ${c.date || ''}
CARD TEXT (the parts in [[double brackets]] are the highlighted parts that get read; the rest is context):
${markedText(card)}

RULES
- Paraphrase ONLY what the [[highlighted]] parts say. Use the rest only to keep the meaning accurate.
- Open with the author's last name, a short credential, and the year written as digits, e.g. "${c.authorLast || 'Smith'} of ${shortOrg(c) || 'the Example Institute'} writes in ${yy(c.date) || '2026'} that ...".
- Use YOUR OWN WORDS: restate the warrant more simply and directly. Never copy more than a few words in a row from the card.
- At most ${maxWords(card)} words in total, so it's quicker to read than the card.
- Keep every number exactly as the card has it. Add no numbers, examples, causes or impacts the card doesn't state.
- Keep the author's certainty: if the card says "could", "may" or "likely", the paraphrase must too. Don't add "always", "never", "proves" or "guarantees".
- ${short ? '1-2 sentences.' : '2-3 sentences.'} Plain spoken English, no quotation marks, no ellipses.
Return ONLY: <para>the paraphrase</para>`;
}
function shortOrg(c) {
  const cred = String(c.credentials || '');
  const m = cred.match(/\b(?:at|of|for|with)\s+(?:the\s+)?([^,;]+)/i);
  return m ? (m[0].match(/the\s/i) ? 'the ' : '') + m[1].trim() : c.publication || '';
}

// Faithfulness checks, all done in code.
function checkParaphrase(card, text) {
  const src = (markedText(card) + ' ' + strip(card.tag)).toLowerCase();
  const read = highlighted(card).toLowerCase();
  const t = String(text).toLowerCase();
  const items = [];
  const add = (label, ok, note = '') => items.push({ label, state: ok, note });

  const last = String(card.cite?.authorLast || '').toLowerCase();
  const year = yy(card.cite?.date);
  add('Names the author and year', !!last && t.includes(last) && (!year || t.includes(year) || t.includes(year.slice(2))), 'Say the author and date out loud (NSDA rule)');

  const dateParts = new Set(String(card.cite?.date || '').split(/\D+/).filter(Boolean).flatMap((d) => [d, String(+d)]));
  const nums = (text.match(/\d[\d,.]*%?/g) || []).map((n) => n.replace(/[.,]$/, '')).filter((n) => n !== year && n !== year.slice(2) && !dateParts.has(n));
  const newNums = nums.filter((n) => !src.includes(n.toLowerCase()));
  add('No new numbers', newNums.length === 0, newNums.length ? `Not in the card: ${newNums.join(', ')}` : '');

  const words = (s) => new Set(s.match(/[a-z']+/g) || []);
  const rw = words(read), tw = words(t), sw = words(src);
  const hedgesIn = HEDGES.filter((h) => rw.has(h)), kept = hedgesIn.filter((h) => tw.has(h));
  const anyHedge = SOFTENERS.some((h) => tw.has(h));
  add('Keeps the author\'s hedges', !hedgesIn.length || anyHedge, hedgesIn.length && !anyHedge ? `The card says "${hedgesIn.join('", "')}" but the paraphrase sounds certain` : kept.length ? '' : '');

  const added = ABSOLUTES.filter((a) => tw.has(a) && !sw.has(a));
  add('No overclaiming', added.length === 0, added.length ? `Adds "${added.join('", "')}", which the card doesn't say` : '');

  add('No quotes or ellipses', !/["“”]|\.\.\.|…/.test(text), 'Paraphrase should be in your own words');

  // own words: no run of 10+ words copied straight from the card
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
  const cw = norm(markedText(card)).join(' '), pws = norm(text);
  let copied = '';
  for (let i = 0; i + 10 <= pws.length && !copied; i++) { const run = pws.slice(i, i + 10).join(' '); if (cw.includes(run)) copied = run; }
  add('In your own words', !copied, copied ? `Copies "${copied}…" word for word` : '');

  const pw = (text.match(/\S+/g) || []).length, hw = (read.match(/\S+/g) || []).length;
  add('Shorter than the card', pw <= maxWords(card) || pw < hw, `${pw} words (aim for ${maxWords(card)} or fewer; the card's highlighting is ${hw})`);
  return { items, words: pw, seconds: Math.round(pw / 3.5), highlightedWords: hw, ok: items.every((i) => i.state) };
}

function fixPrompt(card, text, check) {
  const bad = check.items.filter((i) => !i.state).map((i) => `${i.label}${i.note ? ` (${i.note})` : ''}`);
  return `${paraphrasePrompt(card)}

Your last paraphrase was:
${text}
It failed these checks: ${bad.join('; ')}. Fix only that and return the corrected paraphrase.`;
}

module.exports = { paraphrasePrompt, checkParaphrase, fixPrompt, highlighted };
