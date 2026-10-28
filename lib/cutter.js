// The credit-saving card cutter. Negi downloads articles herself and numbers their paragraphs;
// Claude only answers "which paragraphs, which phrases to underline/highlight/bold".
// Card text is always the page's own text, so it is verbatim by construction and has no length cap.
'use strict';

const MAX_CHARS_PER_SOURCE = 20000;

// ---------------------------------------------------------------- articles

function toParagraphs(text) {
  return String(text).split(/\n+/).map((p) => p.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
}

// Build a numbered, trimmed view of an article for the prompt. Short menu/footer lines are dropped,
// except near the top where bylines and dates live.
function articleView(src, n) {
  const paras = toParagraphs(src.text);
  const keep = [];
  let chars = 0;
  paras.forEach((p, i) => {
    const nearTop = i < 25;
    if (p.length < 60 && !(nearTop && p.length >= 4)) return;
    if (chars > MAX_CHARS_PER_SOURCE) return;
    keep.push(i);
    chars += p.length;
  });
  const meta = src.meta || {};
  const head = [`=== SOURCE ${n} ===`, `URL: ${src.url}`];
  for (const [k, v] of Object.entries(meta)) if (v) head.push(`META ${k}: ${v}`);
  return { paras, text: head.join('\n') + '\n' + keep.map((i) => `[P${i}] ${paras[i]}`).join('\n') };
}

// ---------------------------------------------------------------- date range

// Parses a cite date (MM-DD-YYYY, MM-YYYY or YYYY) or an ISO date into the span of days it covers.
function dateSpan(s) {
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) { const d = Date.UTC(+m[1], m[2] - 1, +m[3]); return [d, d]; }
  if ((m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/))) { const d = Date.UTC(+m[3], m[1] - 1, +m[2]); return [d, d]; }
  if ((m = s.match(/^(\d{1,2})-(\d{4})$/))) return [Date.UTC(+m[2], m[1] - 1, 1), Date.UTC(+m[2], +m[1], 0)];
  if ((m = s.match(/^(\d{4})$/))) return [Date.UTC(+m[1], 0, 1), Date.UTC(+m[1], 11, 31)];
  return null;
}
// true = inside the range, false = outside, null = no usable date (or no range set)
function inRange(date, from, to) {
  if (!from && !to) return null;
  const sp = dateSpan(date);
  if (!sp) return null;
  const lo = from ? dateSpan(from)[0] : -Infinity, hi = to ? dateSpan(to)[1] : Infinity;
  return sp[1] >= lo && sp[0] <= hi;
}
function rangeText(from, to) {
  const f = (s) => { const [y, mo, d] = s.split('-'); return `${MONTHS[mo - 1].replace(/^./, (x) => x.toUpperCase())} ${+d}, ${y}`; };
  if (from && to) return `published between ${f(from)} and ${f(to)}`;
  if (from) return `published on or after ${f(from)}`;
  return `published on or before ${f(to)}`;
}

// ---------------------------------------------------------------- prompts

const LENGTH = {
  short: 'Each card: 1 paragraph.',
  medium: 'Each card: 2-3 contiguous paragraphs.',
  long: 'Each card: 3-6 contiguous paragraphs.',
  nolimit: 'NO LENGTH LIMIT: use as many contiguous paragraphs as the argument needs (a whole section is fine) so the warrants are complete.',
};

function searchPrompt(job, want, tried = []) {
  return `You are a Public Forum evidence researcher. Use WebSearch (at most 3 searches, and do NOT use WebFetch) to find ${want} strong candidate articles.
TOPIC: ${job.topic}
${job.side ? `SIDE: ${job.side}\n` : ''}${job.mode === 'rebuttal' ? `THIS IS FOR REBUTTAL. Find evidence that ANSWERS this opponent argument: "${job.oppArg || job.argument}"${job.responseType && RESPONSES[job.responseType] ? `, specifically ${RESPONSES[job.responseType]}` : ' (turns, no-link, non-unique or mitigation evidence)'}.${job.argument && job.oppArg ? `\nOUR POINT: ${job.argument}` : ''}` : `THE EVIDENCE MUST PROVE: ${job.argument}`}
${job.notes ? `EXTRA INSTRUCTIONS: ${job.notes}\n` : ''}
${job.dateFrom || job.dateTo ? `DATE RULE: only articles ${rangeText(job.dateFrom, job.dateTo)}. Put the year in your searches and skip anything older or newer.\n` : ''}Pick qualified authors (think tanks, academics, journalists at major outlets, government/NATO documents), recent where uniqueness matters, from DIFFERENT publications and DIFFERENT authors (at most one article per website).
Give each article a different angle: a distinct warrant, impact or piece of evidence for the argument, so the cards don't repeat each other.
Prefer normal HTML article pages that load without a login. Avoid PDFs, paywalled sites (NYT, WSJ, FT, Economist, Foreign Affairs), Wikipedia, debate briefs, and video.
${tried.length ? `Find different articles from these already-tried sites: ${tried.join(', ')}\n` : ''}Return ONLY: <urls>[{"url": "https://…", "angle": "the specific warrant this article gives"}, …]</urls>`;
}

function cutPrompt(job, views, n, angle) {
  const sel = job.selection ? `\nThe user highlighted this passage in their browser. Build the card from the paragraphs containing it:\n"""${job.selection.slice(0, 4000)}"""\n` : '';
  const spread = n > 1 ? (views.length > 1 ? ', each from a DIFFERENT source' : ' from DIFFERENT, non-overlapping parts of the article, each making a different point') : '';
  return `You are Negi, an expert Public Forum card cutter. Cut ${n} card${n > 1 ? 's' : ''}${spread}.${angle ? `\nFOCUS: this article was picked for this angle: ${angle}. Cut the part that proves it best.` : ''}
TOPIC: ${job.topic}
${job.side ? `SIDE: ${job.side}\n` : ''}${job.argument ? `THE CARD MUST PROVE: ${job.argument}\n` : ''}${job.notes ? `EXTRA INSTRUCTIONS: ${job.notes}\n` : ''}${sel}
${modeBlock(job)}
LENGTH: ${LENGTH[job.length] || LENGTH.nolimit}${job.dateFrom || job.dateTo ? `\nDATE RULE: only cut sources ${rangeText(job.dateFrom, job.dateTo)}. Skip any source outside that range.` : ''}

The articles below were downloaded for you. Paragraphs are numbered [P#]. You do NOT copy card text: you choose paragraph numbers and list exact phrases to mark. Do not use any tools.

${views.map((v) => v.text).join('\n\n')}

Return ONLY strict JSON inside <cards></cards>:
<cards>[{
  "source": 1,
  "tag": "Argumentative claim the card proves, with <u>key phrase</u> underlined. Ends with a period.",
  "cite": {"authorFull": "Jane Doe", "authorLast": "Doe", "credentials": "Senior Fellow at X", "credentialsEvidence": "exact words from the article that state the credentials", "date": "MM-DD-YYYY", "title": "Exact article title", "publication": "Publication name"},
  "paragraphs": [{"p": 12, "u": ["phrase to underline", "another phrase"], "h": ["words to highlight"], "b": ["key"]}]
}]</cards>

RULES
- "p" numbers must be contiguous paragraphs that appear in the source.
- Every string in u, h and b is copied EXACTLY from that paragraph (same spelling and punctuation), listed in the order they appear. Use "ALL" in u to underline the whole paragraph.
- h phrases must be inside u phrases; b words inside h phrases.
- Underline about 35-60% of the text. Keep the HIGHLIGHT within the word count given under SPEECH. The highlighted words, read alone in order, must form smooth grammatical sentences that make the warrant (prefer phrases of 3+ words; avoid strings of 1-2 word fragments). Bold 1-3 words per paragraph.
- The tag must not overclaim beyond the highlighted text.
- Cite: take the author, date and title from the byline, META lines or article text. Credentials must come from the article (byline, author bio). If they aren't there, give your best known credential and set credentialsEvidence to "". Date: MM-DD-YYYY (or MM-YYYY / YYYY if that's all there is). If there's no person, use the organization as the author.
- If no source supports the argument, return <cards>[]</cards> and one sentence explaining why. Never invent anything.`;
}

function credentialPrompt(cards) {
  return `For each Public Forum card citation below, use WebSearch to confirm the author's credentials and the publication date. Keep it brief, with one or two searches per card.
${JSON.stringify(cards.map((c, i) => ({ index: i, author: c.cite.authorFull, credentials: c.cite.credentials, date: c.cite.date, title: c.cite.title, publication: c.cite.publication, url: c.cite.url })), null, 1)}
Return ONLY: <verify>[{"index":0,"credentialsOk":true,"credentials":"corrected credentials if wrong, else empty","dateOk":true,"date":"corrected MM-DD-YYYY if wrong, else empty","note":""}]</verify>
Use null for anything you can't confirm. Never guess.`;
}

// ---------------------------------------------------------------- marking

// 1:1 character folding (same length), so indexes in the folded string match the original.
function fold(s) {
  return s.toLowerCase().replace(/[‘’‛′`´]/g, "'").replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-').replace(/ /g, ' ');
}
function foldPhrase(s) { return fold(String(s).replace(/\s+/g, ' ').trim()).replace(/…|\.\.\./g, ''); }

// Mark phrases on a paragraph; returns markup with <u>/<h>/<b> plus how many phrases matched.
function applyMarks(text, marks) {
  const F = fold(text), L = text.length;
  const lvl = new Uint8Array(L); // 0 none, 1 underline, 2 highlight, 3 bold
  let hit = 0, miss = 0;
  const mark = (list, level) => {
    let cursor = 0;
    for (const raw of list || []) {
      if (raw === 'ALL') { if (level === 1) lvl.fill(1); hit++; continue; }
      const ph = foldPhrase(raw);
      if (!ph) continue;
      let at = F.indexOf(ph, cursor);
      if (at < 0) at = F.indexOf(ph);
      if (at < 0) { miss++; continue; }
      hit++;
      for (let i = at; i < at + ph.length; i++) lvl[i] = Math.max(lvl[i], level);
      cursor = at + ph.length;
    }
  };
  mark(marks.u, 1); mark(marks.h, 2); mark(marks.b, 3);
  let out = '', cur = 0;
  const open = ['', '<u>', '<u><h>', '<u><h><b>'], close = ['', '</u>', '</h></u>', '</b></h></u>'];
  for (let i = 0; i < L; i++) {
    if (lvl[i] !== cur) { out += close[cur] + open[lvl[i]]; cur = lvl[i]; }
    out += text[i];
  }
  out += close[cur];
  return { markup: out, hit, miss };
}

// Turn Claude's selection into a finished card using the page's real paragraphs.
// ---------------------------------------------------------------- speech modes

const RESPONSES = {
  turn: 'a TURN: evidence that the opponent\'s argument actually goes the other way (their link or impact helps OUR side)',
  delink: 'a NO LINK / DELINK: evidence that the opponent\'s causal claim is false, so the resolution doesn\'t cause their impact',
  nonunique: 'a NON-UNIQUE response: evidence that their impact is already happening (or not happening) in the status quo either way',
  mitigate: 'MITIGATION: evidence that their impact is much smaller, slower or less likely than they claim',
  impactdef: 'IMPACT DEFENSE: evidence that their terminal impact (war, collapse, etc.) would not happen',
  indict: 'an EVIDENCE INDICT / counter-study: evidence that undermines the source or reasoning they rely on',
};
const TAG_PREFIX = { turn: 'TURN — ', delink: 'No link — ', nonunique: 'Non-unique — ', mitigate: 'Mitigation — ', impactdef: 'No impact — ', indict: 'Indict — ' };

// Target reading length of the HIGHLIGHTED text, in words (PF speed ~210 words/min = 3.5 words/s).
const WPS = 3.5;
function highlightTarget(job) {
  if (job.mode === 'rebuttal') return { min: 12, max: 45 };
  return job.length === 'short' ? { min: 20, max: 60 } : job.length === 'nolimit' ? { min: 30, max: 110 } : { min: 25, max: 90 };
}

function modeBlock(job) {
  const t = highlightTarget(job);
  if (job.mode === 'rebuttal') {
    const kind = RESPONSES[job.responseType] || 'the strongest response type you can find (turn, no link, non-unique, mitigation, or impact defense)';
    return `SPEECH: REBUTTAL. The card answers this opponent argument: "${job.oppArg || job.argument}".
It must be ${kind}.
Rebuttal cards are read fast: highlight only ${t.min}-${t.max} words in total (about ${Math.round(t.min / WPS)}-${Math.round(t.max / WPS)} seconds), keeping just the warrant that beats their claim. Start the tag with the response label (for example "${TAG_PREFIX[job.responseType] || 'TURN — '}") and make it a short, direct answer to their argument.`;
  }
  return `SPEECH: CONSTRUCTIVE (case). The card is a contention or subpoint card, so it needs a full warrant: the reason, the link, and the impact.
Highlight ${t.min}-${t.max} words in total (about ${Math.round(t.min / WPS)}-${Math.round(t.max / WPS)} seconds read aloud). Write the tag as a clear case claim.`;
}

// ---------------------------------------------------------------- highlight check

// Highlighted runs in reading order; neighbouring runs separated only by spaces count as one.
function highlightRuns(paragraphs) {
  const runs = [];
  for (const p of paragraphs) {
    let h = 0, cur = '', gap = '';
    for (const part of String(p).split(/(<\/?[uhb]>)/i)) {
      const m = part.match(/^<(\/?)([uhb])>$/i);
      if (m) { if (m[2].toLowerCase() === 'h') h += m[1] ? -1 : 1; continue; }
      if (h > 0) { cur += (cur && gap ? gap : '') + part; gap = ''; }
      else if (/^\s*$/.test(part) && cur) gap += part;
      else { if (cur.trim()) runs.push(cur.trim()); cur = ''; gap = ''; }
    }
    if (cur.trim()) runs.push(cur.trim());
  }
  return runs;
}

function highlightStats(paragraphs) {
  const runs = highlightRuns(paragraphs);
  const words = runs.reduce((n, r) => n + r.split(/\s+/).filter(Boolean).length, 0);
  const tiny = runs.filter((r) => r.split(/\s+/).length <= 2).length;
  // "choppy" = lots of 1-2 word fragments, which are hard to read aloud smoothly
  const choppy = runs.length >= 5 && tiny / runs.length > 0.5;
  return { words, seconds: Math.round(words / WPS), runs: runs.length, choppy, text: runs.join(' … ') };
}

function highlightCheck(card, job) {
  const t = highlightTarget(job), st = highlightStats(card.paragraphs);
  const length = st.words < t.min ? 'short' : st.words > t.max ? 'long' : 'ok';
  return { ...st, target: t, length, ok: length === 'ok' && !st.choppy };
}

function fixHighlightPrompt(card, job, hc) {
  const { src, lo, hi } = card._p;
  const paras = [];
  for (let i = lo; i <= hi; i++) paras.push(`[P${i}] ${src.paras[i]}`);
  const problem = [hc.length === 'long' ? `It is TOO LONG to read in round (${hc.words} words highlighted).` : '', hc.length === 'short' ? `It is TOO SHORT to carry a full warrant (${hc.words} words highlighted).` : '',
    hc.choppy ? 'It is CHOPPY: too many 1-2 word fragments that don\'t read as sentences.' : ''].filter(Boolean).join(' ');
  return `You are re-highlighting a Public Forum card. ${problem}
${modeBlock(job)}
TAG: ${card.tag.replace(/<[^>]+>/g, '')}
CURRENTLY HIGHLIGHTED (read aloud): ${hc.text}

Re-mark these paragraphs so the highlighted words total ${hc.target.min}-${hc.target.max} words, read aloud as smooth, grammatical sentences that prove the tag, using phrases of 3+ words wherever possible:
${paras.join('\n')}

Every string must be copied EXACTLY from its paragraph, in order. h phrases sit inside u phrases; b words inside h phrases. Do not use tools.
Return ONLY: <fix>[{"p": ${lo}, "u": ["…"], "h": ["…"], "b": ["…"]}]</fix>`;
}

function applyFix(card, fix) {
  const { src, lo, hi } = card._p;
  const byNum = new Map((Array.isArray(fix) ? fix : []).map((p) => [parseInt(p.p), p]));
  if (!byNum.size) return false;
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(applyMarks(src.paras[i], byNum.get(i) || {}).markup);
  card.paragraphs = out;
  return true;
}

function buildCard(sel, sources) {
  const src = sources[(parseInt(sel.source) || 1) - 1];
  if (!src) return null;
  const nums = (sel.paragraphs || []).map((p) => parseInt(p.p)).filter((x) => x >= 0 && x < src.paras.length);
  if (!nums.length) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const byNum = new Map((sel.paragraphs || []).map((p) => [parseInt(p.p), p]));
  let hit = 0, miss = 0;
  const paragraphs = [];
  for (let i = lo; i <= hi && i - lo < 40; i++) { // gaps are kept as unread text, never dropped
    const r = applyMarks(src.paras[i], byNum.get(i) || {});
    hit += r.hit; miss += r.miss;
    paragraphs.push(r.markup);
  }
  const c = sel.cite || {};
  const s = (v) => String(v || '').trim();
  return {
    tag: s(sel.tag).replace(/<(?!\/?(u|b)>)[^>]*>/gi, ''),
    cite: { authorFull: s(c.authorFull), authorLast: s(c.authorLast) || s(c.authorFull).split(/\s+/).pop(), credentials: s(c.credentials),
      credentialsEvidence: s(c.credentialsEvidence), date: s(c.date), title: s(c.title), publication: s(c.publication), url: src.url },
    paragraphs,
    _src: src, _marks: { hit, miss }, _p: { src, lo, hi: Math.min(hi, lo + 39) },
  };
}

// ---------------------------------------------------------------- checks (no Claude needed)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function datePatterns(mdy) {
  const m = String(mdy).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return [];
  const [mm, dd, yy] = [+m[1], +m[2], m[3]], mon = MONTHS[mm - 1] || '', sh = mon.slice(0, 3);
  const p2 = (x) => String(x).padStart(2, '0');
  return [`${mon} ${dd}, ${yy}`, `${dd} ${mon} ${yy}`, `${sh} ${dd}, ${yy}`, `${sh}. ${dd}, ${yy}`, `${dd} ${sh} ${yy}`,
    `${yy}-${p2(mm)}-${p2(dd)}`, `${p2(mm)}/${p2(dd)}/${yy}`, `${mm}/${dd}/${yy}`, `${yy}/${p2(mm)}/${p2(dd)}`];
}
function toMDY(iso) { const m = String(iso).match(/(\d{4})[-/](\d{2})[-/](\d{2})/); return m ? `${m[2]}-${m[3]}-${m[1]}` : ''; }
const norm = (s) => fold(String(s || '')).replace(/\s+/g, ' ').trim();

function checkCard(card) {
  const src = card._src, page = norm(src.text), meta = src.meta || {}, ci = card.cite;
  const items = [], fixes = [], notes = [];
  const add = (label, state, note) => items.push({ label, state, note: note || '' });

  add('URL works', src.fromBrowser ? true : src.ok, src.fromBrowser ? 'You were on this page in your browser' : `HTTP ${src.status}`);
  add('Text verbatim', true, src.fromBrowser ? 'Copied from your browser' : 'Taken straight from the page');
  if (card._marks.miss) notes.push(`${card._marks.miss} highlight phrase(s) didn't match and were skipped. Glance at the highlighting.`);

  // author
  if (!ci.authorFull && meta.author) { ci.authorFull = meta.author; ci.authorLast = meta.author.split(/\s+/).pop(); fixes.push(`author filled from page: ${meta.author}`); }
  const last = norm(ci.authorLast);
  add('Author', !ci.authorFull ? false : (last && (page.includes(last) || norm(meta.author).includes(last))) ? true : null,
    meta.author ? `Page says: ${meta.author}` : '');

  // date
  const metaDate = toMDY(meta.published);
  if (!ci.date && metaDate) { ci.date = metaDate; fixes.push(`date filled from page: ${metaDate}`); }
  let dateOk = null;
  if (!ci.date) dateOk = false;
  else if (metaDate) dateOk = metaDate === ci.date;
  else if (datePatterns(ci.date).some((p) => page.includes(p))) dateOk = true;
  if (dateOk === false && metaDate && ci.date !== metaDate) {
    const visible = datePatterns(ci.date).some((p) => page.includes(p));
    if (!visible) { fixes.push(`date: “${ci.date}” → “${metaDate}” (page metadata)`); ci.date = metaDate; dateOk = true; }
    else { dateOk = null; notes.push(`Page metadata says ${metaDate}, but the article text shows ${ci.date}. One may be the updated date.`); }
  }
  add('Date', dateOk);
  if (card._range && (card._range.from || card._range.to)) {
    const ok = inRange(ci.date, card._range.from, card._range.to);
    add('In your date range', ok, ok === false ? `${ci.date} is outside the range you picked` : ok === null ? 'No exact date to compare' : '');
  }

  // title
  const t = norm(ci.title);
  if (!t && meta.title) { ci.title = meta.title.split(/\s+[|–—-]\s+/)[0]; fixes.push('title filled from page'); }
  add('Title', !ci.title ? false : (norm(meta.title).includes(norm(ci.title)) || page.includes(norm(ci.title))) ? true : null);

  // publication
  let host = ''; try { host = new URL(ci.url).hostname.replace(/^www\./, ''); } catch {}
  const pub = norm(ci.publication);
  const pubOk = !ci.publication ? false : (norm(meta.siteName).includes(pub) || pub.includes(norm(meta.siteName) || '\u0000') ||
    host.replace(/[^a-z]/g, '').includes(pub.replace(/[^a-z]/g, '').slice(0, 6)) || page.includes(pub)) ? true : null;
  add('Publication', pubOk);

  // credentials
  const ev = norm(ci.credentialsEvidence);
  add('Credentials', !ci.credentials ? false : ev && page.includes(ev) ? true : null, ev ? '' : 'Not stated in the article');

  for (const f of ['authorFull', 'date', 'title', 'publication', 'url']) if (!ci[f]) notes.push(`Missing ${f}`);
  return { items, fixes, notes };
}

function grade(check) {
  const bad = check.items.some((i) => i.state === false) || check.notes.some((n) => n.startsWith('Missing'));
  const unsure = check.items.some((i) => i.state === null);
  check.status = bad ? 'fail' : unsure ? 'review' : 'verified';
  return check;
}

module.exports = { highlightCheck, fixHighlightPrompt, applyFix, highlightStats, modeBlock, inRange, rangeText, articleView, searchPrompt, cutPrompt, credentialPrompt, buildCard, checkCard, grade, toParagraphs, applyMarks };
