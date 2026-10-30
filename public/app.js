// Negi app: Claude connection, the cutting job stream, card rendering and copy-paste.
(function () {
  const $ = (id) => document.getElementById(id);
  const pet = (window.__pet = new Pet($('pet')));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('negi:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('negi:' + k, JSON.stringify(v)); } catch {} },
  };

  // ------------------------------------------------------------ auto-save
  // Cards and the cut form save to the data folder on your computer as you work (and to this browser as a backup).
  let cardsCache = store.get('cards', []);
  const getCards = () => cardsCache.slice();
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const pushCards = debounce(() => fetch('/api/cards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cardsCache) })
    .then(() => flashSaved()).catch(() => {}), 300);
  function saveCards(list) { cardsCache = list; store.set('cards', list); pushCards(); }
  function flashSaved() { const el = $('autosave'); if (!el) return; el.textContent = '✓ Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  fetch('/api/cards').then((r) => r.json()).then((server) => {
    if (Array.isArray(server)) { cardsCache = server; store.set('cards', server); }
    else if (cardsCache.length) pushCards(); // first run: move cards from this browser to disk
    renderCards();
  }).catch(() => {});

  const DRAFT_FIELDS = ['mode', 'oppArg', 'responseType', 'side', 'count', 'length', 'dateRange', 'yearFrom', 'yearTo', 'argument', 'url', 'selection', 'notes'];
  const saveDraft = debounce(() => {
    const d = {}; for (const k of DRAFT_FIELDS) d[k] = $(k).value;
    fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(flashSaved).catch(() => {});
  }, 600);
  const draftReady = fetch('/api/draft').then((r) => r.json()).then((d) => {
    // only fill fields you haven't touched yet (selects compare against their default option)
    const untouched = (el) => el.tagName === 'SELECT' ? el.value === ([...el.options].find((o) => o.defaultSelected) || el.options[0]).value : el.value === el.defaultValue;
    for (const k of DRAFT_FIELDS) if (d && d[k] != null && untouched($(k))) $(k).value = d[k];
  }).catch(() => {});
  for (const k of DRAFT_FIELDS) $(k).addEventListener('input', saveDraft);

  // ------------------------------------------------------------ speech bubble
  let typer;
  function say(text, state) {
    if (state) pet.setState(state);
    if (!text) return;
    clearInterval(typer);
    const el = $('bubble'); el.textContent = ''; let i = 0;
    pet.talk(Math.min(text.length * 28, 4000));
    typer = setInterval(() => { el.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typer); }, 22);
  }
  setInterval(() => { // settle back to idle after a while
    if (!busy && pet.state !== 'idle' && performance.now() - pet.since > 8000) pet.setState('idle');
  }, 4000);

  // ------------------------------------------------------------ settings
  let config = {};
  fetch('/api/config').then((r) => r.json()).then((c) => {
    config = c;
    $('topic').value = c.topic; $('initials').value = c.initials; $('model').value = c.model ?? 'sonnet'; $('deepCheck').checked = c.deepCheck !== false; $('autoUpdate').checked = c.autoUpdate !== false;
    for (const k of FMT_KEYS) $(k).value = c[k];
    markSwatch();
    renderCards(); renderPreview();
  });
  const FMT_KEYS = ['hlColor', 'font', 'tagPt', 'readPt', 'smallPt'];
  // Highlight swatches + custom picker write into the hidden #hlColor field.
  function setHighlight(c) { $('hlColor').value = c.toUpperCase(); markSwatch(); $('hlColor').dispatchEvent(new Event('input')); }
  function markSwatch() {
    const cur = ($('hlColor').value || '#00FF00').toUpperCase();
    let known = false;
    document.querySelectorAll('#swatches [data-c]').forEach((b) => { const on = b.dataset.c === cur; b.setAttribute('aria-pressed', on); known ||= on; });
    $('hlCustom').value = cur.toLowerCase();
    $('hlCustom').parentElement.classList.toggle('on', !known);
    $('hlCustom').parentElement.style.background = known ? '' : cur;
  }
  document.querySelectorAll('#swatches [data-c]').forEach((b) => { b.style.background = b.dataset.c; b.onclick = () => setHighlight(b.dataset.c); });
  $('hlCustom').addEventListener('input', (e) => setHighlight(e.target.value));
  setTimeout(() => [...$('font').options].forEach((o) => { o.style.fontFamily = `'${o.value}',${FALLBACK[o.value] || 'sans-serif'}`; }));
  function settingsFromForm() {
    const o = { initials: $('initials').value.trim(), model: $('model').value, deepCheck: $('deepCheck').checked, topic: $('topic').value.trim(), autoUpdate: $('autoUpdate').checked };
    for (const k of FMT_KEYS) o[k] = /Pt$/.test(k) ? Math.max(4, Math.min(24, parseFloat($(k).value) || 0)) : $(k).value;
    return o;
  }
  // Settings save themselves a moment after you change them.
  const saveSettings = debounce(async () => {
    config = await (await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settingsFromForm()) })).json();
    $('settingsSaved').textContent = '✓ Settings saved.';
    flashSaved();
  }, 500);
  for (const k of [...FMT_KEYS, 'initials', 'model', 'deepCheck', 'topic', 'autoUpdate']) {
    $(k).addEventListener('input', () => { Object.assign(config, settingsFromForm()); renderPreview(); renderCards(); $('settingsSaved').textContent = 'Saving…'; saveSettings(); });
  }
  // ------------------------------------------------------------ Claude connection
  const post = (p, body) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  function showConn(st) {
    const view = !st ? null : st.loggedIn ? 'connOk' : !st.installed ? 'connInstall' : 'connLogin';
    for (const id of ['connInstall', 'connLogin', 'connOk']) $(id).hidden = id !== view;
    const badge = $('connBadge');
    badge.className = 'badge ' + (!st ? 'review' : st.loggedIn ? 'verified' : 'fail');
    badge.textContent = !st ? 'Checking…' : st.loggedIn ? '✔ Connected' : !st.installed ? '✘ Claude Code not installed' : '✘ Not connected';
    $('disconnectBtn').hidden = !st?.hasToken;
    $('connectPanel').classList.toggle('done', !!st?.loggedIn);
  }
  function connMsg(text, cls = '') { $('connMsg').className = 'status ' + cls; $('connMsg').textContent = text; }
  async function checkClaude() {
    showConn(null); connMsg('');
    try {
      const st = await (await fetch('/api/status')).json();
      showConn(st);
      if (st.loggedIn) say('Connected to Claude! Ready to cut ✂️', 'happy');
      else say(st.installed ? 'Connect me to Claude first! Click the buttons up top 🔌' : 'I need Claude Code installed first! 🔌', 'worried');
    } catch { connMsg("Can't reach Negi's server. Is the start.bat window still open?", 'bad'); }
  }
  async function saveToken(token) {
    connMsg('Saving and testing your code…', 'muted');
    const r = await post('/api/token', { token });
    if (r.ok && r.loggedIn) { $('tokenInput').value = ''; connMsg(''); showConn(r); say('Yay, we\'re connected! 🎉', 'happy'); }
    else connMsg('✘ ' + (r.error || 'That code did not work.'), 'bad');
  }
  $('installBtn').onclick = async () => { const r = await post('/api/connect', { action: 'install' }); connMsg(r.ok ? 'An install window opened. When it says "added 1 package" (or similar), close it and click Check again.' : 'Could not open a window. Open Command Prompt and run: npm install -g @anthropic-ai/claude-code', r.ok ? 'muted' : 'bad'); };
  $('loginBtn').onclick = async () => { const r = await post('/api/connect', { action: 'login' }); connMsg(r.ok ? 'Window opened! Sign in in your browser, copy the sk-ant- code from the black window, then click "2. Paste code".' : 'Could not open a window. Open Command Prompt and run: claude setup-token', r.ok ? 'muted' : 'bad'); };
  $('pasteBtn').onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (!t.trim()) return connMsg('Your clipboard is empty. Copy the code from the black window first.', 'bad'); saveToken(t); }
    catch { connMsg('Your browser blocked clipboard access. Paste into the box with Ctrl+V and press Save.', 'bad'); $('tokenInput').focus(); }
  };
  $('saveToken').onclick = () => saveToken($('tokenInput').value);
  $('tokenInput').onkeydown = (e) => { if (e.key === 'Enter') saveToken($('tokenInput').value); };
  $('disconnectBtn').onclick = async () => { await post('/api/token', { token: '' }); checkClaude(); };
  document.querySelectorAll('.recheck').forEach((b) => (b.onclick = checkClaude));
  checkClaude();
  // Sends the article text from YOUR browser (works on paywalled pages you're logged into).
  $('bookmarklet').href = 'javascript:' + encodeURIComponent(`(()=>{const q=n=>{const e=document.querySelector('meta[name="'+n+'"],meta[property="'+n+'"]');return e?e.content:''};`
    + `const a=document.querySelector('article,main,[role=main]')||document.body;`
    + `const m={author:q('author')||q('article:author')||q('parsely-author'),published:q('article:published_time')||q('parsely-pub-date')||((document.querySelector('time[datetime]')||{}).dateTime||''),title:q('og:title')||document.title,siteName:q('og:site_name')};`
    + `const f=document.createElement('form');f.method='POST';f.action='${location.origin}/inbox';f.target='_blank';`
    + `const add=(k,v)=>{const i=document.createElement('textarea');i.name=k;i.value=v;f.appendChild(i)};`
    + `add('url',location.href);add('title',document.title);add('sel',String(getSelection()));add('meta',JSON.stringify(m));`
    + `add('text',(document.body.innerText.length>a.innerText.length*3&&a!==document.body?a:document.body).innerText);`
    + `f.style.display='none';document.body.appendChild(f);f.submit();f.remove()})()`);
  $('bookmarklet').onclick = (e) => { e.preventDefault(); say('Drag me to your bookmarks bar, then click me on an article!'); };

  const qs = new URLSearchParams(location.search);
  let inboxId = '';
  if (qs.get('inbox')) {
    fetch('/api/inbox/' + qs.get('inbox')).then((r) => r.ok ? r.json() : null).then(async (it) => {
      if (!it) return;
      await draftReady;
      inboxId = qs.get('inbox');
      $('url').value = it.url;
      if (it.sel) { $('selection').value = it.sel; $('selection').closest('details').open = true; }
      $('inboxNote').hidden = false;
      $('inboxNote').textContent = `📥 Got "${it.title || it.url}" from your browser (${it.chars.toLocaleString()} characters). Type what it should prove, then hit Cut.`;
      say('Ooh, you brought me a page from your browser! What should it prove? ✂️', 'happy');
    });
    history.replaceState(null, '', '/');
  }
  $('url').addEventListener('input', () => { inboxId = ''; $('inboxNote').hidden = true; });
  if (qs.get('url')) {
    $('url').value = qs.get('url');
    if (qs.get('sel')) { $('selection').value = qs.get('sel'); $('selection').closest('details').open = true; }
    setTimeout(() => say('Ooh, you brought me a page! Tell me what it should prove, then hit Cut ✂️', 'happy'), 300);
    history.replaceState(null, '', '/');
  }

  // ------------------------------------------------------------ date range
  const iso = (d) => d.toISOString().slice(0, 10);
  function dateBounds() {
    const v = $('dateRange').value, [kind, n] = v.split(':'), today = new Date();
    if (kind === 'y') return { dateFrom: `${n}-01-01`, dateTo: `${n}-12-31` };
    if (kind === 'since') return { dateFrom: `${n}-01-01`, dateTo: iso(today) };
    if (kind === 'm') { const d = new Date(today); d.setMonth(d.getMonth() - +n); return { dateFrom: iso(d), dateTo: iso(today) }; }
    if (kind === 'custom') {
      let a = parseInt($('yearFrom').value) || 0, b = parseInt($('yearTo').value) || 0;
      if (a && b && a > b) [a, b] = [b, a];
      return { dateFrom: a ? `${a}-01-01` : '', dateTo: b ? `${b}-12-31` : '' };
    }
    return { dateFrom: '', dateTo: '' };
  }
  const syncCustom = () => { $('customYears').hidden = $('dateRange').value !== 'custom'; };
  $('dateRange').addEventListener('input', syncCustom);
  draftReady.then(syncCustom);

  // ------------------------------------------------------------ speech mode
  function showMode(user) {
    const reb = $('mode').value === 'rebuttal';
    document.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === $('mode').value));
    $('rebuttalBox').hidden = !reb;
    $('argLabel').textContent = reb ? 'Your point (optional): what your response should establish' : 'What should the card prove? (your tag / argument)';
    $('argument').placeholder = reb ? 'e.g. Removing the B61s lowers the risk of a Russian first strike' : 'e.g. TPNW ratification forces an end to NATO nuclear sharing, which collapses extended deterrence';
    if (user && reb && $('length').value === 'nolimit') $('length').value = 'medium'; // rebuttal cards should be quick
    if (user && !reb && ['short', 'medium'].includes($('length').value)) $('length').value = 'nolimit';
  }
  document.querySelectorAll('.seg-btn').forEach((b) => (b.onclick = () => {
    $('mode').value = b.dataset.mode; showMode(true);
    $('mode').dispatchEvent(new Event('input')); $('length').dispatchEvent(new Event('input'));
    say(b.dataset.mode === 'rebuttal' ? 'Rebuttal mode! Short, punchy answers ⚡' : 'Constructive mode! Full warrants 📚', 'happy');
  }));
  showMode(false);
  draftReady.then(() => showMode(false));

  // ------------------------------------------------------------ jobs
  let busy = false, ctrl = null;
  function log(text, cls) {
    const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls;
    $('log').appendChild(d); $('log').scrollTop = 1e9;
  }
  async function stream(path, body, onMsg) {
    ctrl = new AbortController();
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl; while ((nl = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (line.trim()) onMsg(JSON.parse(line)); }
    }
  }
  function handle(m) {
    if (m.type === 'state') say(m.say, m.state);
    else if (m.type === 'log') log((m.kind === 'search' ? '🔍 ' : m.kind === 'read' ? '📖 ' : m.kind === 'browser' ? '🌐 ' : m.kind === 'warn' ? '⚠️ ' : '• ') + m.text, m.kind === 'warn' ? 'warn' : '');
    else if (m.type === 'error') log('❌ ' + m.message, 'error');
    else if (m.type === 'cards') {
      const lib = getCards(); lib.unshift(...m.cards); saveCards(lib);
      renderCards();
      log(`✅ ${m.cards.length} card(s) added below.`);
    } else if (m.type === 'answer') $('askA').textContent = m.text;
  }
  function setBusy(b) { busy = b; $('cutBtn').disabled = b; $('askBtn').disabled = b; $('prepBtn').disabled = b; $('stopBtn').hidden = !b; }

  $('cutBtn').onclick = async () => {
    const job = { topic: $('topic').value.trim(), side: $('side').value, count: $('count').value, argument: $('argument').value.trim(),
      url: $('url').value.trim(), selection: $('selection').value.trim(), notes: $('notes').value.trim(), length: $('length').value, inboxId, ...dateBounds(),
      mode: $('mode').value, oppArg: $('oppArg').value.trim(), responseType: $('responseType').value };
    if (job.mode === 'rebuttal' && !job.oppArg && !job.url) return say('Tell me the opponent argument you want to answer! 🥺', 'worried');
    if (job.mode !== 'rebuttal' && !job.argument && !job.url) return say('Tell me what the card should prove (or give me a URL)! 🥺', 'worried');
    $('log').innerHTML = ''; setBusy(true);
    try { await stream('/api/cut', job, handle); }
    catch (e) { if (e.name !== 'AbortError') { log('❌ ' + e.message, 'error'); say('I lost connection to my server 😢 Is it running?', 'sad'); } }
    setBusy(false);
  };
  $('stopBtn').onclick = () => { ctrl?.abort(); say('Okay, stopping! ✋', 'idle'); setBusy(false); };
  $('askBtn').onclick = async () => {
    const q = $('askQ').value.trim(); if (!q) return;
    $('askA').textContent = '…'; setBusy(true);
    try { await stream('/api/ask', { question: q, web: $('askWeb').checked }, handle); } catch (e) { $('askA').textContent = e.message; }
    setBusy(false);
  };

  // ------------------------------------------------------------ card rendering
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Card styles come from Settings > Card formatting.
  const FALLBACK = { Calibri: 'Carlito,sans-serif', Arial: 'Helvetica,sans-serif', Helvetica: 'Arial,sans-serif', Verdana: 'sans-serif', Tahoma: 'Verdana,sans-serif',
    Aptos: 'Calibri,sans-serif', 'Century Gothic': 'Futura,sans-serif', 'Times New Roman': 'Times,serif', Cambria: 'Georgia,serif', Georgia: 'serif', Garamond: 'Georgia,serif', 'Book Antiqua': 'Palatino,serif' };
  const fmt = () => {
    const f = config.font || 'Calibri';
    return { FONT: `font-family:'${f}',${FALLBACK[f] || 'sans-serif'};`, tag: config.tagPt || 13, read: config.readPt || 11, small: config.smallPt || 8, hl: config.hlColor || '#00FF00' };
  };

  function markupToHtml(src) {
    const { FONT, read, small, hl } = fmt();
    const S = { unread: `font-size:${small}pt;`, read: `font-size:${read}pt;text-decoration:underline;`, hl: `background:${hl};`, b: 'font-weight:bold;' };
    let u = 0, h = 0, b = 0, out = '';
    for (const part of String(src).split(/(<\/?[uhb]>)/i)) {
      const m = part.match(/^<(\/?)([uhb])>$/i);
      if (m) { const d = m[1] ? -1 : 1, k = m[2].toLowerCase(); if (k === 'u') u = Math.max(0, u + d); if (k === 'h') h = Math.max(0, h + d); if (k === 'b') b = Math.max(0, b + d); continue; }
      if (!part) continue;
      const style = FONT + (u || h ? S.read : S.unread) + (h ? S.hl : '') + (b ? S.b : '');
      out += `<span style="${style}">${esc(part)}</span>`;
    }
    return out;
  }
  function tagHtml(tag) {
    return String(tag).split(/(<\/?u>|<\/?b>)/i).reduce((acc, part) => {
      if (/^<u>$/i.test(part)) acc.u = 1; else if (/^<\/u>$/i.test(part)) acc.u = 0;
      else if (!/^<\/?b>$/i.test(part) && part) acc.html += acc.u ? `<u>${esc(part)}</u>` : esc(part);
      return acc;
    }, { u: 0, html: '' }).html;
  }
  function yy(date) { const m = String(date).match(/(\d{4})\s*$/) || String(date).match(/(\d{4})/); return m ? m[1].slice(2) : 'ND'; }
  function cardHtml(c) {
    const ci = c.cite, ini = config.initials ? ` //${esc(config.initials)}` : '';
    const { FONT, tag, read } = fmt();
    const bracket = [ci.authorFull, ci.credentials, ci.date, ci.title, ci.publication, ci.url].filter(Boolean).map(esc).join(', ');
    return `<p style="margin:0 0 4pt;${FONT}font-size:${tag}pt;font-weight:bold;">${tagHtml(c.tag)}</p>`
      + `<p style="margin:0 0 6pt;${FONT}"><span style="font-size:${tag}pt;font-weight:bold;">${esc(ci.authorLast)} ${yy(ci.date)}</span> <span style="font-size:${read}pt;">[${bracket}${ini}]</span></p>`
      + c.paragraphs.map((p) => `<p style="margin:0 0 6pt;${FONT}">${markupToHtml(p)}</p>`).join('');
  }
  function plain(c) {
    const ci = c.cite;
    return `${c.tag.replace(/<[^>]+>/g, '')}\n${ci.authorLast} ${yy(ci.date)} [${[ci.authorFull, ci.credentials, ci.date, ci.title, ci.publication, ci.url].filter(Boolean).join(', ')}${config.initials ? ' //' + config.initials : ''}]\n${c.paragraphs.map((p) => p.replace(/<[^>]+>/g, '')).join('\n')}`;
  }
  async function copyRich(html, text) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } catch { // fallback: copy a rendered selection
      const d = document.createElement('div'); d.innerHTML = html; d.style.cssText = 'position:fixed;left:-9999px;background:#fff'; document.body.appendChild(d);
      const r = document.createRange(); r.selectNodeContents(d); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      document.execCommand('copy'); sel.removeAllRanges(); d.remove();
    }
  }

  function checksHtml(c) {
    const ch = c.check || {};
    const mark = (x) => x === true ? '<span class="ok">✔</span>' : x === false ? '<span class="bad">✘</span>' : '<span class="unk">?</span>';
    const items = (ch.items || []).map((it) => `<span title="${esc(it.note)}">${mark(it.state)} ${esc(it.label)}</span>`);
    const extra = [...(ch.fixes || []).map((f) => `🔧 Auto-fixed ${f}`), ...(ch.notes || []).map((n) => `ℹ️ ${n}`),
      ...(ch.items || []).filter((it) => it.note && it.state !== true).map((it) => `${it.state === false ? '❌' : '⚠️'} ${it.label}: ${it.note}`)];
    return `<div>${items.join(' &nbsp; ')}</div>${extra.length ? `<ul>${extra.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
  }

  const SAMPLE = { tag: 'European TPNW ratification <u>forces B61s out</u> and <u>guts extended deterrence</u>.', cite: { authorLast: 'Ellison', authorFull: 'Jordan Ellison', credentials: 'Senior Fellow for Nuclear Policy', date: '09-14-2026', title: 'Why the Ban Treaty and NATO Cannot Coexist', publication: 'Example Review', url: 'https://example.org/article' },
    paragraphs: ['The consequences would extend well beyond the four host nations. <u>Nuclear sharing exists precisely to <h>show Moscow</h> that <h>an attack on any ally risks a response</h> that <h>Russia <b>cannot control</b></h>.</u>'] };
  function renderPreview() {} // the cards themselves (or the sample below) show the format live

  // ---- paraphrasing
  function paraHtml(c) {
    const { FONT, tag, read } = fmt();
    return `<p style="margin:0 0 4pt;${FONT}font-size:${tag}pt;font-weight:bold;">${tagHtml(c.tag)}</p><p style="margin:0 0 6pt;${FONT}font-size:${read}pt;">${esc(c.paraphrase.text)}</p>`;
  }
  const paraPlain = (c) => `${String(c.tag).replace(/<[^>]+>/g, '')}\n${c.paraphrase.text}`;
  function paraBox(c) {
    const p = c.paraphrase;
    if (!p) return '';
    const fails = (p.check?.items || []).filter((x) => !x.state);
    const mark = (x) => x.state ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>';
    return `<div class="para-box">
      <div class="para-head"><b>Paraphrase</b><span class="badge ${fails.length ? 'review' : 'verified'}">${fails.length ? '⚠ CHECK' : '✔ FAITHFUL'}</span>
        <span class="chip">🕒 ~${p.check?.seconds ?? '?'}s${c.read ? ` (card ~${c.read.seconds}s)` : ''}</span><span class="sp"></span>
        <button class="pix small" data-a="pcopy">Copy paraphrase</button><button class="pix small" data-a="pcopycard">Copy with card</button></div>
      <p class="para-text">${esc(p.text)}</p>
      <div class="para-checks">${(p.check?.items || []).map((x) => `<span title="${esc(x.note)}">${mark(x)} ${esc(x.label)}</span>`).join(' &nbsp; ')}</div>
      ${fails.length ? `<ul class="para-fails">${fails.map((x) => `<li>${esc(x.label)}${x.note ? ': ' + esc(x.note) : ''}</li>`).join('')}</ul>` : ''}
      <p class="muted">${p.fixed ? 'Rewritten once automatically to pass the checks. ' : ''}Keep the original card below ready: most tournaments (including NSDA) let the other team ask to see it.</p>
    </div>`;
  }
  async function paraphrase(id, btn) {
    const card = getCards().find((x) => x.id === id);
    if (!card) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Paraphrasing…'; }
    say('Putting it in my own words, carefully~ ✍️', 'thinking');
    try {
      const r = await (await fetch('/api/paraphrase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card, judge: $('prepJudge').value }) })).json();
      if (!r.ok) throw new Error(r.error);
      const lib = getCards(), k = lib.findIndex((x) => x.id === id);
      if (k >= 0) { lib[k] = { ...lib[k], paraphrase: { text: r.text, check: r.check, fixed: r.fixed, at: r.at } }; saveCards(lib); renderCards(); }
      say(r.check.ok ? 'Paraphrased, and it stays faithful to the card ✨' : 'Paraphrased, but check the flagged part 👀', r.check.ok ? 'happy' : 'worried');
    } catch (e) {
      say('Oops… ' + e.message.slice(0, 100), 'sad');
      if (btn) { btn.disabled = false; btn.textContent = 'Paraphrase'; }
    }
  }

  function renderCards() {
    renderPick(); // keep the prep writer's card list in sync
    const lib = getCards(), box = $('cards');
    if (!lib.length) { box.innerHTML = `<div class="empty">No cards yet. Here's how yours will look:</div><div class="card-wrap"><div class="card">${cardHtml(SAMPLE)}</div></div>`; return; }
    box.innerHTML = '';
    lib.forEach((c, i) => {
      const st = c.check?.status || 'review';
      const label = { verified: '✔ VERIFIED', review: '⚠ REVIEW', fail: '✘ FAILED CHECK' }[st];
      const w = document.createElement('div'); w.className = 'card-wrap';
      w.innerHTML = `<div class="card-bar"><span class="badge ${st}">${label}</span>${c.side ? `<b>${esc(c.side)}</b>` : ''}${c.mode ? `<span class="chip">${esc(c.mode)}</span>` : ''}${c.read ? `<span class="chip" title="${c.read.words} highlighted words">🕒 ~${c.read.seconds}s read</span>` : ''}<span class="sp"></span>
        <button class="pix small" data-a="copy">Copy card</button><button class="pix small" data-a="para">${c.paraphrase ? 'Redo paraphrase' : 'Paraphrase'}</button><button class="pix small" data-a="open">Open source</button><button class="pix small ghost" data-a="del">✕</button></div>
        <details class="checks" ${st !== 'verified' ? 'open' : ''}><summary>Double-check report</summary>${checksHtml(c)}</details>
        ${paraBox(c)}
        <div class="card">${cardHtml(c)}</div>`;
      w.querySelector('[data-a=para]').onclick = (e) => paraphrase(c.id, e.target);
      w.querySelector('[data-a=pcopy]')?.addEventListener('click', async () => { await copyRich(paraHtml(c), paraPlain(c)); say('Copied the paraphrase! Keep the card handy in case they ask ✨', 'happy'); });
      w.querySelector('[data-a=pcopycard]')?.addEventListener('click', async () => { await copyRich(paraHtml(c) + cardHtml(c), paraPlain(c) + '\n\n' + plain(c)); say('Copied the paraphrase with the original card ✨', 'happy'); });
      w.querySelector('[data-a=copy]').onclick = async () => { await copyRich(cardHtml(c), plain(c)); say(st === 'fail' ? 'Copied, but please fix the flagged issues first! 💦' : 'Copied! Paste it in your doc ✨', st === 'fail' ? 'worried' : 'happy'); };
      w.querySelector('[data-a=open]').onclick = () => fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: c.cite.url }) });
      w.querySelector('[data-a=del]').onclick = () => { const l = getCards(); l.splice(i, 1); saveCards(l); renderCards(); };
      box.appendChild(w);
    });
  }
  $('paraAll').onclick = async () => {
    const todo = getCards().filter((c) => !c.paraphrase);
    if (!todo.length) return say('Every card already has a paraphrase! ✨', 'happy');
    $('paraAll').disabled = true;
    for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map((c) => paraphrase(c.id))); // 3 at a time
    $('paraAll').disabled = false;
  };
  const allHtml = () => getCards().map(cardHtml).join('<p>&nbsp;</p>');
  $('copyAll').onclick = async () => { const lib = getCards(); if (!lib.length) return; await copyRich(allHtml(), lib.map(plain).join('\n\n')); say(`Copied all ${lib.length} cards! 📋`, 'happy'); };
  $('downloadDoc').onclick = () => {
    const blob = new Blob([`<html><head><meta charset="utf-8"></head><body>${allHtml()}</body></html>`], { type: 'application/msword' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'negi-cards.doc'; a.click();
  };
  $('clearAll').onclick = () => { if (confirm('Delete all saved cards?')) { saveCards([]); renderCards(); } };

  // ------------------------------------------------------------ updates
  function showUpdate(st) {
    $('versionLine').textContent = `Negi ${st.current}` + (st.checkedAt ? ` · checked ${new Date(st.checkedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '')
      + (st.error ? ` · ${st.error}` : st.available ? '' : ' · up to date');
    $('updateBanner').hidden = !st.available;
    if (st.available) $('updateText').textContent = `Negi ${st.latest} is ready to install.${st.notes ? ' New: ' + st.notes : ''}`;
  }
  async function checkUpdates(force) {
    try { showUpdate(await (await fetch('/api/update' + (force ? '?check' : ''))).json()); } catch {}
  }
  async function installUpdate() {
    $('updateNow').disabled = true; $('updateText').textContent = 'Downloading the update…';
    const r = await (await fetch('/api/update', { method: 'POST' })).json().catch(() => ({ ok: false, error: 'Lost connection' }));
    if (!r.ok) { $('updateNow').disabled = false; $('updateText').textContent = '✘ ' + r.error; return; }
    $('updateText').textContent = `Installed ${r.version}. Restarting Negi…`;
    say('Getting an upgrade! Be right back~ ✨', 'happy');
    const wait = async () => { try { await fetch('/api/config', { cache: 'no-store' }); location.reload(); } catch { setTimeout(wait, 1000); } };
    setTimeout(wait, 2500);
  }
  $('updateNow').onclick = installUpdate;
  $('updateLater').onclick = () => { $('updateBanner').hidden = true; };
  $('checkUpdates').onclick = () => { $('versionLine').textContent = 'Checking…'; checkUpdates(true); };
  checkUpdates(false);
  fetch('/api/version').then((r) => r.json()).then((v) => { $('petVersion').textContent = `Negi v${v.version}`; }).catch(() => {});
  setTimeout(() => checkUpdates(false), 20000); // the server checks ~15s after starting
  setInterval(() => checkUpdates(false), 30 * 60e3);

  // ------------------------------------------------------------ prep writer
  const KIND_TEXT = {
    frontline: { ours: 'Your argument they\'re responding to', oursPh: 'e.g. Extended deterrence: TPNW ratification forces the B61s out, which tells Moscow NATO won\'t escalate', theirs: 'Their responses (one per line)', theirsPh: 'e.g. Deterrence is conventional now, nukes don\'t matter\nThe B61s are militarily useless\nRussia is already deterred by France and the UK' },
    extension: { ours: 'Arguments to extend (one per line, "Name: what it says"). Each becomes 3 sentences: uniqueness, link, impact', oursPh: 'e.g. Deterrence: removing B61s ends nuclear sharing, Russia reads that as weakness and probes the Baltics, that escalates to nuclear war', theirs: '', theirsPh: '' },
    weighing: { ours: 'Your impacts (one per line, "Name: what it says")', oursPh: 'e.g. Nuclear war: Russian probing in the Baltics escalates, millions die', theirs: 'Their impacts to weigh against (optional, one per line)', theirsPh: 'e.g. Humanitarian: nuclear stigma lowers the chance of use' },
    paracase: { ours: '', oursPh: '', theirs: '', theirsPh: '' },
    ballot: { ours: 'Your best arguments (one per line)', oursPh: 'e.g. Deterrence: B61s leaving collapses Article 5 credibility', theirs: 'Their best arguments (optional, one per line)', theirsPh: 'e.g. Norms: ratifying stigmatizes nukes' },
  };
  let uploads = []; // uploaded files (declared early: the form labels depend on it)
  const PREP_FIELDS = ['prepKind', 'prepSide', 'prepJudge', 'prepSpeech', 'prepOurs', 'prepTheirs', 'prepFrame'];
  function showKind() {
    const k = $('prepKind').value, t = KIND_TEXT[k];
    document.querySelectorAll('.prep-kind').forEach((b) => b.setAttribute('aria-checked', b.dataset.kind === k));
    document.querySelectorAll('.kind-opt').forEach((el) => { el.hidden = !el.dataset.for.split(' ').includes(k); });
    $('oursLabel').textContent = t.ours + (uploads.some((u) => u.role === 'mine') ? ' (optional: Negi reads your uploaded case)' : ''); $('prepOurs').placeholder = t.oursPh;
    $('oursWrap').hidden = !t.ours; $('cardPick').closest('details').hidden = k === 'paracase';
    $('theirsWrap').hidden = !t.theirs; $('theirsLabel').textContent = t.theirs; $('prepTheirs').placeholder = t.theirsPh;
  }
  const savePrepDraft = debounce(() => {
    const d = {}; for (const k of PREP_FIELDS) d[k] = $(k).value;
    fetch('/api/prepdraft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).catch(() => {});
  }, 600);
  for (const k of PREP_FIELDS) $(k).addEventListener('input', savePrepDraft);
  document.querySelectorAll('.prep-kind').forEach((b) => (b.onclick = () => { $('prepKind').value = b.dataset.kind; showKind(); savePrepDraft(); }));
  fetch('/api/prepdraft').then((r) => r.json()).then((d) => { for (const k of PREP_FIELDS) if (d && d[k] != null) $(k).value = d[k]; showKind(); }).catch(showKind);
  showKind();

  // pick saved cards to write from
  function renderPick() {
    const lib = getCards(), box = $('cardPick');
    $('pickCount').textContent = `(${lib.length} saved)`;
    const was = new Set([...box.querySelectorAll('input:checked')].map((i) => i.value));
    box.innerHTML = lib.length ? '' : '<p class="muted">No saved cards yet. Cut some first, or tick "cut a fresh card" for frontlines.</p>';
    for (const c of lib) {
      const yy = (String(c.cite?.date || '').match(/(\d{4})/) || ['', ''])[1].slice(2);
      const l = document.createElement('label'); l.className = 'chk';
      l.innerHTML = `<input type="checkbox" value="${esc(c.id)}"${was.has(c.id) ? ' checked' : ''}> <span><b>${esc(c.cite?.authorLast || '?')} ${esc(yy)}</b> ${esc(String(c.tag || '').replace(/<[^>]+>/g, ''))}</span>`;
      box.appendChild(l);
    }
  }
  $('cardPick').closest('details').addEventListener('toggle', renderPick);
  renderPick();

  // render prep docs the way your old prep looks
  function prepHtml(d) {
    const { FONT, tag, read } = fmt();
    const P = (style, inner) => `<p style="margin:0 0 4pt;${FONT}font-size:${read}pt;${style}">${inner}</p>`;
    let html = '';
    for (const s of d.sections || []) {
      html += `<p style="margin:10pt 0 4pt;${FONT}font-size:${tag}pt;font-weight:bold;text-decoration:underline;">${esc(s.heading)}</p>`;
      if (s.lead) html += P('', esc(s.lead));
      if (s.style === 'para') html += P('', (s.items || []).map((it) => esc(it.text)).join(' ')); // one paragraph, like your extensions
      (s.items || []).forEach((it, i) => {
        if (s.style === 'para' || s.style === 'case') return;
        else if (s.style === 'lettered') html += P('margin-left:36pt;text-indent:-24pt;', `(${String.fromCharCode(97 + i)})&nbsp;&nbsp;- ${it.label ? esc(it.label) + ': ' : ''}${esc(it.text)}`);
        else if (s.style === 'tags') html += P('font-weight:bold;', esc(it.text));
        else html += P('margin-left:30pt;text-indent:-14pt;', `●&nbsp;&nbsp;${it.label ? `<b>${esc(it.label)}</b>: ` : ''}${esc(it.text)}`);
      });
      if (s.style === 'case') for (const it of s.items || []) {
        if (it.kind === 'card') html += `<p style="margin:8pt 0 2pt;${FONT}font-size:${tag}pt;font-weight:bold;">${esc(it.label)}</p>` + P('', esc(it.text));
        else html += P('', esc(it.text));
      }
      for (const c of s.cards || []) html += `<div style="margin:6pt 0 0 0;">${cardHtml(c)}</div>`;
    }
    if ((d.appendix || []).length) {
      html += `<p style="margin:18pt 0 4pt;${FONT}font-size:${tag}pt;font-weight:bold;text-decoration:underline;">Original cards (have these ready if the other team asks)</p>`;
      for (const c of d.appendix) html += `<p style="margin:8pt 0 2pt;${FONT}font-size:${tag}pt;font-weight:bold;">${esc(c.tag)}</p>${P('', esc(c.citeLine))}${c.paragraphs.map((x) => `<p style="margin:0 0 6pt;${FONT}">${markupToHtml(x)}</p>`).join('')}`;
    }
    return html;
  }
  const prepPlain = (d) => (d.sections || []).map((s) => s.style === 'case' ? [s.heading, ...(s.items || []).map((it) => it.kind === 'card' ? `${it.label}\n${it.text}` : it.text)].join('\n\n') : s.style === 'para' ? [s.heading, (s.items || []).map((it) => it.text).join(' ')].join('\n') : [s.heading, s.lead, ...(s.items || []).map((it, i) => (s.style === 'lettered' ? `(${String.fromCharCode(97 + i)}) - ` : s.style === 'para' ? '' : '• ') + (it.label ? it.label + ': ' : '') + it.text)].filter(Boolean).join('\n')).join('\n\n');

  let prepCache = store.get('prepdocs', []);
  const pushPrep = debounce(() => fetch('/api/prepdocs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prepCache) }).then(flashSaved).catch(() => {}), 300);
  function savePrep(list) { prepCache = list; store.set('prepdocs', list); pushPrep(); renderPrep(); }
  fetch('/api/prepdocs').then((r) => r.json()).then((d) => { if (Array.isArray(d)) { prepCache = d; store.set('prepdocs', d); } renderPrep(); }).catch(renderPrep);

  const KIND_NAME = { frontline: 'Frontline', extension: 'Extensions', weighing: 'Weighing', ballot: 'Ballot directives', paracase: 'Paraphrased case' };
  function renderPrep() {
    const box = $('prepDocs');
    if (!prepCache.length) { box.innerHTML = '<div class="empty">Nothing written yet. Pick what you need above and Negi writes it in your style.</div>'; return; }
    box.innerHTML = '';
    prepCache.forEach((d, i) => {
      const ck = d.checks || {}, warn = (ck.unknownAuthors || []).length || (ck.slop || []).length || (ck.paraWarnings || []).length;
      const w = document.createElement('div'); w.className = 'card-wrap prep-doc';
      const notes = [
        ck.rewrote ? '🔧 Rewritten once automatically to pass the voice and length checks.' : '',
        (ck.slop || []).length ? `⚠️ Still contains: ${ck.slop.join(', ')}. Reword before reading it.` : '',
        (ck.unknownAuthors || []).length ? `⚠️ Mentions ${ck.unknownAuthors.join(', ')}, which isn't one of your cards. Check it or swap in your own card.` : '',
        /\[(stat|card)\]/.test(prepPlain(d)) ? 'ℹ️ Fill in the [stat] / [card] blanks from your evidence.' : '',
        (ck.paraWarnings || []).length ? `⚠️ Check these paraphrases against the original: ${ck.paraWarnings.slice(0, 6).join('; ')}${ck.paraWarnings.length > 6 ? ` and ${ck.paraWarnings.length - 6} more` : ''}.` : '',
        (ck.longParts || []).length ? `ℹ️ ${ck.longParts.join('; ')}. Trim or split it before reading.` : '',
      ].filter(Boolean);
      w.innerHTML = `<div class="card-bar"><span class="badge ${warn ? 'review' : 'verified'}">${warn ? '⚠ CHECK' : '✔ SOUNDS LIKE YOU'}</span><b>${esc(d.side || '')}</b><span class="chip">${esc(KIND_NAME[d.kind] || d.kind)}</span><span class="sp"></span>
        <button class="pix small" data-a="copy">Copy</button><button class="pix small ghost" data-a="del">✕</button></div>
        ${notes.length ? `<div class="checks"><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : ''}
        <div class="card">${prepHtml(d)}</div>`;
      w.querySelector('[data-a=copy]').onclick = async () => { await copyRich(prepHtml(d), prepPlain(d)); say('Copied! Paste it into your prep doc ✨', 'happy'); };
      w.querySelector('[data-a=del]').onclick = () => { const l = prepCache.slice(); l.splice(i, 1); savePrep(l); };
      box.appendChild(w);
    });
  }
  $('prepCopyAll').onclick = async () => { if (!prepCache.length) return; await copyRich(prepCache.map(prepHtml).join(''), prepCache.map(prepPlain).join('\n\n')); say(`Copied all your prep! 📋`, 'happy'); };
  $('prepClear').onclick = () => { if (confirm('Delete all written prep?')) savePrep([]); };
  for (const k of FMT_KEYS) $(k).addEventListener('input', () => renderPrep());

  // ---- uploaded files (read in the browser; only their text is kept)
  const ROLES = [['mine', 'My case'], ['theirs', 'Their case'], ['flow', 'Their responses / my flow'], ['style', 'My old prep (copy my style)'], ['notes', 'Other notes']];
  const pushUploads = debounce(() => fetch('/api/prepuploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(uploads) }).then(flashSaved).catch(() => {}), 300);
  fetch('/api/prepuploads').then((r) => r.json()).then((d) => { if (Array.isArray(d)) uploads = d; renderUploads(); }).catch(() => {});
  function guessRole(name) {
    const n = name.toLowerCase();
    if (/flow|rebuttal|responses?|blocks? against|their|opp/.test(n)) return 'flow';
    if (/prep|frontline|\bfl\b|extension|weighing|yammers/.test(n)) return 'style';
    const side = $('prepSide').value.toLowerCase();
    if ((side === 'pro' && /\b(con|neg)\b/.test(n)) || (side === 'con' && /\b(pro|aff)\b/.test(n))) return 'theirs';
    return 'mine';
  }
  function renderUploads() {
    const box = $('fileList');
    box.innerHTML = '';
    for (const u of uploads) {
      const row = document.createElement('div'); row.className = 'file-row';
      row.innerHTML = `<span class="file-name" title="${esc(u.name)}">📄 ${esc(u.name)}</span>
        <span class="muted">${u.chars.toLocaleString()} chars${u.cut ? ' (first 40,000 used)' : ''}</span>
        <select aria-label="What is ${esc(u.name)}?">${ROLES.map(([v, l]) => `<option value="${v}"${u.role === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <button class="pix small ghost" title="Remove">✕</button>`;
      row.querySelector('select').onchange = (e) => { u.role = e.target.value; pushUploads(); showKind(); };
      row.querySelector('button').onclick = () => { uploads = uploads.filter((x) => x !== u); renderUploads(); pushUploads(); };
      box.appendChild(row);
    }
  }
  async function addFiles(files) {
    for (const f of files) {
      prepLog(`📎 Reading ${f.name}…`);
      try {
        const r = await NegiUploads.fileToText(f);
        uploads = uploads.filter((x) => x.name !== f.name).concat({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: f.name, role: guessRole(f.name), ...r });
        prepLog(`✅ ${f.name}: ${r.chars.toLocaleString()} characters read. Check its label below the upload button.`);
      } catch (e) { prepLog(`❌ ${f.name}: ${e.message}`, 'error'); }
    }
    renderUploads(); pushUploads(); showKind();
    if (uploads.length) say('Got your files! Tell me what each one is, then hit Write 📎', 'happy');
  }
  $('fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
  const dz = $('dropZone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
  // a file dropped anywhere else shouldn't make the browser open it in Negi's place
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!dz.contains(e.target)) e.preventDefault(); }));

  function prepLog(text, cls) { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; $('prepLog').appendChild(d); $('prepLog').scrollTop = 1e9; }
  $('prepBtn').onclick = async () => {
    const job = {
      kind: $('prepKind').value, side: $('prepSide').value, speech: $('prepSpeech').value, topic: $('topic').value.trim(),
      ours: $('prepOurs').value.trim(), theirs: $('prepTheirs').value.trim(), frame: $('prepFrame').value.trim(),
      mechs: [...document.querySelectorAll('#mechs input:checked')].map((i) => i.value), fill: $('prepFill').checked,
      cutCards: $('prepCut').checked, cardIds: [...document.querySelectorAll('#cardPick input:checked')].map((i) => i.value), ...dateBounds(),
      judge: $('prepJudge').value, includeOriginals: $('prepOriginals').checked,
      uploads: uploads.map(({ name, role, text, markup }) => ($('prepKind').value === 'paracase' ? { name, role, text, markup } : { name, role, text: text.slice(0, 40000) })),
    };
    const up = (...r) => uploads.some((u) => r.includes(u.role));
    if (job.kind === 'paracase') {
      if (!up('mine')) return say('Upload your case and label it "My case" first! 📄', 'worried');
    } else {
      if (!job.ours && !up('mine', 'notes')) return say('Tell me your argument, or upload your case! 🥺', 'worried');
      if (job.kind === 'frontline' && !job.theirs && !up('theirs', 'flow')) return say('List their responses, or upload their case or your flow! 🥺', 'worried');
    }
    $('prepLog').innerHTML = ''; setBusy(true);
    try {
      await stream('/api/prep', job, (m) => {
        if (m.type === 'state') say(m.say, m.state);
        else if (m.type === 'log') prepLog((m.kind === 'search' ? '🔍 ' : m.kind === 'read' ? '📖 ' : m.kind === 'warn' ? '⚠️ ' : '• ') + m.text, m.kind === 'warn' ? 'warn' : '');
        else if (m.type === 'error') prepLog('❌ ' + m.message, 'error');
        else if (m.type === 'cards') { const lib = getCards(); lib.unshift(...m.cards); saveCards(lib); renderCards(); renderPick(); }
        else if (m.type === 'prep') { savePrep([m.doc, ...prepCache]); prepLog('✅ Done. It\'s at the top of "Your prep" below.'); }
      });
    } catch (e) { if (e.name !== 'AbortError') prepLog('❌ ' + e.message, 'error'); }
    setBusy(false);
  };
})();
