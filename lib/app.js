// Negi — PF card cutter. Local server that drives the Claude Code CLI
// (your logged-in subscription, no API key) and verifies every card it cuts.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const { fetchPage } = require('./page');
const cutter = require('./cutter');
const updater = require('./updater');
const saves = require('./saves');
const prep = require('./prep');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const KNOWLEDGE = () => fs.readFileSync(path.join(ROOT, 'knowledge', 'pf-knowledge.md'), 'utf8');
const WORKDIR = path.join(ROOT, '.claude-work');
fs.mkdirSync(WORKDIR, { recursive: true });

// On Windows, "claude" is usually a .cmd shim, and running it through cmd.exe mangles
// quoted arguments. Find the real .exe or cli.js behind it and run that directly.
function resolveClaude() {
  if (process.platform !== 'win32') return { cmd: config.claudePath, pre: [], shell: false };
  if (config.claudePath !== 'claude') return { cmd: config.claudePath, pre: [], shell: /\.(cmd|bat)$/i.test(config.claudePath) };
  try {
    const hits = execSync('where claude', { encoding: 'utf8' }).split(/\r?\n/).map((h) => h.trim()).filter(Boolean);
    const exe = hits.find((h) => /\.exe$/i.test(h));
    if (exe) return { cmd: exe, pre: [], shell: false };
    const shim = hits.find((h) => /\.cmd$/i.test(h));
    if (shim) {
      const m = fs.readFileSync(shim, 'utf8').match(/"%~?dp0%?\\([^"]+\.(?:js|exe))"/i);
      if (m) {
        const target = path.join(path.dirname(shim), m[1]);
        return /\.js$/i.test(target) ? { cmd: process.execPath, pre: [target], shell: false } : { cmd: target, pre: [], shell: false };
      }
    }
  } catch {}
  return { cmd: 'claude', pre: [], shell: true };
}

const DEFAULT_CONFIG = {
  port: 4747,
  initials: '',
  model: 'sonnet',      // sonnet uses far fewer credits than opus and cuts cards well
  deepCheck: true,      // web-check credentials only when the article doesn't state them
  hlColor: '#00FF00', font: 'Calibri', tagPt: 13, readPt: 11, smallPt: 8,
  claudePath: 'claude',
  autoUpdate: true,     // install updates by itself when Negi isn't busy
  updateRepo: 'samuelsortland-cmyk/negi-card-cutter',
  topic: 'Resolved: European members of the North Atlantic Treaty Organization should ratify the Treaty on the Prohibition of Nuclear Weapons.',
};
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
let config = loadConfig();
function saveConfig(patch) {
  const allowed = ['initials', 'model', 'topic', 'claudePath', 'deepCheck', 'autoUpdate', 'hlColor', 'font', 'tagPt', 'readPt', 'smallPt'];
  for (const k of allowed) if (k in patch) config[k] = patch[k];
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------- Claude CLI

function runClaude({ prompt, tools, onEvent, signal, systemAppend, model }) {
  return new Promise((resolve, reject) => {
    // The prompt goes in over stdin, so long multi-line text is safe on Windows cmd too.
    // --tools limits Claude to exactly these tools (no PowerShell/Bash/file access); --strict-mcp-config and
    // --setting-sources skip your plugins, MCP servers and hooks, so each call starts faster and costs less.
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--tools', tools.join(','),
      '--strict-mcp-config', '--setting-sources', 'project'];
    if (tools.length) args.push('--allowedTools', tools.join(','));
    if (model || config.model) args.push('--model', model || config.model);

    // Force the CLI to use your Claude login, never an API key.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    if (config.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = config.oauthToken;

    const bin = resolveClaude();
    const child = spawn(bin.cmd, [...bin.pre, ...args], { cwd: WORKDIR, env, shell: bin.shell, windowsHide: true });
    child.stdin.end(systemAppend ? `<background_knowledge>\n${systemAppend}\n</background_knowledge>\n\n${prompt}` : prompt);
    let buf = '', result = null, stderr = '';
    const kill = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', kill);

    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'result') result = ev;
        else onEvent?.(ev);
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(new Error(
      e.code === 'ENOENT' ? `Couldn't find the Claude Code CLI ("${config.claudePath}"). Install it and run "claude" once to log in.` : e.message)));
    child.on('close', (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new Error('Cancelled'));
      if (!result) return reject(new Error(`Claude exited (${code}). ${stderr.slice(-500)}`));
      if (result.is_error) return reject(new Error(result.result || 'Claude returned an error'));
      resolve(result.result || '');
    });
  });
}

// Turn Claude's tool calls into cute progress lines for the pet.
function describeEvent(ev) {
  if (ev.type !== 'assistant') return null;
  const out = [];
  for (const c of ev.message?.content || []) {
    if (c.type !== 'tool_use') continue;
    const i = c.input || {};
    if (c.name === 'WebSearch') out.push({ kind: 'search', text: `Searching: “${i.query}”` });
    else if (c.name === 'WebFetch') out.push({ kind: 'read', text: `Reading ${shortUrl(i.url)}`, url: i.url });
    else if (c.name !== 'ToolSearch') out.push({ kind: 'tool', text: c.name });
  }
  return out;
}
function shortUrl(u) { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + x.pathname.slice(0, 40); } catch { return String(u).slice(0, 60); } }

function extractTagged(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  let body = m ? m[1] : text;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1];
  const start = body.search(/[\[{]/);
  if (start < 0) throw new Error('No JSON found in Claude output');
  return JSON.parse(body.slice(start, Math.max(body.lastIndexOf(']'), body.lastIndexOf('}')) + 1));
}

// ---------------------------------------------------------------- Prompts

// ---------------------------------------------------------------- Jobs

// Inbox: pages sent from your browser by the bookmarklet (full text, even paywalled pages you're logged into).
const inbox = new Map();

async function loadSource(url) {
  try {
    const p = await fetchPage(url, 20000);
    if (!p.ok || p.type.includes('pdf') || p.text.length < 1200) return { url, ok: false, status: p.status, why: !p.ok ? `HTTP ${p.status}` : p.type.includes('pdf') ? 'PDF' : 'page needs JavaScript or a login' };
    return { url: p.finalUrl || url, ok: true, status: p.status, text: p.text, meta: p.meta };
  } catch (e) { return { url, ok: false, why: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message) }; }
}

async function cutJob(job, send, signal) {
  job.topic = job.topic || config.topic;
  const n = Math.min(Math.max(parseInt(job.count) || 1, 1), 5);
  let sources = [];

  if (job.inboxId && inbox.has(job.inboxId)) {
    const it = inbox.get(job.inboxId);
    sources = [{ url: it.url, ok: true, status: 200, text: it.text, meta: it.meta, fromBrowser: true }];
    send({ type: 'log', kind: 'read', text: `Using the page you sent from your browser: ${it.title || it.url}` });
  } else if (job.url) {
    send({ type: 'state', state: 'searching', say: 'Ooh, reading the page you gave me!' });
    const s = await loadSource(job.url);
    if (!s.ok) throw new Error(`I couldn't read that page by myself (${s.why}). Open it in your browser and click the "✂️ Cut with Negi" bookmark, and I'll take the text straight from your browser.`);
    if (cutter.inRange(s.meta?.published, job.dateFrom, job.dateTo) === false)
      throw new Error(`That article was published ${String(s.meta.published).slice(0, 10)}, which is outside your date range (${cutter.rangeText(job.dateFrom, job.dateTo)}). Change "Published" to "Any time" to cut it anyway.`);
    sources = [s];
    send({ type: 'log', kind: 'read', text: `Read ${shortUrl(s.url)} (${s.text.length.toLocaleString()} characters)` });
  } else {
    if (!job.argument && !(job.mode === 'rebuttal' && job.oppArg)) throw new Error(job.mode === 'rebuttal' ? 'Tell me the opponent argument you want to answer.' : 'Tell me what the card should prove, or give me a URL.');
    send({ type: 'state', state: 'searching', say: 'Searching for evidence~ 🔍' });
    const tried = [], need = n + 1; // one spare in case an article turns out weak
    for (let round = 1; round <= 3 && sources.length < need; round++) {
      // NEGI_TEST_URLS (comma-separated) skips the web search, for testing with local articles.
      const raw = process.env.NEGI_TEST_URLS ? (round > 1 ? '' : `<urls>${JSON.stringify(process.env.NEGI_TEST_URLS.split(','))}</urls>`)
        : await runClaude({ prompt: cutter.searchPrompt(job, n + 5, tried), signal, tools: ['WebSearch'],
          onEvent: (ev) => { for (const d of describeEvent(ev) || []) send({ type: 'log', ...d }); } });
      let found = [];
      try { found = extractTagged(raw, 'urls'); } catch {}
      const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
      const seenHost = new Set(sources.map((x) => host(x.url)));
      const picks = [];
      for (const f of Array.isArray(found) ? found : []) {
        const url = typeof f === 'string' ? f : f?.url;
        if (!/^https?:\/\//.test(url || '') || seenHost.has(host(url))) continue; // one article per website
        seenHost.add(host(url));
        picks.push({ url, angle: typeof f === 'object' ? String(f.angle || '') : '' });
      }
      if (!picks.length) break;
      const urls = picks.slice(0, n + 6).map((p) => p.url);
      send({ type: 'log', kind: 'read', text: `Downloading ${urls.length} articles from ${urls.length} different sites (no credits used)…` });
      const got = await Promise.all(picks.slice(0, n + 6).map(async (p) => ({ ...(await loadSource(p.url)), angle: p.angle })));
      for (const g of got) {
        send({ type: 'log', kind: g.ok ? 'read' : 'warn', text: g.ok ? `Read ${shortUrl(g.url)}` : `Skipped ${shortUrl(g.url)} (${g.why})` });
        if (!g.ok) { try { tried.push(new URL(g.url).hostname.replace(/^www\./, '')); } catch {} }
      }
      for (const g of got.filter((x) => x.ok)) {
        if (cutter.inRange(g.meta?.published, job.dateFrom, job.dateTo) === false) {
          send({ type: 'log', kind: 'warn', text: `Skipped ${shortUrl(g.url)} (published ${String(g.meta.published).slice(0, 10)}, outside your date range)` });
          continue;
        }
        sources.push(g);
      }
      if (sources.length < need && round === 1) send({ type: 'log', kind: 'search', text: 'Not enough readable articles yet, so I\'m searching for a few more…' });
    }
    if (sources.length < n) send({ type: 'log', kind: 'warn', text: `Only ${sources.length} article(s) would download, so some cards will share an article.` });
    if (!sources.length) throw new Error('None of the articles I found would download. Open a good article in your browser and click the "✂️ Cut with Negi" bookmark, and I\'ll cut it from there.');
  }

  send({ type: 'state', state: 'cutting', say: 'Cutting & highlighting… ✂️' });
  const cutFrom = async (list, count, angle) => {
    const views = list.map((x, i) => { const v = cutter.articleView(x, i + 1); x.paras = v.paras; return v; }); // numbered per call
    const raw = await runClaude({ prompt: cutter.cutPrompt(job, views, count, angle), signal, tools: [], systemAppend: KNOWLEDGE() });
    fs.writeFileSync(path.join(WORKDIR, 'last-cut-raw.txt'), raw);
    let picks;
    try { picks = extractTagged(raw, 'cards'); } catch { return { cards: [], why: 'Claude replied in the wrong format.' }; }
    if (picks && !Array.isArray(picks)) picks = Array.isArray(picks.cards) ? picks.cards : [picks];
    return { cards: picks.map((p) => cutter.buildCard(p, list)).filter(Boolean), why: raw.replace(/<cards>[\s\S]*<\/cards>/, '').trim() };
  };

  let cards = [], why = '';
  if (sources.length >= n && sources.length > 1) {
    // Variety: every card comes from a different article. Each article is cut in its own call, all at once.
    let queue = sources.slice(), round = 0;
    while (cards.length < n && queue.length && round++ < 3) {
      const batch = queue.splice(0, n - cards.length);
      send({ type: 'log', kind: 'done', text: `Cutting ${batch.length} article(s) at the same time…` });
      const results = await Promise.all(batch.map((src) => cutFrom([src], 1, src.angle)));
      results.forEach((r, i) => {
        if (r.cards.length) cards.push(r.cards[0]);
        else { why = r.why; send({ type: 'log', kind: 'warn', text: `${shortUrl(batch[i].url)} didn't have a good card, so I'm trying the next article.` }); }
      });
    }
  } else {
    const r = await cutFrom(sources, n); // one article: cards come from different parts of it
    cards = r.cards; why = r.why;
  }
  // never return the same passage twice
  const key = (c) => c.cite.url + '|' + c.paragraphs[0]?.replace(/<[^>]+>/g, '').slice(0, 80);
  cards = cards.filter((c, i, all) => all.findIndex((d) => key(d) === key(c)) === i);
  if (!cards.length) throw new Error('No card. Negi says: ' + (why || 'none of the articles proved that argument.').slice(0, 400));

  // Reading-length check: highlighting must be readable in round, not too long or too short for the speech.
  // Cards that miss get one automatic re-highlight (only those cards, all at once).
  send({ type: 'log', kind: 'done', text: 'Checking how long each card takes to read…' });
  const needFix = cards.map((cd) => ({ cd, hc: cutter.highlightCheck(cd, job) })).filter((x) => !x.hc.ok);
  if (needFix.length) {
    send({ type: 'log', kind: 'done', text: `Re-highlighting ${needFix.length} card(s) to hit the right length…` });
    await Promise.all(needFix.map(async ({ cd, hc }) => {
      try {
        const fix = extractTagged(await runClaude({ prompt: cutter.fixHighlightPrompt(cd, job, hc), signal, tools: [] }), 'fix');
        const before = cd.paragraphs;
        if (cutter.applyFix(cd, fix)) {
          const after = cutter.highlightCheck(cd, job);
          // keep whichever version is closer to the target
          const miss = (h) => (h.length === 'ok' ? 0 : h.length === 'long' ? h.words - h.target.max : h.target.min - h.words) + (h.choppy ? 15 : 0);
          if (miss(after) <= miss(hc)) cd._fixNote = `Highlighting adjusted: ${hc.words} → ${after.words} words`;
          else cd.paragraphs = before;
        }
      } catch (e) { send({ type: 'log', kind: 'warn', text: 'Re-highlight skipped: ' + e.message.slice(0, 100) }); }
    }));
  }
  if (job.mode === 'rebuttal' && job.responseType) { // make sure the tag carries the response label
    const pre = { turn: 'TURN — ', delink: 'No link — ', nonunique: 'Non-unique — ', mitigate: 'Mitigation — ', impactdef: 'No impact — ', indict: 'Indict — ' }[job.responseType];
    for (const cd of cards) if (pre && !cd.tag.replace(/<[^>]+>/g, '').toLowerCase().startsWith(pre.split(' ')[0].toLowerCase())) cd.tag = pre + cd.tag;
  }

  send({ type: 'state', state: 'verifying', say: 'Double-checking authors, dates & text… 🧐' });
  for (const card of cards) {
    card._range = { from: job.dateFrom, to: job.dateTo };
    card.check = cutter.checkCard(card);
    const hc = cutter.highlightCheck(card, job);
    card.read = { words: hc.words, seconds: hc.seconds };
    card.check.items.push({ label: 'Reading length', state: hc.length === 'ok' ? true : null,
      note: `${hc.words} words highlighted, about ${hc.seconds}s to read (target ${hc.target.min}-${hc.target.max} words for ${job.mode === 'rebuttal' ? 'rebuttal' : 'constructive'})` });
    card.check.items.push({ label: 'Reads smoothly', state: hc.choppy ? null : true, note: hc.choppy ? 'Lots of 1-2 word fragments. Read it once out loud before using it.' : '' });
    if (card._fixNote) card.check.fixes.push(card._fixNote);
  }
  if (job.dateFrom || job.dateTo) { // drop cards that clearly fall outside the range you asked for
    const kept = cards.filter((c) => c.check.items.find((i) => i.label === 'In your date range')?.state !== false);
    if (kept.length < cards.length) send({ type: 'log', kind: 'warn', text: `Removed ${cards.length - kept.length} card(s) dated outside your range.` });
    if (!kept.length) throw new Error(`Every card I cut was outside your date range (${cutter.rangeText(job.dateFrom, job.dateTo)}). Try a wider range.`);
    cards = kept;
  }

  // Only cards whose credentials or date couldn't be confirmed from the page get a (small) web check.
  const unsure = cards.filter((c) => c.check.items.some((i) => (i.label === 'Credentials' || i.label === 'Date') && i.state !== true));
  if (config.deepCheck && unsure.length) {
    send({ type: 'log', kind: 'search', text: `Web-checking credentials for ${unsure.length} card(s)…` });
    try {
      const v = extractTagged(await runClaude({ prompt: cutter.credentialPrompt(unsure), signal, tools: ['WebSearch'],
        onEvent: (ev) => { for (const d of describeEvent(ev) || []) send({ type: 'log', ...d, text: 'Verify · ' + d.text }); } }), 'verify');
      for (const r of Array.isArray(v) ? v : []) {
        const card = unsure[r.index]; if (!card) continue;
        const set = (label, state, note) => { const it = card.check.items.find((i) => i.label === label); if (it && it.state !== false) { it.state = state; if (note) it.note = note; } };
        if (r.credentialsOk === true) set('Credentials', true, 'Confirmed by web search');
        else if (r.credentialsOk === false && r.credentials) { card.check.fixes.push(`credentials: “${card.cite.credentials}” → “${r.credentials}”`); card.cite.credentials = r.credentials; set('Credentials', true, 'Corrected from web search'); }
        if (r.dateOk === true) set('Date', true, 'Confirmed by web search');
        else if (r.dateOk === false && /^\d{2}-\d{2}-\d{4}$/.test(r.date || '')) { card.check.fixes.push(`date: “${card.cite.date}” → “${r.date}”`); card.cite.date = r.date; set('Date', true, 'Corrected from web search'); }
        if (r.note) card.check.notes.push(r.note);
      }
    } catch (e) { send({ type: 'log', kind: 'warn', text: 'Web check skipped: ' + e.message.slice(0, 120) }); }
  }

  cards = cards.map((card, i) => {
    const { _src, _marks, _range, _p, _fixNote, ...clean } = card;
    cutter.grade(clean.check);
    return { ...clean, id: Date.now().toString(36) + i, side: job.side || '', mode: job.mode === 'rebuttal' ? 'Rebuttal' : 'Constructive', cutAt: new Date().toISOString() };
  });
  const ok = cards.filter((c) => c.check.status === 'verified').length;
  send({ type: 'cards', cards });
  send({ type: 'state', state: ok === cards.length ? 'happy' : 'worried',
    say: ok === cards.length ? `All ${cards.length} card(s) verified and ready to paste! ✨` : `${ok}/${cards.length} fully verified. Check the flagged ones! 💦` });
}

async function prepJob(job, send, signal) {
  job.topic = job.topic || config.topic;
  job.uploads = (Array.isArray(job.uploads) ? job.uploads : []).map((u) => ({ name: String(u.name || 'file').slice(0, 120), role: String(u.role || 'mine'), text: String(u.text || '').slice(0, 40000) }));
  const up = (...roles) => job.uploads.some((u) => roles.includes(u.role));
  if (!String(job.ours || '').trim() && !up('mine', 'notes')) throw new Error('Tell me your argument(s), or upload your case.');
  if (job.kind === 'frontline' && !String(job.theirs || '').trim() && !up('theirs', 'flow')) throw new Error('List their responses (one per line), or upload their case or your flow.');
  if (job.uploads.length) send({ type: 'log', kind: 'read', text: `Reading ${job.uploads.length} uploaded file(s): ${job.uploads.map((u) => u.name).join(', ')}` });
  const library = saves.read('cards', []) || [];
  let cards = library.filter((c) => (job.cardIds || []).includes(c.id));
  const fresh = [];

  if (job.kind === 'frontline' && job.cutCards && !String(job.theirs || '').trim()) send({ type: 'log', kind: 'warn', text: 'To cut fresh cards, type their responses in the box (one per line). Writing the frontline from your files only.' });
  if (job.kind === 'frontline' && job.cutCards && String(job.theirs || '').trim()) {
    // One fresh rebuttal card per response (max 4), all at once, reusing the card cutter.
    const responses = String(job.theirs).split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 4);
    send({ type: 'state', state: 'searching', say: `Cutting a card for each of their ${responses.length} responses~ ✂️` });
    await Promise.all(responses.map(async (resp, i) => {
      const sub = { mode: 'rebuttal', side: job.side, count: 1, length: 'medium', topic: job.topic, oppArg: resp, argument: String(job.ours || '').split('\n')[0], dateFrom: job.dateFrom, dateTo: job.dateTo };
      try {
        await cutJob(sub, (m) => {
          if (m.type === 'cards') { fresh[i] = m.cards[0]; send(m); }
          else if (m.type === 'log') send({ ...m, text: `[${i + 1}] ${m.text}` });
        }, signal);
      } catch (e) { send({ type: 'log', kind: 'warn', text: `[${i + 1}] No card for "${resp.slice(0, 50)}": ${e.message.slice(0, 120)}` }); }
    }));
    cards = cards.concat(fresh.filter(Boolean));
  }

  send({ type: 'state', state: 'cutting', say: 'Writing it up in your style… ✍️' });
  const raw = await runClaude({ prompt: prep.prepPrompt(job, cards), signal, tools: [] });
  let out;
  try { out = prep.clean(extractTagged(raw, 'prep')); } catch { throw new Error('Claude replied in the wrong format. Please try again.'); }
  if (!out.sections.length) throw new Error('Nothing came back. Try adding more detail to your argument.');

  // Voice check: rewrite once if it slipped into AI filler.
  send({ type: 'state', state: 'verifying', say: 'Checking it sounds like you, not a robot… 🧐' });
  let issues = prep.problems(out, cards, job), rewrote = false;
  if (issues.length) {
    send({ type: 'log', kind: 'done', text: `Fixing: ${issues.join('; ').slice(0, 220)}` });
    try {
      const again = prep.clean(extractTagged(await runClaude({ prompt: prep.rewritePrompt(out, issues), signal, tools: [] }), 'prep'));
      if (again.sections.length) { out = again; rewrote = true; }
    } catch {}
  }
  const hits = prep.slopHits(out);
  if (job.kind === 'frontline') out.sections.forEach((sec, i) => { if (fresh[i]) sec.cards = [fresh[i]]; });
  const doc = {
    id: Date.now().toString(36), kind: job.kind, side: job.side || '', createdAt: new Date().toISOString(), ...out,
    checks: { slop: hits, rewrote, unknownAuthors: prep.unknownAuthors(out, cards, job.uploads),
      longParts: prep.problems(out, cards, job).filter((x) => /sentences;/.test(x)).map((x) => x.split(';')[0]) },
  };
  send({ type: 'prep', doc });
  send({ type: 'state', state: 'happy', say: doc.checks.unknownAuthors.length ? 'Done! One thing to check, see the note 👀' : 'Done! Ready to paste into your doc ✨' });
}

async function askJob(job, send, signal) {
  send({ type: 'state', state: 'thinking', say: 'Hmm, let me think… 💭' });
  const ans = await runClaude({
    prompt: `You are Negi, a cheerful pixel-art assistant who is an expert Public Forum debate coach. Answer briefly (under 150 words), using PF jargon correctly, with a cute tone but a real, substantive answer. Question: ${job.question}`,
    signal, tools: job.web ? ['WebSearch'] : [], systemAppend: KNOWLEDGE(),
    onEvent: (ev) => { for (const d of describeEvent(ev) || []) send({ type: 'log', ...d }); },
  });
  send({ type: 'answer', text: ans.trim() });
  send({ type: 'state', state: 'happy', say: '' });
}

// ---------------------------------------------------------------- HTTP

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function readBody(req) {
  return new Promise((res, rej) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 20e6) req.destroy(); }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } }); });
}

function publicConfig() {
  const { oauthToken, ...rest } = config;
  return { ...rest, hasToken: !!oauthToken };
}

// Runs a command with Negi's env (your saved Claude code, never an API key) and returns stdout.
function runQuick(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const bin = resolveClaude();
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
    if (config.oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = config.oauthToken;
    const c = spawn(bin.cmd, [...bin.pre, ...args], { env, shell: bin.shell, windowsHide: true, cwd: WORKDIR });
    let o = '';
    const t = setTimeout(() => c.kill(), timeoutMs);
    c.stdout.on('data', (d) => { o += d; });
    c.stdin.end();
    c.on('error', reject);
    c.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(o.trim()) : reject(Object.assign(new Error(o.trim() || `exit ${code}`), { exitCode: code, out: o })); });
  });
}

async function claudeStatus() {
  const out = { installed: false, version: '', loggedIn: false, hasToken: !!config.oauthToken, error: '' };
  try { out.version = await runQuick(['--version']); out.installed = true; }
  catch (e) { out.error = e.code === 'ENOENT' ? 'not-installed' : e.message.slice(0, 200); return out; }
  try {
    const st = JSON.parse(await runQuick(['auth', 'status', '--json']).catch((e) => e.out || '{}'));
    out.loggedIn = !!st.loggedIn;
  } catch {}
  if (!out.loggedIn && config.oauthToken) { // tokens don't always show in auth status, so try a tiny real request
    try { out.loggedIn = /ok/i.test(await runClaude({ prompt: 'Reply with exactly: OK', tools: [] })); } catch (e) { out.error = e.message.slice(0, 200); }
  }
  return out;
}

// A real terminal loads your normal PATH, so the plain command works there on every OS.
function claudeShellCmd() {
  return /\s/.test(config.claudePath) ? `"${config.claudePath}"` : config.claudePath;
}

// Opens a real terminal window the user can see and type in.
function openTerminal(command, title) {
  try {
    if (process.platform === 'win32') {
      // Wrapping in an extra pair of quotes keeps cmd /k from stripping quotes inside the command.
      spawn('cmd.exe', ['/c', 'start', `"${title}"`, 'cmd', '/k', `"${command}"`], { detached: true, windowsVerbatimArguments: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      const esc = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      spawn('osascript', ['-e', `tell application "Terminal" to do script "${esc}"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' }).unref();
    } else {
      const term = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].find((t) => { try { execSync(`command -v ${t}`, { stdio: 'ignore' }); return true; } catch { return false; } });
      if (!term) return false;
      const args = term === 'gnome-terminal' ? ['--', 'bash', '-c', `${command}; exec bash`] : ['-e', `bash -c '${command}; exec bash'`];
      spawn(term, args, { detached: true, stdio: 'ignore' }).unref();
    }
    return true;
  } catch { return false; }
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url.replace(/"/g, '%22')}"`);
}

let activeJobs = 0, lastActivity = Date.now();

async function installAndRestart() {
  const r = await updater.install(config.updateRepo);
  console.log(`\n  ⬆ Updated to Negi ${r.version} (${r.updated.length} file(s)).`);
  setTimeout(() => process.exit(42), 800); // the launcher restarts Negi on the new version
  return r;
}

// Check on start and every 3 hours. With auto-update on, install when nobody is mid-cut.
async function updateTick() {
  const st = await updater.check(config.updateRepo);
  if (st.available && config.autoUpdate && !activeJobs && Date.now() - lastActivity > 2 * 60e3) {
    try { await installAndRestart(); } catch (e) { console.error('  ⚠ Auto-update failed:', e.message); }
  }
}
setTimeout(updateTick, 15e3);
setInterval(updateTick, 3 * 3600e3);
setTimeout(() => updater.confirmHealthy(), 30e3);

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  // The bookmarklet posts a page from your browser as a normal form submit (it opens a new tab).
  if (u.pathname === '/inbox' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => { body += d; if (body.length > 3e6) req.destroy(); });
    req.on('end', () => {
      const f = new URLSearchParams(body), id = Math.random().toString(36).slice(2, 10);
      const text = String(f.get('text') || '').slice(0, 1e6);
      const url = String(f.get('url') || '');
      let meta = {}; try { meta = JSON.parse(f.get('meta') || '{}'); } catch {}
      if (/^https?:\/\//.test(url) && text.length > 200) {
        inbox.set(id, { url, title: String(f.get('title') || ''), text, sel: String(f.get('sel') || '').slice(0, 6000), meta, at: Date.now() });
        for (const [k, v] of inbox) if (Date.now() - v.at > 6 * 3600e3) inbox.delete(k);
      }
      res.writeHead(303, { Location: inbox.has(id) ? `/?inbox=${id}` : '/' }); res.end();
    });
    return;
  }
  if (u.pathname.startsWith('/api/inbox/') && req.method === 'GET') {
    const it = inbox.get(u.pathname.split('/').pop());
    res.writeHead(it ? 200 : 404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(it ? { url: it.url, title: it.title, sel: it.sel, chars: it.text.length } : {}));
  }

  // Only accept API requests from Negi's own page
  const origin = req.headers.origin;
  if (req.method === 'POST' && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { res.writeHead(403); return res.end(); }

  if (u.pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(publicConfig()));
  }
  if (u.pathname === '/api/config' && req.method === 'POST') {
    saveConfig(await readBody(req));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(publicConfig()));
  }
  if (u.pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(await claudeStatus()));
  }
  if (u.pathname === '/api/connect' && req.method === 'POST') {
    const { action } = await readBody(req);
    const ok = action === 'install' ? openTerminal('npm install -g @anthropic-ai/claude-code', 'Installing Claude Code')
      : action === 'login' ? openTerminal(`${claudeShellCmd()} setup-token`, 'Connect Claude') : false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok }));
  }
  if (u.pathname === '/api/token' && req.method === 'POST') {
    const { token } = await readBody(req);
    const clean = String(token || '').replace(/\s+/g, '');
    const found = clean.match(/sk-ant-[A-Za-z0-9_-]{20,}/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (clean && !found) return res.end(JSON.stringify({ ok: false, error: "That doesn't look like a Claude code. It should start with sk-ant-" }));
    config.oauthToken = found ? found[0] : '';
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    const st = await claudeStatus();
    return res.end(JSON.stringify({ ok: !config.oauthToken || st.loggedIn, ...st, error: config.oauthToken && !st.loggedIn ? "Claude didn't accept that code. Try Connect Claude again and copy the whole code." : '' }));
  }
  if (u.pathname === '/api/shutdown' && req.method === 'POST') {
    // A newer Negi is starting and needs the port. Stop this one (the launcher exits too).
    res.writeHead(204); res.end();
    setTimeout(() => process.exit(0), 200);
    return;
  }
  if (u.pathname === '/api/version' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ version: updater.localVersion() }));
  }
  // ---- auto-save (cards + the cut form draft)
  const SAVE_KEYS = ['/api/cards', '/api/draft', '/api/prepdocs', '/api/prepdraft', '/api/prepuploads'];
  const LISTS = ['/api/cards', '/api/prepdocs', '/api/prepuploads'];
  if (SAVE_KEYS.includes(u.pathname) && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(saves.read(u.pathname.slice(5), LISTS.includes(u.pathname) ? null : {})));
  }
  if (SAVE_KEYS.includes(u.pathname) && req.method === 'POST') {
    let body; try { body = await readBody(req); } catch { res.writeHead(400); return res.end(); }
    if (LISTS.includes(u.pathname) && !Array.isArray(body)) { res.writeHead(400); return res.end(); }
    saves.write(u.pathname.slice(5), body);
    res.writeHead(204); return res.end();
  }
  // ---- updates
  if (u.pathname === '/api/update' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(u.searchParams.has('check') ? await updater.check(config.updateRepo) : updater.status()));
  }
  if (u.pathname === '/api/update' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (activeJobs) return res.end(JSON.stringify({ ok: false, error: 'Negi is busy cutting. Try again when she finishes.' }));
    try { const r = await installAndRestart(); return res.end(JSON.stringify({ ok: true, ...r })); }
    catch (e) { return res.end(JSON.stringify({ ok: false, error: e.message })); }
  }
  if (u.pathname === '/api/open' && req.method === 'POST') {
    const { url } = await readBody(req);
    if (/^https?:\/\//.test(url)) openInBrowser(url);
    res.writeHead(204); return res.end();
  }
  if ((u.pathname === '/api/cut' || u.pathname === '/api/ask' || u.pathname === '/api/prep') && req.method === 'POST') {
    let job;
    try { job = await readBody(req); } catch { res.writeHead(400); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const ctrl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctrl.abort(); });
    const send = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    activeJobs++;
    try { await ({ '/api/cut': cutJob, '/api/ask': askJob, '/api/prep': prepJob })[u.pathname](job, send, ctrl.signal); }
    catch (e) { send({ type: 'error', message: e.message }); send({ type: 'state', state: 'sad', say: 'Oops… ' + e.message.slice(0, 120) }); }
    finally { activeJobs--; lastActivity = Date.now(); }
    return res.end();
  }

  // static files
  let p = path.normalize(path.join(PUBLIC, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!p.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

const port = parseInt(process.env.PORT) || config.port;
process.on('uncaughtException', (e) => console.error('  ⚠ Error:', e.message));

// Finds the process listening on our port (used only after confirming it is an older Negi).
function pidOnPort(p) {
  try {
    if (process.platform === 'win32') {
      const line = execSync('netstat -ano -p tcp', { encoding: 'utf8' }).split(/\r?\n/).find((l) => new RegExp(`127\\.0\\.0\\.1:${p}\\s.*LISTENING`).test(l));
      return line ? parseInt(line.trim().split(/\s+/).pop()) : 0;
    }
    return parseInt(execSync(`lsof -ti tcp:${p} -sTCP:LISTEN`, { encoding: 'utf8' }).trim().split('\n')[0]) || 0;
  } catch { return 0; }
}

let takeoverTries = 0;
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') { console.error('\n  ✘ Negi could not start:', e.message, '\n'); process.exit(1); }
  const base = `http://localhost:${port}`;
  let other = null;
  try { const r = await fetch(`${base}/api/config`); if (r.ok) other = await r.json(); } catch {}
  if (!other || !('topic' in other)) {
    console.error(`\n  ✘ Port ${port} is used by another program. Close it, or set "port" in config.json to another number like 4848.\n`);
    process.exit(1);
  }
  let theirs = '';
  try { const r = await fetch(`${base}/api/version`); if (r.ok) theirs = (await r.json()).version; } catch {}
  const mine = updater.localVersion();
  if (theirs === mine && !takeoverTries) {
    console.log(`\n  🥬 Negi ${mine} is already running in another window. Opening it, so you can close this window.\n`);
    openInBrowser(base);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  if (takeoverTries++ >= 6) { console.error('\n  ✘ An older Negi is still running. Close every Negi window (or restart your computer), then run start.bat again.\n'); process.exit(1); }
  // An older Negi (e.g. the one from before you updated) still has the port: stop it and take over.
  if (takeoverTries === 1) console.log(`\n  🔄 An older Negi${theirs ? ' ' + theirs : ''} is still running. Closing it and starting ${mine}…`);
  let asked = false;
  try { asked = (await fetch(`${base}/api/shutdown`, { method: 'POST' })).status === 204; } catch {}
  if (!asked) { const pid = pidOnPort(port); if (pid && pid !== process.pid) { try { process.kill(pid); } catch {} } }
  setTimeout(() => server.listen(port, '127.0.0.1'), 1500);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  🥬 Negi the card cutter is ready at ${url}\n  Open that link in your browser if it didn't open by itself. Keep this window open while you use her.\n`);
  console.log(`  Version ${updater.localVersion()} · your cards auto-save to the data folder.\n`);
  if (!process.argv.includes('--no-open')) openInBrowser(url);
});
