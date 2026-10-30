// Prep writer: frontlines, extensions, weighing and ballot directives, written in the user's own voice.
// Claude only gets the arguments and cards the user gives it, and every result is checked for
// AI filler phrasing and for authors that aren't in the user's cards.
'use strict';

// The user's own prep from last topic. Claude copies the voice, never the content.
const STYLE = `STYLE EXAMPLES (from the user's old data-center topic: copy the VOICE and FORMAT, never the content)

Extension:
Extend: Deterrence
America's expansion of hyperscale data centers is key to US deterrence through data processing superiority. A moratorium would DECK data center growth destroying key technologies, connections, and processes. That gives China a window to invade Taiwan as it's UNIQUE situation now due to China being in a staggering economy. That goes nuclear due to pressure on both sides to use it or lose it to deter.

Extension:
Extend: Offshoring
A moratorium wouldn't stop hyperscale expansion, it would just shift it to other locations with weaker protections. History shows, Singapore put in a moratorium and data center projects are lagging and companies such as Meta have already shown its capabilities to easily shift its operations.

Weighing:
Weighing: Economy
Weighing:
(a) - Magnitude + Scope: An economic shock puts 900 million people into devastating, and gruesome poverty. This outweighs because [...]
(b) - Timeframe + Probability: A moratorium would immediately signal investors to pull out, we've seen this in the past with Ireland's moratorium on data centers. This outweighs because [...]

Frontline (short form):
FL2: AUKUS Does NOT mention hyperscale (no link)
● Fundamentally misunderstand case, Van Der Schyff 25 states AUKUS pillar 2 is fundamentally dependant on Hyperscale Infra
FL2: Australia and the UK solve, US not needed
● DiFiore '25- US leads in AUKUS tech capabilities, Australia and UK remain underdeveloped and non self sufficient

Frontline (card tags):
AT: US Deterrence Weak
It's enough to make the costs of victory too high for China. The last 70 years prove.
Trump's use of force is strengthening deterrence.`;

const VOICE = `VOICE RULES (this must sound like a high-school PF debater's own prep, not an AI)
- Short, blunt sentences. Debate shorthand is good: "That goes nuclear", "the link is", "turn", "no link", "non-unique", "outweighs", "prereq", "squo".
- Caps for one or two key words is fine (UNIQUE, DECK). No exclamation marks, no rhetorical questions, no hedging.
- Never use: delve, tapestry, landscape, crucial, pivotal, robust, furthermore, moreover, additionally, notably, "in conclusion", "it is important to note", "plays a key role", underscore, multifaceted, paramount, realm, navigate, leverage, testament, holistic, "not only ... but also", "it's not just X, it's Y".
- No intro or outro sentences. Start with the argument.
- Write only the finished prep. Never comment on your own writing, correct yourself, or leave notes like "wrong cite" or "use X instead".
- FACTS: only use numbers, events and author names that appear in the user's input, their uploaded files, or the cards below. If you need one you don't have, write [stat] or [card] so the user fills it in. Cite cards as Lastname YY, exactly as listed.`;

const MECHS = {
  magnitude: 'Magnitude', scope: 'Scope', timeframe: 'Timeframe', probability: 'Probability',
  reversibility: 'Reversibility', link: 'Strength of link', prereq: 'Prerequisite', shortcircuit: 'Short-circuit',
};

function cardBrief(cards) {
  if (!cards.length) return 'CARDS: none given. Do not name any authors.';
  return 'CARDS THE USER HAS (the only authors you may name):\n' + cards.map((c) => {
    const yy = (String(c.cite?.date || '').match(/(\d{4})/) || ['', ''])[1].slice(2) || 'ND';
    const read = (c.paragraphs || []).join(' ').match(/<h>[\s\S]*?<\/h>/g)?.map((x) => x.replace(/<[^>]+>/g, '')).join(' ') || '';
    return `- ${c.cite?.authorLast || '?'} ${yy}: TAG "${String(c.tag || '').replace(/<[^>]+>/g, '')}" READS "${read.slice(0, 600)}"`;
  }).join('\n');
}

const SHAPE = `Return ONLY strict JSON inside <prep></prep>:
<prep>{"sections": [{"heading": "...", "lead": "", "style": "para|lettered|bullets|tags", "items": [{"label": "", "text": "..."}]}]}</prep>`;

const ROLE_NAME = { mine: 'MY CASE', theirs: 'THEIR CASE', flow: 'THEIR RESPONSES / MY FLOW', style: 'MY OLD PREP', notes: 'MY NOTES' };
const TOTAL_UPLOAD_CHARS = 90000;

function uploadBlock(uploads) {
  let left = TOTAL_UPLOAD_CHARS;
  const parts = [];
  for (const u of uploads.filter((x) => x.role !== 'style')) {
    const t = String(u.text || '').slice(0, Math.max(0, left));
    left -= t.length;
    if (t) parts.push(`=== ${ROLE_NAME[u.role] || 'FILE'}: ${u.name} ===\n${t}`);
  }
  return parts.length ? `FILES THE USER UPLOADED (use them: their contentions, cards, author names and wording):\n${parts.join('\n\n')}\n` : '';
}
function styleBlock(uploads) {
  const own = uploads.filter((x) => x.role === 'style').map((u) => String(u.text || '').slice(0, 6000)).join('\n\n');
  return own ? `THE USER'S OWN PREP (copy THIS voice and format first):\n${own}\n\n${STYLE}` : STYLE;
}
// Author-year names cited in uploaded files (e.g. "Henley 23", "DiFiore '25") count as real cards.
function uploadNames(uploads) {
  const out = new Set();
  for (const u of uploads || []) for (const m of String(u.text || '').matchAll(/\b([A-Z][A-Za-z'-]+) ?['’]?(\d{2})\b/g)) out.add(`${m[1].toLowerCase()} ${m[2]}`);
  return out;
}

function prepPrompt(job, cards) {
  const uploads = job.uploads || [];
  const has = (...roles) => uploads.some((u) => roles.includes(u.role));
  const ours = String(job.ours || '').trim() || (has('mine', 'notes') ? '(use the contentions/arguments in MY CASE above)' : '');
  const theirs = String(job.theirs || '').trim() || (has('theirs', 'flow') ? '(take them from THEIR CASE / THEIR RESPONSES above)' : '');
  const head = `You are writing Public Forum prep for the ${job.side || 'user\'s'} side.\nTOPIC: ${job.topic}\n${cardBrief(cards)}\n${uploadBlock(uploads)}`;
  let task = '';
  if (job.kind === 'extension') {
    task = `Write one extension per argument below, for the ${job.speech === 'ff' ? 'FINAL FOCUS (2-3 sentences each, tight)' : 'SUMMARY (3-5 sentences each)'}.
Each extension walks the full chain: uniqueness if relevant, link, internal link, impact. Name the card that proves a step when the user has one (e.g. "Henley 23 says...").
ARGUMENTS (one per line, "Name: what it says"):\n${ours}
FORMAT: one section per argument, heading "Extend: <Name>", style "para", one item with the paragraph.`;
  } else if (job.kind === 'weighing') {
    const mechs = (job.mechs || []).map((m) => MECHS[m]).filter(Boolean);
    task = `Write a weighing template for each of our impacts below.${theirs ? `\nTHEIR IMPACTS TO WEIGH AGAINST:\n${theirs}` : ''}
OUR IMPACTS (one per line, "Name: what it says"):\n${ours}
Use these mechanisms${mechs.length ? `: ${mechs.join(', ')}` : ' (pick the 2 strongest; combine two in one line like "Timeframe + Probability")'}. Two lines per impact.
Each line: "- <Mechanism>: <why our impact wins on it, concrete>." then ${job.fill && theirs ? '"This outweighs because <direct comparison to their impact>."' : '"This outweighs because [...]" left exactly like that for the user to fill in round.'}
FORMAT: one section per impact, heading "Weighing: <Name>", lead "Weighing:", style "lettered", items with label = mechanism(s) and text = the rest of the line (without the "- Mechanism:" part).`;
  } else if (job.kind === 'frontline') {
    task = `Write a frontline (prepared answers) defending this argument of ours:\n${ours}
THEIR RESPONSES TO IT (one per line):\n${theirs}
For each response give 2-3 answers. Mix types: no link / delink, non-unique, turn, mitigation, or "they misread our case". Each answer is one line: the warrant, plus the card that proves it if the user has one ("DiFiore '25- ..."). Don't repeat the same answer under two responses.
FORMAT: one section per response, in the same order, heading "FL: <their response, short>", style "bullets", items with label = answer type (e.g. "No link") and text = the line.`;
  } else if (job.kind === 'ballot') {
    task = `Write ballot directive language for the ${job.speech === 'ff' ? 'final focus' : 'summary'}: the lines that tell the judge exactly where to look first and why we win.
OUR ARGUMENTS:\n${ours}${theirs ? `\nTHEIR ARGUMENTS:\n${theirs}` : ''}${job.frame ? `\nFRAMING TO PUSH: ${job.frame}` : ''}
Write 5-7 lines: the first-look line ("The first thing you look to on this ballot is..."), an if-then line ("If we're winning X, you vote ${job.side || 'for us'} because..."), a line that tells the judge to prefer our weighing and why, a line on what they dropped or conceded (use [what they dropped] if unknown), and a closing vote line. Plain, confident, like you're talking to a lay judge.
FORMAT: one section, heading "Ballot: ${job.title || 'Directives'}", style "bullets", items with label "" and text = each line.`;
  } else throw new Error('Unknown prep type');
  return `${head}\n${styleBlock(uploads)}\n\n${VOICE}\n\nTASK\n${task}\n\n${SHAPE}`;
}

// ---------------------------------------------------------------- checks

const SLOP = [/\bdelv(e|es|ing)\b/i, /\btapestry\b/i, /\blandscape\b/i, /\bcrucial(ly)?\b/i, /\bpivotal\b/i, /\brobust\b/i, /\bfurthermore\b/i,
  /\bmoreover\b/i, /\badditionally\b/i, /\bnotably\b/i, /\bin conclusion\b/i, /\bit(?:'s| is) important to note\b/i, /\bplays? a (?:key|vital|crucial|critical) role\b/i,
  /\bunderscor(e|es|ing)\b/i, /\bmultifaceted\b/i, /\bparamount\b/i, /\brealm\b/i, /\bnavigat(e|ing)\b/i, /\bleverag(e|es|ing)\b/i, /\btestament\b/i,
  /\bholistic\b/i, /\bnot only\b[^.]*\bbut also\b/i, /\bit'?s not just\b/i, /\bever-evolving\b/i, /\bin today'?s\b/i, /\bseamless(ly)?\b/i, /\bshowcas(e|es|ing)\b/i];

function allText(prep) { return (prep.sections || []).flatMap((s) => [s.heading, s.lead, ...(s.items || []).flatMap((i) => [i.label, i.text])]).filter(Boolean).join('\n'); }

function slopHits(prep) {
  const t = allText(prep), hits = [];
  for (const re of SLOP) { const m = t.match(re); if (m) hits.push(m[0]); }
  if ((t.match(/—/g) || []).length > 3) hits.push('too many em dashes');
  if (/[!?]\s*$/m.test(t)) hits.push('exclamation or rhetorical question');
  return hits;
}

const yyOf = (c) => (String(c.cite?.date || '').match(/(\d{4})/) || ['', ''])[1].slice(2);

// Author-year mentions (Henley 23, DiFiore '25) that don't match one of the user's cards, name AND year.
function unknownAuthors(prep, cards, uploads = []) {
  const known = new Set([...cards.map((c) => `${String(c.cite?.authorLast || '').toLowerCase()} ${yyOf(c)}`), ...uploadNames(uploads)]);
  const out = new Set();
  for (const m of allText(prep).matchAll(/\b([A-Z][A-Za-z'-]+(?: [A-Z][A-Za-z'-]+){0,2}) ?['’]?(\d{2})\b/g)) {
    const last = m[1].split(' ').pop().toLowerCase();
    if (/^(fl|at|pillar|article|section|covid|top|g|f|b|ch|ff)$/i.test(last)) continue;
    if (!known.has(`${last} ${m[2]}`)) out.add(`${m[1].split(' ').pop()} ${m[2]}`);
  }
  return [...out];
}

// Everything that needs one rewrite: AI phrasing, self-commentary, wrong card names, extensions that run long.
function problems(prep, cards, job) {
  const issues = slopHits(prep).map((h) => `the phrase "${h}"`);
  const t = allText(prep);
  if (/\b(wrong cite|use [A-Z][a-z]+ \d{2} instead|as an ai|i (?:can't|cannot) |note to self)\b/i.test(t)) issues.push('notes or self-corrections in the text');
  const bad = unknownAuthors(prep, cards, job.uploads);
  if (bad.length) issues.push(`card names that don't exist: ${bad.join(', ')} (use only names from the cards or the uploaded files: ${cards.map((c) => `${c.cite?.authorLast} ${yyOf(c)}`).join(', ') || 'see files'})`);
  if (job.kind === 'extension') {
    const max = job.speech === 'ff' ? 3 : 5;
    for (const s of prep.sections || []) {
      const n = (s.items || []).reduce((k, i) => k + (i.text.match(/[^.!?]+[.!?]+/g) || [i.text]).length, 0);
      if (n > max) issues.push(`"${s.heading}" is ${n} sentences; cut it to ${max} or fewer, keeping the link chain and impact`);
    }
  }
  return issues;
}

function rewritePrompt(prep, issues) {
  return `Fix this Public Forum prep. Problems: ${issues.join('; ')}. Change nothing else: same sections, same arguments, same facts, same JSON shape. Keep it sounding like a debater wrote it.
${VOICE}
<prep>${JSON.stringify(prep)}</prep>
${SHAPE}`;
}

function clean(prep) {
  const s = (v) => String(v ?? '').replace(/<[^>]+>/g, '').trim();
  return { sections: (Array.isArray(prep?.sections) ? prep.sections : []).map((x) => ({
    heading: s(x.heading), lead: s(x.lead), style: ['para', 'lettered', 'bullets', 'tags'].includes(x.style) ? x.style : 'bullets',
    items: (Array.isArray(x.items) ? x.items : []).map((i) => ({ label: s(i.label), text: s(i.text) })).filter((i) => i.text),
  })).filter((x) => x.heading || x.items.length) };
}

module.exports = { prepPrompt, rewritePrompt, slopHits, unknownAuthors, problems, clean, MECHS };
