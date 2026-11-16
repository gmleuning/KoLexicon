// Top-frame UI on en.dict.naver.com. Hides Naver's page (hide.css) and renders its own layout inside a
// shadow root so Naver's CSS can't leak in.
(function () {
  'use strict';
  if (window.top !== window) return;

  const S = window.KdSources;
  const CFG = window.KdSettings;
  const HANJA_ORIGIN = 'https://hanja.dict.naver.com';
  let settings = { ...CFG.DEFAULTS };

  // ------------------------------------------------------------------ helpers
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false && c !== '') el.append(c instanceof Node ? c : String(c));
    return el;
  };
  const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));
  // Normalized headword: no spaces/hyphens, no trailing homograph number (쉬다1 → 쉬다), lower-case.
  const norm = (s) => (s || '').replace(/\s+/g, '').replace(/[-^·]/g, '').replace(/[0-9¹²³⁴⁵⁶⁷⁸⁹⁰]+$/, '').toLowerCase();
  const short = (s, n) => { s = (s || '').split(/[;；]/)[0].trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const isEnglish = (q) => !S.HANGUL.test(q) && /[a-z]/i.test(q);

  function readQuery() {
    const m = location.hash.match(/[?&]query=([^&]*)/) || location.search.match(/[?&]query=([^&]*)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim(); } catch (e) { return m[1]; }
  }
  const isEntryPage = () => /#\/entry\//.test(location.hash) || /\/entry\//.test(location.pathname);

  // Highlights the query in a line: Korean stem (먹다 → 먹) or a whole English word.
  function highlight(text, q, lang) {
    const frag = document.createDocumentFragment();
    let re = null;
    if (lang === 'ko' && S.HANGUL.test(q)) {
      let stem = q.replace(/\s+/g, ' ').trim();
      if (/다$/.test(stem) && stem.length > 1) stem = stem.slice(0, -1);
      re = new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    } else if (lang === 'en' && isEnglish(q)) {
      re = new RegExp('\\b' + q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'gi');
    }
    if (!re) { frag.append(text || ''); return frag; }
    let i = 0;
    for (const m of (text || '').matchAll(re)) {
      frag.append(text.slice(i, m.index), h('mark', {}, m[0]));
      i = m.index + m[0].length;
    }
    frag.append((text || '').slice(i));
    return frag;
  }

  // Collapsible wrapper used for sections and entries. Marker: ▼ open, ◀ closed (CSS).
  const fold = (cls, open, summaryKids, ...body) => h('details', { class: 'fold ' + cls, open: open !== false }, h('summary', {}, summaryKids), ...body);

  // ------------------------------------------------------------------ hidden Naver frames
  // Each request gets a fresh iframe: reusing one frame and changing its hash sometimes left Naver showing
  // the previous search. Requests per role run one at a time.
  class NaverFrame {
    constructor(name, origin) {
      this.name = name;
      this.origin = origin;
      this.queue = Promise.resolve();
      this.seq = 0;
    }
    load(hash) {
      const run = () => new Promise((resolve) => {
        const frameName = `kd-harvest-${this.name}-${++this.seq}`;
        let iframe = null;
        const onMsg = (e) => {
          if (!e.data || e.data.kd !== 'harvest' || e.data.frame !== frameName) return;
          finish(e.data);
        };
        const finish = (v) => {
          if (!iframe) return;
          window.removeEventListener('message', onMsg);
          clearTimeout(timer);
          if (!frameBox.classList.contains('debug')) iframe.remove();
          iframe = null;
          resolve(v);
        };
        const timer = setTimeout(() => finish({ ok: false, items: [], error: 'Naver did not respond (blocked or very slow).' }), 30000);
        window.addEventListener('message', onMsg);
        iframe = h('iframe', { name: frameName, src: this.origin + '/' + hash, tabindex: '-1', 'aria-hidden': 'true' });
        frameBox.appendChild(iframe);
      });
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }
  }

  class Pager {
    constructor(frame, range, extra) {
      Object.assign(this, { frame, range, extra: extra || '', page: 0, done: false, total: null, count: 0, busy: false });
    }
    hash(q, page) {
      return `#/search?range=${this.range}${this.extra}&query=${encodeURIComponent(q)}${page > 1 ? '&page=' + page : ''}`;
    }
    async next(q) {
      if (this.done || this.busy) return [];
      this.busy = true;
      const r = await this.frame.load(this.hash(q, this.page + 1));
      this.busy = false;
      if (!r.ok || !r.items.length) { this.done = true; this.error = r.error; return []; }
      this.page++;
      if (r.total != null) this.total = r.total;
      this.count += r.items.length;
      if (this.total != null && this.count >= this.total) this.done = true;
      return r.items;
    }
  }

  // ------------------------------------------------------------------ scaffold
  const host = h('div', { id: 'kd-host' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.appendChild(h('link', { rel: 'stylesheet', href: chrome.runtime.getURL('src/app.css') }));

  const input = h('input', { type: 'search', placeholder: '단어 검색 · search Korean or English', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search' });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); go(input.value.trim()); } },
    h('span', { class: 'brand' }, 'KoDex'), input, h('button', { type: 'submit' }, 'Search'));
  const toggles = h('div', { class: 'toggles' });
  const tools = h('div', { class: 'tools' },
    h('button', { class: 'ghost', type: 'button', title: 'Show the original Naver page', onclick: () => toggleNaver(true) }, 'Naver page'),
    h('button', { class: 'ghost', type: 'button', onclick: () => chrome.runtime.sendMessage({ type: 'openOptions' }) }, 'Settings'));
  const header = h('header', { class: 'bar' }, form, toggles, tools);

  const colEls = {
    left: h('section', { class: 'col left', 'aria-label': 'Left column' }),
    right: h('section', { class: 'col right', 'aria-label': 'Right column' }),
  };
  const cols = h('main', { class: 'cols' }, colEls.left, colEls.right);
  const frameBox = h('div', { class: 'frames', 'aria-hidden': 'true' });
  try { if (localStorage.getItem('kdDebug')) frameBox.classList.add('debug'); } catch (e) { /* storage blocked */ }
  const app = h('div', { class: 'app' }, header, cols, frameBox);
  shadow.appendChild(app);
  const backBtn = h('button', { class: 'back', type: 'button', onclick: () => toggleNaver(false) }, '← KoDex');
  shadow.appendChild(backBtn);

  const frames = {
    word: new NaverFrame('word', 'https://en.dict.naver.com'),
    meaning: new NaverFrame('meaning', 'https://en.dict.naver.com'),
    example: new NaverFrame('example', 'https://en.dict.naver.com'),
    vlive: new NaverFrame('vlive', 'https://en.dict.naver.com'),
    hanja: new NaverFrame('hanja', HANJA_ORIGIN),
  };

  function toggleNaver(showNaver) {
    document.documentElement.classList.toggle('kd-off', showNaver);
    app.hidden = showNaver;
    backBtn.hidden = !showNaver;
  }

  function applyLook() {
    CFG.loadFonts(document, [settings.fontKo, settings.fontEn, settings.fontHan]);
    const sys = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", Roboto, Helvetica, Arial, sans-serif';
    app.style.setProperty('--font', [settings.fontEn && `"${settings.fontEn}"`, settings.fontKo && `"${settings.fontKo}"`, sys].filter(Boolean).join(', '));
    app.style.setProperty('--font-han', [settings.fontHan && `"${settings.fontHan}"`, settings.fontKo && `"${settings.fontKo}"`, '"Noto Serif KR", "Noto Sans KR", serif'].filter(Boolean).join(', '));
    app.style.setProperty('--fs', (settings.fontSize || 15) + 'px');
  }

  // ------------------------------------------------------------------ layout (built once per settings change)
  const TITLES = {
    krdict: 'KRDict · 한국어-영어 학습사전', hanja: 'Hanja', hanjaDetail: 'Character', naver: 'Naver',
    wiktionary: 'Wiktionary', etymology: 'Etymology', related: 'Related words', meanings: 'English headwords glossed with this word',
    examples: 'Examples', hanjaPanel: '한자',
  };
  const BTN = { krdict: 'KRDict', hanja: '漢字', hanjaDetail: '字 detail', naver: 'Naver', wiktionary: 'Wiktionary', etymology: 'Etymology', related: 'Related', meanings: 'EN headwords', examples: 'Examples', hanjaPanel: 'Hanja' };

  let blocks = {}; // id -> {item, el, title, count, content, tabHost?}
  const ui = { toggled: {}, dismissed: {}, context: {} }; // context[id] = false hides a block for this search
  const exView = h('div', { class: 'ex-view' });
  const panelView = h('div', { class: 'panel-view' });

  function buildLayout() {
    blocks = {};
    colEls.left.replaceChildren();
    colEls.right.replaceChildren();
    toggles.replaceChildren();
    for (const col of ['left', 'right']) {
      const items = settings.layout.filter((x) => x.col === col && x.mode !== 'off');
      const tabItems = items.filter((x) => CFG.BLOCKS.find((b) => b.id === x.id).tab);
      let tabHost = null;
      for (const item of items) {
        const def = CFG.BLOCKS.find((b) => b.id === item.id);
        if (def.tab) {
          if (!tabHost) {
            tabHost = makeTabHost(tabItems);
            colEls[col].append(tabHost.el);
          }
          blocks[item.id] = { item, el: tabHost.el, tabHost, content: item.id === 'examples' ? exView : panelView };
        } else {
          const title = h('span', { class: 'sec-title' }, TITLES[item.id]);
          const count = h('span', { class: 'count' });
          const content = h('div', { class: 'content' });
          const el = h('div', { class: 'block b-' + item.id, 'data-block': item.id }, fold('sec', item.open, [title, count], content));
          colEls[col].append(el);
          blocks[item.id] = { item, el, title, count, content };
        }
        if (item.mode === 'button') {
          toggles.append(h('button', { type: 'button', class: 'toggle', 'data-id': item.id, title: def.name, onclick: () => toggleBlock(item.id) }, BTN[item.id]));
        }
      }
    }
    refreshVisibility();
  }

  function makeTabHost(members) {
    const strip = h('div', { class: 'rtabs', role: 'tablist' });
    const views = h('div', { class: 'tabviews' });
    const host = { el: h('div', { class: 'block tabhost' }, strip, views), active: null, tabs: {}, views: {} };
    members.forEach((m) => {
      const view = m.id === 'examples' ? exView : panelView;
      const tab = h('button', { type: 'button', role: 'tab', onclick: () => { host.active = m.id; onShown(m.id); refreshVisibility(); } }, TITLES[m.id]);
      host.tabs[m.id] = tab;
      host.views[m.id] = view;
      strip.append(tab);
      views.append(view);
    });
    strip.append(h('button', { type: 'button', class: 'rclose', title: 'Close', onclick: () => {
      const id = host.active;
      if (!id) return;
      if (blocks[id].item.mode === 'button') ui.toggled[id] = false; else ui.dismissed[id] = true;
      host.active = null;
      refreshVisibility();
    } }, '×'));
    return host;
  }

  const isVisible = (id) => {
    const b = blocks[id];
    if (!b || ui.context[id] === false) return false;
    return b.item.mode === 'show' ? !ui.dismissed[id] : !!ui.toggled[id];
  };

  function refreshVisibility() {
    const hosts = new Set();
    for (const [id, b] of Object.entries(blocks)) {
      if (b.tabHost) { hosts.add(b.tabHost); continue; }
      b.el.hidden = !isVisible(id);
    }
    hosts.forEach((t) => {
      const vis = Object.keys(t.tabs).filter(isVisible);
      if (!vis.includes(t.active)) t.active = vis[vis.length - 1] || null;
      t.el.hidden = !vis.length;
      Object.entries(t.tabs).forEach(([id, tab]) => {
        tab.hidden = !vis.includes(id);
        tab.setAttribute('aria-selected', String(id === t.active));
        t.views[id].hidden = id !== t.active;
      });
      t.el.querySelector('.rtabs').classList.toggle('single-tab', vis.length < 2);
    });
    const shown = (col) => [...colEls[col].children].some((c) => !c.hidden);
    colEls.left.hidden = !shown('left');
    colEls.right.hidden = !shown('right');
    cols.classList.toggle('single', colEls.left.hidden || colEls.right.hidden);
    toggles.querySelectorAll('.toggle').forEach((b) => b.setAttribute('aria-pressed', String(isVisible(b.dataset.id))));
  }

  function toggleBlock(id) {
    ui.toggled[id] = !ui.toggled[id];
    if (ui.toggled[id]) {
      ui.dismissed[id] = false;
      if (blocks[id] && blocks[id].tabHost) blocks[id].tabHost.active = id;
      onShown(id);
    }
    refreshVisibility();
  }

  function showBlock(id) {
    const b = blocks[id];
    if (!b) return false;
    if (b.item.mode === 'button') ui.toggled[id] = true;
    ui.dismissed[id] = false;
    if (b.tabHost) b.tabHost.active = id;
    onShown(id);
    refreshVisibility();
    return true;
  }

  function onShown(id) {
    if (id === 'examples' && ex) ex.ensure();
  }

  // Section helpers for one search.
  function sec(id) {
    const b = blocks[id];
    if (!b || b.tabHost) return null;
    b.content.replaceChildren(h('p', { class: 'loading' }, 'Loading…'));
    b.count.textContent = '';
    b.title.textContent = TITLES[id];
    return {
      b,
      set: (...k) => b.content.replaceChildren(...k),
      note: (m, c) => b.content.replaceChildren(h('p', { class: c || 'muted' }, m)),
      count: (n) => { b.count.textContent = n ? ' ' + n : ''; },
      title: (t) => { b.title.textContent = t; },
    };
  }

  // ------------------------------------------------------------------ hanja panel
  const panelFrame = h('iframe', { name: 'kd-panel', title: 'Naver 한자사전' });
  const trBtn = h('button', { type: 'button', class: 'ghost', onclick: () => translatePanel() }, 'Translate');
  const trStatus = h('span', { class: 'small muted' });
  const openOut = h('a', { class: 'small', target: '_blank', rel: 'noopener', href: HANJA_ORIGIN }, 'Open in tab ↗');
  const panelEmpty = h('p', { class: 'muted hint' }, 'Click any hanja to open its Naver 한자사전 page here.');
  panelView.append(h('div', { class: 'panel-bar' }, trBtn, trStatus, openOut), panelEmpty);
  let translator = null;
  let trState = 'original';
  const trCache = new Map();

  function resetTr() { trState = 'original'; trBtn.textContent = 'Translate'; trStatus.textContent = ''; }

  function openHanjaPanel(url, label) {
    if (!blocks.hanjaPanel) { window.open(url, '_blank', 'noopener'); return; }
    resetTr();
    if (blocks.hanjaPanel.tabHost) blocks.hanjaPanel.tabHost.tabs.hanjaPanel.textContent = label ? '한자 ' + label : '한자';
    if (!panelFrame.isConnected) panelEmpty.replaceWith(panelFrame);
    if (panelFrame.getAttribute('src') !== url) panelFrame.src = url;
    openOut.href = url;
    showBlock('hanjaPanel');
  }

  function openHanja(hz) {
    if (!hz) return;
    if ([...hz].length === 1) {
      const label = hz;
      openHanjaPanel(`${HANJA_ORIGIN}/#/search?range=letter&query=${encodeURIComponent(hz)}`, label);
      charData(hz).naver.then((d) => {
        const tab = blocks.hanjaPanel && blocks.hanjaPanel.tabHost && blocks.hanjaPanel.tabHost.tabs.hanjaPanel;
        if (d.item && d.item.href && /#\/entry\//.test(d.item.href) && (!tab || tab.textContent === '한자 ' + label)) openHanjaPanel(d.item.href, label);
      });
    } else {
      openHanjaPanel(`${HANJA_ORIGIN}/#/search?range=all&query=${encodeURIComponent(hz)}`, hz);
    }
  }

  window.addEventListener('message', async (e) => {
    if (e.origin !== HANJA_ORIGIN || !e.data || e.source !== panelFrame.contentWindow) return;
    if (e.data.kd === 'panel-nav') {
      resetTr();
      openOut.href = e.data.href;
    } else if (e.data.kd === 'panel-texts') {
      const texts = e.data.texts || [];
      const map = {};
      let done = 0;
      const todo = texts.filter((t) => !trCache.has(t));
      texts.forEach((t) => { if (trCache.has(t)) map[t] = trCache.get(t); });
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (todo.length) {
          const t = todo.shift();
          try { const r = await translator.translate(t); trCache.set(t, r); map[t] = r; } catch (err) { /* skip */ }
          done++;
          trStatus.textContent = `Translating… ${done}/${texts.length}`;
        }
      }));
      panelFrame.contentWindow.postMessage({ kd: 'apply', map }, HANJA_ORIGIN);
      trState = 'translated';
      trBtn.textContent = 'Show original';
      trStatus.textContent = 'Translated on-device · hover for original';
    }
  });

  async function translatePanel() {
    if (!panelFrame.isConnected || trState === 'busy') return;
    if (trState === 'translated') { panelFrame.contentWindow.postMessage({ kd: 'restore' }, HANJA_ORIGIN); resetTr(); return; }
    if (!('Translator' in self)) { trStatus.textContent = 'Chrome’s on-device translator isn’t available in this browser.'; return; }
    trState = 'busy';
    try {
      if (!translator) {
        trStatus.textContent = 'Preparing translator…';
        translator = await Translator.create({
          sourceLanguage: 'ko', targetLanguage: 'en',
          monitor(m) { m.addEventListener('downloadprogress', (ev) => { trStatus.textContent = `Downloading Korean→English model ${Math.round(ev.loaded * 100)}%`; }); },
        });
      }
      trStatus.textContent = 'Translating…';
      panelFrame.contentWindow.postMessage({ kd: 'collect' }, HANJA_ORIGIN);
    } catch (err) {
      trState = 'original';
      trStatus.textContent = 'Translator error: ' + err.message;
    }
  }

  // ------------------------------------------------------------------ search
  let token = 0;
  let current = '';
  let ex = null;

  function go(q) {
    if (!q) return;
    const hash = `#/search?range=all&query=${encodeURIComponent(q)}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    run(q);
  }

  // Sorts Naver "Word·Idiom" rows into: main (the headword), phrases (→ examples), idioms (English only),
  // related (other words), equivalents (Korean words for an English query). English headwords on a Korean
  // search, Naver's Wiktionary rows and single-word open-dictionary rows are dropped.
  function classify(items, q) {
    const en = isEnglish(q);
    const out = { main: [], phrases: [], idioms: [], related: [], equivalents: [] };
    const nq = norm(q);
    for (const it of items) {
      const src = it.source.name || '';
      if (/wiktionary/i.test(src + it.href)) continue;
      const isEnko = /\/entry\/enko\//.test(it.href);
      const isKoen = /\/entry\/koen\//.test(it.href);
      const isOpen = /open-pro|opendict/.test(it.href);
      const head = it.head.trim();
      const nh = norm(head);
      const sentence = /[.?!…]$/.test(head);
      if (en) {
        if (isKoen) { out.equivalents.push(it); continue; }
        if (isOpen) { if (/\s/.test(head) || sentence) out.phrases.push(it); continue; }
        if (nh === nq) out.main.push(it);
        else if (sentence) out.phrases.push(it);
        else out.idioms.push(it);
      } else {
        if (isEnko) continue;
        if (nh === nq || nh === nq + '하다' || nh === nq + '되다' || nh === nq + '히') out.main.push(it);
        else if (/\s/.test(head) || sentence || isOpen) out.phrases.push(it);
        else out.related.push(it);
      }
    }
    return out;
  }

  // Phrase rows → example pairs. YBM phrasebook rows prefix English with a Korean topic label ("건강과 운동").
  function phraseToExamples(it, en) {
    const tag = /^([가-힣·]+(?:\s[가-힣·]+){0,3})\s+(?=[A-Za-z"'(])/;
    const glosses = it.means.map((m) => m.text.replace(tag, '').trim()).filter(Boolean).join(' / ');
    return en ? { ko: glosses, en: it.head, source: it.source.name || 'Naver', sourceHref: it.href }
      : { ko: it.head, en: glosses, source: it.source.name || 'Naver', sourceHref: it.href };
  }

  async function run(q) {
    if (!q) return;
    const my = ++token;
    current = q;
    input.value = q;
    document.title = `${q} · KoDex`;
    const alive = () => my === token;
    const en = isEnglish(q);
    ui.context = { hanja: !en, hanjaDetail: false };
    colEls.left.scrollTop = 0;
    colEls.right.scrollTop = 0;

    const head = h('div', { class: 'headword' }, h('h1', {}, q));
    const firstCol = colEls.left.hidden ? colEls.right : colEls.left;
    shadow.querySelectorAll('.headword').forEach((x) => x.remove());
    firstCol.prepend(head);

    startExamples(q, alive);
    refreshVisibility();

    const kr = sec('krdict');
    const nv = sec('naver');
    const wk = sec('wiktionary');
    const rel = sec('related');
    const mean = sec('meanings');
    const ety = sec('etymology');
    const hz = sec('hanja');
    const hzd = sec('hanjaDetail');
    if (hz) hz.note('Looking for hanja…', 'loading');
    if (hzd) hzd.set();
    if (rel && en) rel.title('Korean equivalents');
    if (mean && en) mean.title('Korean words glossed with this word');

    const found = { hanja: [], wikt: [], wordTypes: [], origins: [], equivalents: [] };
    const addHanja = (t, from) => {
      t = S.hanOnly(t);
      if (!t) return null;
      let x = found.hanja.find((y) => y.hanja === t);
      if (!x) found.hanja.push((x = { hanja: t, from: [], gloss: {} }));
      if (!x.from.includes(from)) x.from.push(from);
      return x;
    };

    let hanjaSig = null;
    const refresh = () => {
      if (!alive()) return;
      if (ety) renderEtymology(ety, found);
      if (en) return;
      const sig = found.hanja.map((x) => x.hanja + ':' + (x.gloss.krdict || x.gloss.wikt || x.gloss.naver || '')).join('|');
      if (sig !== hanjaSig) { hanjaSig = sig; renderHanjaSelector(q, found, alive); }
    };

    // --- Naver words
    const pNv = frames.word.load(`#/search?range=word&query=${encodeURIComponent(q)}&shouldSearchOpen=false`).then((r) => {
      if (!alive()) return;
      if (!r.ok) { if (nv) nv.note(r.error || 'Naver failed.', 'error'); return; }
      const c = classify(r.items, q);
      if (nv) {
        const kids = c.main.length ? c.main.map((it) => renderNaverWord(it)) : [h('p', { class: 'muted' }, r.items.length ? 'No exact headword in Naver’s first results.' : 'No results on Naver.')];
        if (c.idioms.length) kids.push(fold('sub', false, ['Idioms & phrases ', h('span', { class: 'count' }, c.idioms.length)], ...c.idioms.map((it) => renderNaverWord(it, true))));
        kids.push(h('p', { class: 'muted small' }, `${fmt(r.total)} word/idiom results · `,
          h('a', { href: `https://en.dict.naver.com/#/search?range=word&query=${encodeURIComponent(q)}`, target: '_blank' }, 'see all on Naver')));
        nv.set(...kids);
        nv.count(c.main.length);
      }
      if (ex) ex.add(c.phrases.map((it) => phraseToExamples(it, en)), 'Naver dictionaries');
      if (en) {
        found.equivalents.push(...c.equivalents.map((it) => ({ word: it.head.replace(/[0-9]+$/, ''), hanja: it.hanja, gloss: it.means.map((m) => m.text).join('; '), href: it.href })));
        renderEquivalents(rel, found);
      } else {
        if (rel) {
          if (c.related.length) { rel.set(h('ul', { class: 'related' }, c.related.map(renderRelated))); rel.count(c.related.length); }
          else rel.note('None on the first page of Naver results.');
        }
        c.main.filter((it) => it.hanja).forEach((it) => {
          const x = addHanja(it.hanja, 'Naver');
          if (x && !x.gloss.naver) x.gloss.naver = it.means[0] && it.means[0].text.replace(/\[[^\]]*\]\s*/g, '').split(/[,;]/)[0];
        });
      }
    });

    // --- Wiktionary
    const pWk = (en ? S.wikiEnglish(q) : S.wikiKorean(q)).then((r) => {
      if (!alive()) return;
      if (r.error) { if (wk) wk.note(r.error, 'error'); return; }
      if (r.missing || !r.groups || !r.groups.length) {
        if (wk) wk.set(h('p', { class: 'muted' }, `No ${en ? 'English' : 'Korean'} entry. `, h('a', { href: S.wikiUrl(q), target: '_blank' }, 'Wiktionary page')));
        return;
      }
      found.wikt = r.groups;
      if (!en) r.groups.forEach((g) => { if (g.hanja) { const x = addHanja(g.hanja, 'Wiktionary'); if (x) { x.gloss.wikt = g.gloss; x.etym = g.etym; } } });
      if (en && r.translations) {
        r.translations.forEach((t) => t.words.forEach((w) => found.equivalents.push({ word: w, gloss: t.gloss, from: 'Wiktionary' })));
        renderEquivalents(rel, found);
      }
      if (wk) {
        const parts = r.groups.map((g, i) => {
          const title = g.hanja ? [h('span', { class: 'hz', lang: 'zh-Hani' }, g.hanja), ' ', short(g.gloss, 40)]
            : r.groups.length > 1 ? (g.etym ? short(g.etym, 70) : `Etymology ${i + 1}`) : null;
          const box = title ? fold('entry wgroup', true, h('span', { class: 'grp' }, title), g.defs) : h('div', { class: 'wgroup' }, g.defs);
          wireLinks(box);
          return box;
        });
        wk.set(...parts, h('a', { class: 'srclink', href: r.url, target: '_blank' }, 'Wiktionary: ' + q));
        wk.count(r.groups.length > 1 ? r.groups.length : '');
      }
    }).catch((e) => alive() && wk && wk.note('Wiktionary failed: ' + e.message, 'error'));

    // --- KRDict (Korean: direct; English: via Korean equivalents from Naver + Wiktionary)
    const pKr = (en ? Promise.allSettled([pNv, pWk]).then(() => {
      const cands = [...new Set(found.equivalents.map((x) => x.word.replace(/[0-9]+$/, '').trim()).filter((w) => S.HANGUL.test(w) && w.length < 12))];
      if (kr) kr.note(cands.length ? `Checking ${Math.min(cands.length, 8)} Korean equivalents in KRDict…` : 'No Korean equivalents to look up yet.', 'loading');
      return cands.length ? S.krdictEnglish(q, cands, settings.krdictKey) : { entries: [] };
    }) : S.krdict(q, settings.krdictKey)).then((r) => {
      if (!alive()) return;
      if (r.error) { if (kr) kr.note(r.error, 'error'); return; }
      if (!r.entries.length) { if (kr) kr.note(en ? 'No KRDict entries translate this word.' : 'No entry.'); return; }
      if (kr) { kr.set(...r.entries.map(renderKrEntry)); kr.count(r.entries.length); }
      if (en) return;
      r.entries.forEach((e) => {
        if (e.wordType) found.wordTypes.push(e.wordType);
        const han = e.original.filter((o) => /한자/.test(o.type)).map((o) => o.text);
        if (!e.original.length && S.hanOnly(e.origin)) han.push(e.origin);
        han.forEach((t) => { const x = addHanja(t, 'KRDict'); if (x && !x.gloss.krdict) x.gloss.krdict = e.senses[0] && e.senses[0].enWord; });
        e.original.filter((o) => !/한자/.test(o.type) && o.text).forEach((o) => found.origins.push(o));
      });
      const pron = [...new Set(r.entries.map((e) => e.pron).filter(Boolean))];
      if (pron.length) head.append(h('span', { class: 'pron' }, '[' + pron.join(' / ') + ']'));
    }).catch((e) => alive() && kr && kr.note('KRDict failed: ' + e.message, 'error'));

    // --- Naver Meanings (lazy, when the section is opened)
    if (mean) {
      mean.note('Open to load.');
      const det = mean.b.el.querySelector('details.sec');
      const loadMeanings = () => {
        mean.note('Loading…', 'loading');
        frames.meaning.load(`#/search?range=meaning&query=${encodeURIComponent(q)}`).then((r) => {
          if (!alive()) return;
          const items = r.items.filter((it) => !/wiktionary/i.test(it.source.name + it.href));
          if (!items.length) return mean.note(r.error || 'None.');
          mean.set(...items.map((it) => renderNaverWord(it, true)));
          mean.count(items.length);
        });
      };
      if (det.open && !mean.b.el.hidden) loadMeanings();
      else det.addEventListener('toggle', function once() { if (!det.open) return; det.removeEventListener('toggle', once); if (alive()) loadMeanings(); });
    }

    [pKr, pNv, pWk].forEach((p) => p.then(refresh, refresh));
    await Promise.allSettled([pKr, pNv, pWk]);
    if (!alive()) return;
    if (!en && !found.hanja.length) {
      if (hz) hz.note('No hanja for this word.');
      ui.context.hanjaDetail = false;
      refreshVisibility();
    }
  }

  // ------------------------------------------------------------------ renderers
  function renderKrEntry(e) {
    const tags = [e.pos, e.wordType, e.grade && e.grade !== '없음' ? e.grade : ''].filter(Boolean);
    return fold('entry', true,
      h('span', { class: 'hw' }, e.word.replace(/[-^]/g, ''), e.supNo && e.supNo !== '0' ? h('sup', {}, e.supNo) : '',
        e.original.map((o) => /한자/.test(o.type) ? hanjaLink(o.text, 'hanja') : h('span', { class: 'hanja' }, o.text)),
        tags.map((t) => h('span', { class: 'pos' }, t))),
      h('ol', { class: 'senses' }, e.senses.map((s) => h('li', {},
        s.enWord ? h('span', { class: 'en-word' }, s.enWord) : '',
        s.enDef ? h('span', { class: 'en-def' }, s.enDef) : '',
        s.def ? h('span', { class: 'ko-def', lang: 'ko' }, s.def) : ''))),
      e.link ? h('a', { class: 'srclink', href: e.link, target: '_blank' }, 'KRDict entry') : '');
  }

  function hanjaLink(text, cls) {
    const t = S.hanOnly(text);
    if (!t) return h('span', { class: cls }, text);
    return h('button', { type: 'button', class: 'hzlink ' + (cls || ''), lang: 'zh-Hani', title: 'Open in Naver 한자사전', onclick: (e) => { e.preventDefault(); e.stopPropagation(); openHanja(t); } }, text);
  }

  function renderNaverWord(it, compact) {
    const sum = h('span', { class: 'hw' },
      it.href ? h('a', { href: it.href, target: '_blank', title: 'Open Naver entry' }, it.head) : it.head,
      it.hanja ? hanjaLink(it.hanja, 'hanja') : '',
      it.pron ? h('span', { class: 'pron' }, it.pron) : '');
    return fold('entry' + (compact ? ' compact' : ''), true, sum,
      h('ul', { class: 'senses' + (it.means.length > 1 ? ' numbered' : '') }, it.means.map((m) => h('li', {}, posSplit(m.text)))),
      it.source.name ? h('span', { class: 'muted small' }, it.source.name) : '');
  }

  function renderRelated(it) {
    return h('li', {},
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); go(it.head.replace(/[0-9]+$/, '')); } }, it.head),
      it.hanja ? [' ', hanjaLink(it.hanja, 'hanja')] : '',
      h('span', { class: 'muted' }, ' — ' + short(it.means.map((m) => m.text).join('; ').replace(/\[[^\]]*\]\s*/g, ''), 90)));
  }

  // English query: Korean equivalents from Naver rows and Wiktionary translation tables, merged by word.
  function renderEquivalents(rel, found) {
    if (!rel) return;
    const by = new Map();
    found.equivalents.forEach((x) => {
      const k = x.word.trim();
      if (!k) return;
      const cur = by.get(k) || { word: k, hanja: '', glosses: [] };
      if (x.hanja && !cur.hanja) cur.hanja = x.hanja;
      if (x.gloss && !cur.glosses.includes(x.gloss)) cur.glosses.push(x.gloss);
      by.set(k, cur);
    });
    const list = [...by.values()];
    if (!list.length) { rel.note('None found yet.'); return; }
    rel.set(h('ul', { class: 'related' }, list.map((x) => h('li', {},
      h('a', { href: '#', lang: 'ko', onclick: (e) => { e.preventDefault(); go(x.word); } }, x.word),
      x.hanja ? [' ', hanjaLink(x.hanja, 'hanja')] : '',
      x.glosses.length ? h('span', { class: 'muted' }, ' — ' + short(x.glosses.join('; '), 90)) : ''))));
    rel.count(list.length);
  }

  function posSplit(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\[[^\]]{1,6}\])/).forEach((p) => {
      if (/^\[(명사|동사|형용사|부사|대명사|감탄사|관형사|수사|조사|의존명사|접사|어미|Noun|Verb|Adjective|Adverb)\]$/.test(p)) frag.append(h('span', { class: 'pos' }, p.slice(1, -1)));
      else if (p) frag.append(p.replace(/^,\s*/, ''));
    });
    return frag;
  }

  function wireLinks(root) {
    root.querySelectorAll('a[data-kdq]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      go(a.dataset.kdq);
    }));
    root.querySelectorAll('a[data-kdhan]').forEach((a) => a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      openHanja(a.dataset.kdhan);
    }));
  }

  function renderEtymology(ety, found) {
    const parts = [];
    const types = [...new Set(found.wordTypes)];
    if (types.length) parts.push(h('p', {}, h('span', { class: 'label' }, 'KRDict'), types.join(' · ')));
    found.origins.forEach((o) => parts.push(h('p', { class: 'muted' }, h('span', { class: 'label' }, 'Origin'), `${o.text} (${o.type || '?'})`)));
    const trivial = /^Sino-Korean word from \S+\.?$/;
    found.wikt.filter((g) => g.etym && !trivial.test(g.etym)).forEach((g) => {
      parts.push(h('p', {}, h('span', { class: 'label' }, g.hanja ? g.hanja : 'Wiktionary'), g.etym));
    });
    if (!parts.length) parts.push(h('p', { class: 'muted' }, found.hanja.length ? 'Sino-Korean — see Hanja.' : 'No etymology found.'));
    ety.set(...parts);
  }

  // ------------------------------------------------------------------ hanja selector
  const charCache = new Map();
  function charData(ch) {
    if (!charCache.has(ch)) {
      charCache.set(ch, {
        naver: frames.hanja.load(`#/search?range=letter&query=${encodeURIComponent(ch)}`).then((r) => ({
          item: r.items.find((it) => it.char === ch) || null, error: r.error,
        })),
        wikt: S.wikiChar(ch).catch((e) => ({ error: e.message })),
      });
    }
    return charCache.get(ch);
  }

  function renderHanjaSelector(q, found, alive) {
    const hb = blocks.hanja && !blocks.hanja.tabHost ? blocks.hanja : null;
    const db = blocks.hanjaDetail && !blocks.hanjaDetail.tabHost ? blocks.hanjaDetail : null;
    if (!found.hanja.length) return;
    ui.context.hanjaDetail = true;
    refreshVisibility();
    const prevSel = hb && hb.content.querySelector('.tabs [aria-selected="true"] .hz');
    const keep = prevSel ? found.hanja.findIndex((x) => x.hanja === prevSel.textContent) : -1;
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    const panel = h('div', { class: 'hanja-panel' });
    const label = (x) => short(x.gloss.krdict || x.gloss.wikt || x.gloss.naver || '', 22);
    const select = (i) => {
      [...tabs.children].forEach((t, k) => t.setAttribute('aria-selected', String(k === i)));
      renderHanjaWord(panel, db, found.hanja[i], q, alive);
    };
    found.hanja.forEach((x, i) => tabs.append(h('button', { role: 'tab', type: 'button', onclick: () => select(i), title: 'From ' + x.from.join(', ') },
      h('span', { class: 'hz', lang: 'zh-Hani' }, x.hanja), label(x) ? h('span', { class: 'gl' }, label(x)) : '')));
    if (hb) {
      hb.content.replaceChildren(found.hanja.length > 1 ? tabs : '', panel);
      hb.count.textContent = found.hanja.length > 1 ? ' ' + found.hanja.length : '';
    }
    select(keep > 0 ? keep : 0);
  }

  function renderHanjaWord(panel, db, x, q, alive) {
    const hzw = x.hanja;
    const chars = [...hzw];
    const cells = chars.map((c) => ({ c, hun: h('span', { class: 'hun' }, '…'), gloss: h('span', { class: 'gloss' }) }));
    const naverWord = h('div', { class: 'hz-word' }, h('p', { class: 'loading' }, 'Naver 한자사전…'));
    let btns = [];
    const pick = (i) => {
      btns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
      if (db) renderChar(db.content, chars[i], alive);
    };
    btns = cells.map((cell, i) => h('button', {
      type: 'button', class: 'cell', 'aria-pressed': String(i === 0), title: 'Open ' + cell.c + ' in Naver 한자사전',
      onclick: () => { pick(i); openHanja(cell.c); },
    }, h('span', { class: 'ch', lang: 'zh-Hani' }, cell.c), cell.hun, cell.gloss));

    panel.replaceChildren(
      h('div', { class: 'hz-box' },
        h('div', { class: 'hz-title' },
          h('button', { type: 'button', class: 'big hzlink', lang: 'zh-Hani', title: 'Open ' + hzw + ' in Naver 한자사전', onclick: () => openHanja(hzw) }, hzw),
          h('span', { class: 'reading' }, q)),
        h('div', { class: 'cells', style: `--n:${chars.length}` }, btns)),
      x.etym && !/^Sino-Korean word from \S+\.?$/.test(x.etym) ? h('p', { class: 'small muted' }, x.etym) : '',
      naverWord);
    if (db) pick(0);

    S.wikiHanjaWord(hzw).then((w) => {
      if (!alive()) return;
      cells.forEach((cell) => { if (w.glosses[cell.c]) cell.gloss.textContent = w.glosses[cell.c]; });
      cells.forEach((cell) => {
        if (!cell.gloss.textContent) charData(cell.c).wikt.then((d) => { if (!cell.gloss.textContent && d.gloss) cell.gloss.textContent = short(d.gloss, 40); });
      });
    });
    cells.forEach((cell) => charData(cell.c).naver.then((d) => { cell.hun.textContent = d.item ? d.item.hunEum : ''; }));

    frames.hanja.load(`#/search?range=word&query=${encodeURIComponent(hzw)}`).then((r) => {
      if (!alive()) return;
      const items = r.items.filter((it) => norm(it.head) === norm(hzw));
      if (!items.length) return naverWord.replaceChildren(h('p', { class: 'muted small' }, r.error || 'No Naver 한자사전 word entry for ' + hzw + '.'));
      naverWord.replaceChildren(...items.map((it) => {
        const list = h('ul', { class: 'senses clamp' }, it.means.map((m) => h('li', { lang: 'ko' }, m.text)));
        const more = it.means.length > 2 || it.means.some((m) => m.text.length > 120)
          ? h('button', { type: 'button', class: 'linkbtn', onclick: (e) => { list.classList.toggle('clamp'); e.target.textContent = list.classList.contains('clamp') ? 'more' : 'less'; } }, 'more') : '';
        return fold('entry', true,
          h('span', { class: 'hw' }, h('button', { type: 'button', class: 'hzlink', lang: 'zh-Hani', onclick: (e) => { e.preventDefault(); openHanjaPanel(it.href, it.head); } }, it.head),
            h('span', { class: 'pron' }, it.reading), h('span', { class: 'pos' }, 'Naver 한자사전')),
          list, more,
          it.synonyms.length ? h('p', { class: 'small' }, h('span', { class: 'label' }, '유의어'), it.synonyms.join(' · ')) : '');
      }));
    });
  }

  function renderChar(target, ch, alive) {
    const nv = h('div', { class: 'cd-naver' }, h('p', { class: 'loading' }, 'Naver…'));
    const wk = h('div', { class: 'cd-wikt' }, h('p', { class: 'loading' }, 'Wiktionary…'));
    const detail = h('div', { class: 'char-detail', 'data-ch': ch },
      h('div', { class: 'cd-head' }, h('button', { type: 'button', class: 'ch hzlink', lang: 'zh-Hani', title: 'Open in Naver 한자사전', onclick: () => openHanja(ch) }, ch)), nv, wk);
    target.replaceChildren(detail);
    const d = charData(ch);
    d.naver.then(({ item, error }) => {
      if (!alive() || !detail.isConnected) return;
      if (!item) return nv.replaceChildren(h('p', { class: 'muted small' }, error || 'Not found in Naver 한자사전.'));
      nv.replaceChildren(
        h('p', { class: 'hun-big', lang: 'ko' }, item.hunEum),
        h('dl', { class: 'facts' },
          item.radical ? [h('dt', {}, '부수'), h('dd', {}, item.radical)] : '',
          item.strokes ? [h('dt', {}, '획수'), h('dd', {}, item.strokes)] : '',
          item.grades.length ? [h('dt', {}, '급수'), h('dd', {}, item.grades.join(' · '))] : '',
          item.variants ? [h('dt', {}, '이체'), h('dd', {}, item.variants)] : ''),
        h('ol', { class: 'senses' }, item.means.map((m) => h('li', { lang: 'ko' }, m.text))),
        h('button', { type: 'button', class: 'linkbtn', onclick: () => openHanjaPanel(item.href, ch) }, 'Full Naver page (stroke order, 학습정보) →'));
    });
    d.wikt.then((w) => {
      if (!alive() || !detail.isConnected) return;
      const parts = [];
      if (w.translingual && w.translingual.length) parts.push(fold('entry wk-sub', true, 'Translingual', ...w.translingual.map((n) => n.cloneNode(true))));
      if (w.glyph && w.glyph.childNodes.length) parts.push(fold('entry wk-sub', true, 'Glyph origin', w.glyph.cloneNode(true)));
      if (w.zhDefs && w.zhDefs.length) parts.push(fold('entry wk-sub', true, 'Chinese definitions', h('ol', {}, w.zhDefs.map((t) => h('li', {}, t)))));
      if (w.korean && w.korean.childNodes.length) parts.push(fold('entry wk-sub', true, 'Korean', w.korean.cloneNode(true)));
      if (!parts.length) parts.push(h('p', { class: 'muted small' }, w.error || 'No Wiktionary data.'));
      parts.push(h('a', { class: 'srclink', href: w.url, target: '_blank' }, 'Wiktionary: ' + ch));
      parts.forEach((p) => wireLinks(p));
      wk.replaceChildren(...parts);
    });
  }

  // ------------------------------------------------------------------ examples
  const GROUPS = ['Naver dictionaries', 'Weverse', 'Tatoeba'];

  function startExamples(q, alive) {
    const prev = ex;
    const st = {
      q, items: [], keys: new Set(), started: false,
      sort: (prev && prev.sort) || 'short',
      off: (prev && prev.off) || new Set(),
      pagers: { dict: new Pager(frames.example, 'example', '&shouldSearchVlive=false'), weverse: new Pager(frames.vlive, 'vlive') },
      tatoeba: { state: 'idle', n: 0 },
    };
    ex = st;
    const en = isEnglish(q);
    const lenOf = (it) => (en ? it.en : it.ko || '').length;

    const status = h('p', { class: 'ex-status' });
    const list = h('ol', { class: 'examples' });
    const moreBtn = h('button', { type: 'button', class: 'more', onclick: () => loadMore(1) }, 'Load more');
    const more5 = h('button', { type: 'button', class: 'more ghost', onclick: () => loadMore(5) }, '+5 pages');
    const sortSel = h('select', { 'aria-label': 'Sort', onchange: (e) => { st.sort = e.target.value; draw(); } },
      [['short', 'Shortest first'], ['long', 'Longest first'], ['source', 'By source']].map(([v, t]) => h('option', { value: v, selected: st.sort === v }, t)));
    const chips = h('div', { class: 'chips' }, GROUPS.map((g) => h('label', { class: 'chip' },
      h('input', { type: 'checkbox', checked: !st.off.has(g), onchange: (e) => { if (e.target.checked) st.off.delete(g); else st.off.add(g); draw(); } }), g)));
    const minLen = h('input', { type: 'number', min: '0', max: '200', value: '0', class: 'minlen', 'aria-label': 'Minimum length', oninput: () => draw() });

    exView.replaceChildren(
      h('div', { class: 'ex-bar' },
        h('div', { class: 'ex-controls' }, sortSel, h('label', { class: 'small muted' }, 'min chars ', minLen), chips),
        status),
      list,
      h('div', { class: 'ex-more' }, moreBtn, more5));

    st.add = (items, group) => {
      for (const it of items) {
        if (!it.ko && !it.en) continue;
        const k = norm(it.ko) + '|' + norm(it.en);
        if (st.keys.has(k)) continue;
        st.keys.add(k);
        const g = /weverse/i.test(it.source || '') ? 'Weverse' : group;
        st.items.push({ ...it, group: g, len: lenOf(it) });
      }
      draw();
    };

    function updateStatus() {
      const d = st.pagers.dict;
      const w = st.pagers.weverse;
      const part = (label, p) => `${label} ${fmt(p.count)}${p.total != null ? '/' + fmt(p.total) : ''}${p.busy ? '…' : ''}`;
      const t = st.tatoeba.state === 'loading' ? 'Tatoeba …' : st.tatoeba.state === 'error' ? 'Tatoeba ✕' : `Tatoeba ${st.tatoeba.n}`;
      status.textContent = st.started ? [part('Naver', d), part('Weverse', w), t].join(' · ') : '';
      const exhausted = d.done && w.done;
      moreBtn.disabled = more5.disabled = exhausted || d.busy || w.busy;
      moreBtn.textContent = exhausted ? 'All loaded' : 'Load more';
    }

    function draw() {
      if (st !== ex) return;
      const min = parseInt(minLen.value, 10) || 0;
      const arr = st.items.filter((it) => !st.off.has(it.group) && it.len >= min);
      if (st.sort === 'short') arr.sort((a, b) => a.len - b.len);
      else if (st.sort === 'long') arr.sort((a, b) => b.len - a.len);
      else arr.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.len - b.len);
      const frag = document.createDocumentFragment();
      for (const it of arr) {
        const ko = h('p', { class: 'ko', lang: 'ko' }, highlight(it.ko, q, 'ko'));
        const enL = h('p', { class: 'en', lang: 'en' }, highlight(it.en, q, 'en'));
        frag.append(h('li', { class: 'ex g-' + it.group.split(' ')[0].toLowerCase() },
          en ? [enL, ko] : [ko, enL],
          h('p', { class: 'meta' }, it.sourceHref ? h('a', { href: it.sourceHref, target: '_blank' }, it.source || it.group) : (it.source || it.group))));
      }
      list.replaceChildren(frag);
      if (!arr.length) list.append(h('li', { class: 'muted' }, st.items.length ? 'All examples filtered out.' : st.started ? 'Loading…' : ''));
      updateStatus();
    }

    async function loadPage(p, group) {
      const pr = p.next(q);
      updateStatus();
      const items = await pr;
      if (!alive()) return;
      st.add(items, group);
    }

    async function loadMore(n) {
      for (let i = 0; i < n && alive(); i++) {
        const d = st.pagers.dict;
        const w = st.pagers.weverse;
        if (d.done && w.done) break;
        await Promise.all([d.done ? null : loadPage(d, 'Naver dictionaries'), w.done ? null : loadPage(w, 'Weverse')]);
      }
      updateStatus();
    }

    // Network work for examples starts only when the Examples view is first shown.
    st.ensure = () => {
      if (st.started) return;
      st.started = true;
      loadMore(Math.max(1, settings.initialPages | 0));
      if (settings.tatoebaLimit > 0) {
        st.tatoeba.state = 'loading';
        S.tatoeba(q, settings.tatoebaLimit).then((r) => {
          if (!alive()) return;
          st.tatoeba = { state: r.error ? 'error' : 'done', n: r.items.length };
          st.add(r.items, 'Tatoeba');
        });
      }
      draw();
    };
    draw();
    if (isVisible('examples') && (!blocks.examples.tabHost || blocks.examples.tabHost.active === 'examples')) st.ensure();
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    document.documentElement.appendChild(host);
    applyLook();
    buildLayout();
    toggleNaver(isEntryPage());
    const q = readQuery();
    if (q && !isEntryPage()) run(q);
    else if (!q) {
      colEls.left.prepend(h('p', { class: 'muted hint headword' }, 'Type a Korean or English word above.'));
      input.focus();
    }
  }

  function onNav() {
    if (isEntryPage()) { toggleNaver(true); return; }
    toggleNaver(false);
    const q = readQuery();
    if (q && q !== current) run(q);
  }

  window.addEventListener('hashchange', onNav);
  window.addEventListener('popstate', onNav);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    CFG.load((s) => {
      settings = s;
      applyLook();
      buildLayout();
      if (current) run(current);
    });
  });

  CFG.load((s) => { settings = s; boot(); });
})();
