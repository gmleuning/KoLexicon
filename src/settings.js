// Shared settings: defaults, layout blocks, font lists. Used by app.js and options.js.
(function (root) {
  'use strict';

  // Blocks, in default order. col: 'left' | 'right'. mode: 'show' | 'button' (toggle in top bar) | 'off'.
  // open: default expanded (true) or collapsed (false). Examples + Hanja panel share a tab strip when in one column.
  const BLOCKS = [
    { id: 'krdict', name: 'KRDict definitions (한국어-영어 학습사전)', col: 'left', mode: 'show' },
    { id: 'hanja', name: 'Hanja selector and box', col: 'left', mode: 'show' },
    { id: 'hanjaDetail', name: 'Hanja character detail (Naver + Wiktionary summary)', col: 'left', mode: 'show' },
    { id: 'naver', name: 'Naver definitions', col: 'left', mode: 'show' },
    { id: 'wiktionary', name: 'Wiktionary definitions', col: 'left', mode: 'show' },
    { id: 'etymology', name: 'Etymology notes', col: 'left', mode: 'show' },
    { id: 'related', name: 'Related words / Korean equivalents', col: 'left', mode: 'show', open: false },
    { id: 'meanings', name: 'English headwords glossed with this word', col: 'left', mode: 'show', open: false },
    { id: 'examples', name: 'Examples', col: 'right', mode: 'button', tab: true },
    { id: 'hanjaPanel', name: 'Hanja panel (Naver 한자사전 page)', col: 'right', mode: 'button', tab: true },
  ];
  const defItem = (b) => ({ id: b.id, col: b.col, mode: b.mode, open: b.open !== false });

  const FONTS = {
    ko: ['Noto Sans KR', 'Noto Serif KR', 'IBM Plex Sans KR', 'Nanum Gothic', 'Nanum Myeongjo', 'Gowun Dodum', 'Gowun Batang', 'Gothic A1', 'Hahmlet', 'Song Myung', 'Sunflower', 'Gaegu'],
    en: ['Inter', 'Source Sans 3', 'IBM Plex Sans', 'Roboto', 'Open Sans', 'Lato', 'Literata', 'Lora', 'Merriweather', 'EB Garamond', 'Crimson Pro', 'Libre Baskerville'],
    han: ['Noto Serif KR', 'Noto Sans KR', 'Noto Serif TC', 'Noto Sans TC', 'Noto Serif JP', 'Noto Serif SC', 'LXGW WenKai TC'],
  };

  const DEFAULTS = {
    krdictKey: '',
    initialPages: 2,
    tatoebaLimit: 100,
    layout: BLOCKS.map(defItem),
    fontKo: '',
    fontEn: '',
    fontHan: '',
    fontSize: 15,
  };

  // Keep saved order, fill in fields added in newer versions, drop unknown blocks, append new blocks.
  function normalizeLayout(saved) {
    const byId = new Map(BLOCKS.map((b) => [b.id, b]));
    const out = [];
    (Array.isArray(saved) ? saved : []).forEach((x) => {
      const b = x && byId.get(x.id);
      if (!b || out.some((o) => o.id === x.id)) return;
      out.push({
        id: x.id,
        col: x.col === 'right' || x.col === 'left' ? x.col : b.col,
        mode: ['show', 'button', 'off'].includes(x.mode) ? x.mode : b.mode,
        open: typeof x.open === 'boolean' ? x.open : b.open !== false,
      });
    });
    BLOCKS.forEach((b) => { if (!out.some((o) => o.id === b.id)) out.push(defItem(b)); });
    return out;
  }

  function load(cb) {
    chrome.storage.sync.get(DEFAULTS, (s) => {
      const merged = { ...DEFAULTS, ...s };
      merged.layout = normalizeLayout(merged.layout);
      cb(merged);
    });
  }

  // Google Fonts stylesheet URL for one family. Weight 400+700 first; caller falls back to the plain family.
  const fontUrl = (family, weights) =>
    'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family).replace(/%20/g, '+') + (weights ? ':wght@400;700' : '') + '&display=swap';

  // Adds <link> tags for the chosen families to a document (Google Fonts must be declared at document level).
  function loadFonts(doc, families) {
    [...new Set(families.filter(Boolean))].forEach((f) => {
      const id = 'kd-font-' + f.replace(/\W+/g, '-');
      if (doc.getElementById(id)) return;
      const link = doc.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = fontUrl(f, true);
      link.onerror = () => { link.onerror = null; link.href = fontUrl(f, false); };
      (doc.head || doc.documentElement).appendChild(link);
    });
  }

  const stack = (f, fallback) => (f ? `"${f.replace(/"/g, '')}", ` : '') + fallback;

  root.KdSettings = { BLOCKS, FONTS, DEFAULTS, normalizeLayout, load, loadFonts, stack };
})(typeof window !== 'undefined' ? window : globalThis);
