// Non-Naver sources: KRDict (한국어기초사전 / 한국어-영어 학습사전), Wiktionary, Tatoeba.
// Network goes through the service worker; parsing happens here (service workers have no DOMParser).
(function (root) {
  'use strict';

  const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2FA1F}]/u;
  const HAN_RUN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2FA1F}]+/gu;
  const HANGUL = /[가-힣]/;
  const hanOnly = (s) => ((s || '').match(HAN_RUN) || []).join('');

  function bgFetch(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'fetch', url }, (r) => resolve(r || { ok: false, status: 0, body: chrome.runtime.lastError && chrome.runtime.lastError.message }));
      } catch (e) {
        resolve({ ok: false, status: 0, body: String(e) });
      }
    });
  }

  const parseXml = (s) => new DOMParser().parseFromString(s, 'text/xml');
  const parseHtml = (s) => new DOMParser().parseFromString(s, 'text/html');
  const kid = (el, sel) => (el ? el.querySelector(':scope > ' + sel) : null);
  const kt = (el, sel) => { const n = kid(el, sel); return n ? n.textContent.trim() : ''; };

  // ---------------------------------------------------------------- KRDict
  const KR = 'https://krdict.korean.go.kr/api/';

  async function krdict(q, key) {
    if (!key) return { error: 'No KRDict API key set (extension options).' };
    const base = `${KR}search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&part=word&translated=y&trans_lang=1&num=20&sort=dict`;
    let r = await bgFetch(base + '&advanced=y&method=exact');
    let doc = r.ok ? parseXml(r.body) : null;
    let err = krError(doc, r);
    let items = doc && !err ? [...doc.querySelectorAll('channel > item')] : [];
    if (!items.length) {
      r = await bgFetch(base);
      doc = r.ok ? parseXml(r.body) : null;
      err = krError(doc, r);
      items = doc && !err ? [...doc.querySelectorAll('channel > item')].filter((it) => kt(it, 'word').replace(/[-^]/g, '') === q) : [];
    }
    if (err && !items.length) return { error: err };
    const entries = await Promise.all(items.slice(0, 8).map((it) => krView(it, key)));
    return { entries };
  }

  function krError(doc, r) {
    if (!r.ok) return `KRDict request failed (${r.status || 'network'}): ${String(r.body).slice(0, 160)}`;
    if (!doc) return 'KRDict: empty response';
    const e = doc.querySelector('error');
    if (e) return `KRDict error ${kt(e, 'error_code')}: ${kt(e, 'message')}`;
    if (doc.querySelector('parsererror')) return 'KRDict: could not parse XML';
    return '';
  }

  // Search item gives senses with English; view adds word type (고유어/한자어), original language (hanja), pronunciation.
  async function krView(item, key) {
    const entry = {
      code: kt(item, 'target_code'),
      word: kt(item, 'word'),
      supNo: kt(item, 'sup_no'),
      pos: kt(item, 'pos'),
      grade: kt(item, 'word_grade'),
      link: kt(item, 'link'),
      pron: kt(item, 'pronunciation'),
      origin: kt(item, 'origin'),
      wordType: '',
      original: [],
      senses: [...item.querySelectorAll(':scope > sense')].map(krSense),
    };
    if (!entry.code) return entry;
    const r = await bgFetch(`${KR}view?key=${encodeURIComponent(key)}&method=target_code&q=${entry.code}&translated=y&trans_lang=1`);
    if (!r.ok) return entry;
    const d = parseXml(r.body);
    const wi = d.querySelector('item word_info') || d.querySelector('word_info');
    if (!wi) return entry;
    entry.wordType = kt(wi, 'word_type');
    entry.original = [...wi.querySelectorAll('original_language_info')].map((o) => ({ text: kt(o, 'original_language'), type: kt(o, 'language_type') }));
    const prons = [...wi.querySelectorAll('pronunciation_info > pronunciation')].map((p) => p.textContent.trim());
    if (prons.length) entry.pron = prons.join(', ');
    if (!entry.pos) entry.pos = (wi.querySelector('pos') || { textContent: '' }).textContent.trim();
    if (!entry.grade) entry.grade = kt(wi, 'word_grade');
    const viewSenses = [...wi.querySelectorAll('sense_info')].map(krSense);
    if (viewSenses.length) entry.senses = viewSenses;
    return entry;
  }

  function krSense(s) {
    const tr = [...s.querySelectorAll(':scope > translation')].find((t) => /영어|english/i.test(kt(t, 'trans_lang')) || !kt(t, 'trans_lang')) || kid(s, 'translation');
    return {
      def: kt(s, 'definition'),
      enWord: tr ? kt(tr, 'trans_word') : '',
      enDef: tr ? kt(tr, 'trans_dfn') : '',
    };
  }

  // ---------------------------------------------------------------- Wiktionary
  const WK = 'https://en.wiktionary.org/api/rest_v1/page/html/';
  const wikiUrl = (t) => 'https://en.wiktionary.org/wiki/' + encodeURIComponent(t);

  async function wikiDoc(title) {
    const r = await bgFetch(WK + encodeURIComponent(title));
    if (r.status === 404) return { missing: true };
    if (!r.ok) return { error: `Wiktionary request failed (${r.status || 'network'})` };
    return { doc: parseHtml(r.body) };
  }

  function langSection(doc, lang) {
    const h = [...doc.querySelectorAll('h2')].find((x) => x.textContent.trim() === lang);
    return h ? h.closest('section') || h.parentElement : null;
  }

  // Subsections whose heading matches re (direct or nested).
  function subsections(sec, re) {
    return [...sec.querySelectorAll('h3, h4, h5')].filter((h) => re.test(h.textContent.trim())).map((h) => h.closest('section') || h.parentElement);
  }

  function stripJunk(el) {
    el.querySelectorAll('.mw-editsection, .mw-empty-elt, sup.reference, .reference, link, style, .NavFrame, .navbox, .maintenance-line, .checksense, .interProject, .sister-project, .audiotable, .floatright, figure, .thumb').forEach((n) => n.remove());
    return el;
  }

  // Link rewriting: Hangul titles become in-extension searches, single Han chars select the char.
  function wikiLink(href, a) {
    let title = '';
    let url = href;
    try {
      const u = new URL(href, 'https://en.wiktionary.org/wiki/');
      url = u.href;
      title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, '').replace(/^\.\//, ''));
    } catch (e) { /* ignore */ }
    const text = a.textContent.trim();
    if (title && HANGUL.test(title) && !title.includes(':')) return { href: url, data: { kdq: title } };
    if (text && hanOnly(text) === text.replace(/\s/g, '')) return { href: url, data: { kdhan: hanOnly(text) } };
    return { href: url };
  }

  function sanitizeClone(el) {
    const c = stripJunk(el.cloneNode(true));
    root.KdSanitize(c, wikiLink);
    return c;
  }

  // Korean entry for a word. Wiktionary splits homographs into "Etymology 1/2/…" sections, each usually one
  // hanja (산: 山, 酸, 算, 産). We return one group per etymology:
  //   {hanja, gloss, etym: plain text, defs: Element}
  async function wikiKorean(q) {
    const w = await wikiDoc(q);
    if (!w.doc) return w;
    const sec = langSection(w.doc, 'Korean');
    if (!sec) return { missing: true, url: wikiUrl(q) };
    const body = sanitizeClone(sec);
    const h2 = body.querySelector('h2');
    if (h2) h2.remove();
    subsections(body, /^(Pronunciation|References|Further reading|Anagrams|See also)/).forEach((s) => s.remove());

    const ownText = (s) => [...s.children].filter((c) => /^(P|UL|OL|DL)$/.test(c.tagName)).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const hanjaIn = (el, etymText) => {
      for (const p of el.querySelectorAll('p')) {
        const m = p.textContent.match(/hanja\s+([^\s)]+)/);
        if (m && hanOnly(m[1])) return hanOnly(m[1]);
      }
      const m = (etymText || '').match(/(?:word from|from)\s+([^\s.,;()]+)/);
      return m ? hanOnly(m[1]) : '';
    };
    const firstGloss = (el) => {
      const li = el.querySelector('ol > li');
      return li ? liText(li) : '';
    };

    const etymSecs = subsections(body, /^Etymology/);
    const nested = etymSecs.filter((s) => s.querySelector('section'));
    let groups;
    if (nested.length) {
      // Etymology N sections wrap their own POS sections.
      groups = nested.map((s) => {
        const etym = ownText(s);
        const head = s.querySelector(':scope > h3, :scope > h4');
        const defs = document.createElement('div');
        [...s.children].filter((c) => c.tagName === 'SECTION').forEach((c) => defs.appendChild(c));
        return { hanja: hanjaIn(defs, etym), gloss: firstGloss(defs), etym, label: head ? head.textContent.trim() : '', defs };
      });
    } else {
      const etym = etymSecs.map(ownText).join(' ');
      etymSecs.forEach((s) => s.remove());
      groups = [{ hanja: hanjaIn(body, etym), gloss: firstGloss(body), etym, label: '', defs: body }];
    }
    groups.forEach((g) => g.defs.querySelectorAll('li, p').forEach((n) => { if (!n.textContent.trim() && !n.querySelector('img')) n.remove(); }));
    groups = groups.filter((g) => g.defs.textContent.trim() || g.etym);
    return { groups, hanja: [...new Set(groups.map((g) => g.hanja).filter(Boolean))], url: wikiUrl(q) };
  }

  // Minimal glosses from the Chinese "box" table on a hanja-word page (e.g. 休息).
  async function wikiHanjaWord(word) {
    const w = await wikiDoc(word);
    if (!w.doc) return { glosses: {}, url: wikiUrl(word), missing: !!w.missing };
    const glosses = {};
    const chars = [...word];
    for (const t of w.doc.querySelectorAll('table')) {
      const rows = [...t.querySelectorAll('tr')];
      if (rows.length < 2) continue;
      const charCells = [...rows[1].querySelectorAll('td')].map((td) => td.textContent.trim());
      if (charCells.length !== chars.length || charCells.join('') !== chars.join('')) continue;
      const heads = [...rows[0].querySelectorAll('th')].map((th) => th.textContent.trim()).filter((s, i) => i > 0 || s);
      const glossCells = heads.slice(-chars.length);
      chars.forEach((c, i) => { if (glossCells[i]) glosses[c] = glossCells[i]; });
      break;
    }
    const zh = langSection(w.doc, 'Chinese');
    let zhDefs = [];
    if (zh) {
      const ol = zh.querySelector('ol');
      if (ol) zhDefs = [...ol.children].slice(0, 5).map((li) => liText(li)).filter(Boolean);
    }
    return { glosses, zhDefs, url: wikiUrl(word) };
  }

  function liText(li) {
    const c = li.cloneNode(true);
    c.querySelectorAll('ul, ol, dl, .mw-editsection, sup').forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  // Single-character page: Translingual header, Chinese glyph origin + definitions, Korean section.
  async function wikiChar(ch) {
    const w = await wikiDoc(ch);
    if (!w.doc) return { url: wikiUrl(ch), missing: !!w.missing, error: w.error };
    const out = { url: wikiUrl(ch) };
    const tl = langSection(w.doc, 'Translingual');
    if (tl) {
      const ps = [...tl.querySelectorAll('p')].filter((p) => /radical|stroke|composition|Han character/i.test(p.textContent)).slice(0, 2);
      out.translingual = ps.map((p) => sanitizeClone(p));
    }
    const zh = langSection(w.doc, 'Chinese');
    if (zh) {
      const go = subsections(zh, /^Glyph origin/)[0];
      if (go) {
        const box = document.createElement('div');
        [...go.children].filter((c) => /^(P|UL|OL|DL)$/.test(c.tagName)).forEach((c) => box.appendChild(sanitizeClone(c)));
        out.glyph = box;
      }
      const defSec = subsections(zh, /^Definitions/)[0] || zh;
      const ol = defSec.querySelector('ol');
      if (ol) {
        out.zhDefs = [...ol.children].map(liText).filter(Boolean).slice(0, 10);
        out.gloss = out.zhDefs[0] || '';
      }
    }
    const ko = langSection(w.doc, 'Korean');
    if (ko) {
      const keep = document.createElement('div');
      // Keep the Hanja part (eumhun line + its list); skip Compounds, which can be hundreds of entries.
      const hanjaSecs = subsections(ko, /^Hanja/);
      const srcSecs = hanjaSecs.length ? hanjaSecs : [ko];
      srcSecs.forEach((s) => [...s.children].filter((c) => /^(P|UL|OL|DL)$/.test(c.tagName)).forEach((c) => keep.appendChild(sanitizeClone(c))));
      subsections(ko, /^Etymology/).forEach((s) => [...s.children].filter((c) => c.tagName === 'P').forEach((c) => keep.appendChild(sanitizeClone(c))));
      out.korean = keep;
      const eum = keep.textContent.match(/\(eumhun\s+([^)]+)\)/);
      if (eum) out.eumhun = eum[1].trim();
    }
    return out;
  }

  // ---------------------------------------------------------------- Tatoeba
  const TT = 'https://api.tatoeba.org/v1/sentences';

  // Korean→English for Korean queries; English→Korean for English queries. Always returns {ko, en}.
  async function tatoeba(q, limit) {
    const english = !HANGUL.test(q);
    const [src, dst] = english ? ['eng', 'kor'] : ['kor', 'eng'];
    const terms = [q];
    if (!english) terms.push(/다$/.test(q) && q.length > 1 ? q.slice(0, -1) + '*' : q + '*');
    const seen = new Map();
    let error = '';
    for (const term of terms) {
      const url = `${TT}?lang=${src}&q=${encodeURIComponent(term)}&trans:lang=${dst}&showtrans=matching&sort=words&limit=${limit}`;
      const r = await bgFetch(url);
      if (!r.ok) { error = `Tatoeba (${r.status || 'network'})`; continue; }
      let j;
      try { j = JSON.parse(r.body); } catch (e) { continue; }
      for (const s of j.data || []) {
        const tr = [].concat(...[].concat(s.translations || []).map((t) => (Array.isArray(t) ? t : [t])));
        const other = tr.filter((t) => t && t.lang === dst).map((t) => t.text);
        if (!other.length || seen.has(s.id)) continue;
        seen.set(s.id, {
          ko: english ? other[0] : s.text,
          en: english ? s.text : other[0],
          source: 'Tatoeba', sourceHref: `https://tatoeba.org/sentences/show/${s.id}`,
        });
      }
    }
    return { items: [...seen.values()], error: seen.size ? '' : error };
  }

  // English Wiktionary entry: groups per etymology (like wikiKorean) plus the Korean translations.
  async function wikiEnglish(q) {
    let w = await wikiDoc(q);
    if (w.missing && q !== q.toLowerCase()) w = await wikiDoc(q.toLowerCase());
    if (!w.doc) return w;
    const sec = langSection(w.doc, 'English');
    if (!sec) return { missing: true, url: wikiUrl(q) };

    // Korean translations, read before sanitizing (translation tables live inside .NavFrame).
    const translations = [];
    sec.querySelectorAll('li').forEach((li) => {
      if (!/^\s*Korean\s*:/.test(li.textContent)) return;
      const frame = li.closest('.NavFrame, details, table');
      let gloss = '';
      if (frame) {
        const head = frame.querySelector('.NavHead, summary') || (frame.previousElementSibling && frame.previousElementSibling.classList.contains('NavHead') ? frame.previousElementSibling : null);
        gloss = head ? head.textContent.replace(/\s+/g, ' ').replace(/^[▼▲►\s]+/, '').trim() : (frame.getAttribute('data-gloss') || '');
      }
      const words = [...li.querySelectorAll('[lang="ko"]')].map((e) => e.textContent.trim()).filter((t) => HANGUL.test(t));
      if (words.length) translations.push({ gloss, words: [...new Set(words)] });
    });

    const body = sanitizeClone(sec);
    const h2 = body.querySelector('h2');
    if (h2) h2.remove();
    subsections(body, /^(Pronunciation|References|Further reading|Anagrams|See also|Translations|Statistics|Hyponyms|Descendants)/).forEach((s) => s.remove());
    const ownText = (s) => [...s.children].filter((c) => /^(P|UL|OL|DL)$/.test(c.tagName)).map((c) => c.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
    const firstGloss = (el) => { const li = el.querySelector('ol > li'); return li ? liText(li) : ''; };
    const etymSecs = subsections(body, /^Etymology/);
    const nested = etymSecs.filter((x) => x.querySelector('section'));
    let groups;
    if (nested.length) {
      groups = nested.map((x) => {
        const defs = document.createElement('div');
        [...x.children].filter((c) => c.tagName === 'SECTION').forEach((c) => defs.appendChild(c));
        return { hanja: '', etym: ownText(x), gloss: firstGloss(defs), defs };
      });
    } else {
      const etym = etymSecs.map(ownText).join(' ');
      etymSecs.forEach((x) => x.remove());
      groups = [{ hanja: '', etym, gloss: firstGloss(body), defs: body }];
    }
    groups.forEach((g) => g.defs.querySelectorAll('li, p').forEach((n) => { if (!n.textContent.trim()) n.remove(); }));
    return { groups: groups.filter((g) => g.defs.textContent.trim() || g.etym), translations, url: wikiUrl(q) };
  }

  // For English queries: look up Korean candidate words in KRDict and keep senses whose English matches.
  async function krdictEnglish(q, candidates, key) {
    const re = new RegExp('(^|[^a-z])' + q.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
    const out = [];
    let error = '';
    for (const c of candidates.slice(0, 8)) {
      const r = await krdict(c, key);
      if (r.error) { error = r.error; continue; }
      r.entries.forEach((e) => {
        const senses = e.senses.filter((s) => re.test(s.enWord) || re.test(s.enDef));
        if (senses.length && !out.some((o) => o.code === e.code)) out.push({ ...e, senses });
      });
    }
    return { entries: out, error: out.length ? '' : error };
  }

  root.KdSources = { krdict, krdictEnglish, wikiEnglish, wikiKorean, wikiHanjaWord, wikiChar, tatoeba, hanOnly, HAN, HANGUL, wikiUrl };
})(typeof window !== 'undefined' ? window : globalThis);
