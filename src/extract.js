// Pure DOM -> data extraction for Naver dictionary result pages.
// Selectors were taken from saved en.dict.naver.com and hanja.dict.naver.com pages (2026-11).
// Shared by harvest.js (in iframes) and the test suite.
(function (root) {
  'use strict';

  const clean = (s) =>
    (s || '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([,.;:!?)\]])/g, '$1')
      .replace(/([(\[])\s+/g, '$1')
      .trim();

  const txt = (el) => (el ? clean(el.textContent) : '');

  // Visible text without screen-reader-only (.blind) spans, buttons and audio widgets.
  function visibleText(el) {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('.blind, button, .unit_listen, .listen_global_area, script, style').forEach((n) => n.remove());
    return clean(c.textContent);
  }

  function abs(href, base) {
    if (!href) return '';
    try { return new URL(href, base).href; } catch (e) { return href; }
  }

  function sectionCount(doc) {
    const c = doc.querySelector('.section_title .count');
    if (!c) return null;
    const n = parseInt(c.textContent.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function meansOf(row) {
    const out = [];
    row.querySelectorAll('.mean_list .mean_item').forEach((li) => {
      const num = txt(li.querySelector('.num')).replace(/\.$/, '');
      const meanEl = li.querySelector('.mean');
      out.push({ num, text: visibleText(meanEl || li).replace(/^\d+\.\s*/, '') });
    });
    row.querySelectorAll('.entry_mean_list .entry_mean_item').forEach((it) => {
      out.push({ num: txt(it.querySelector('.num')).replace(/\.$/, ''), text: visibleText(it.querySelector('.cont') || it) });
    });
    return out.filter((m) => m.text);
  }

  function sourceOf(row, base) {
    const a = row.querySelector('a.source');
    return a ? { name: txt(a), href: abs(a.getAttribute('href'), base) } : { name: '', href: '' };
  }

  // Word / meaning rows (en.dict range=word|meaning, hanja.dict range=word)
  function keywordRow(row, base) {
    const link = row.querySelector('.origin a.link');
    const mark = row.querySelector('.origin .mark');
    const reading = row.querySelector('.origin .mean'); // hanja.dict: hangul reading of a hanja word
    const prons = [...row.querySelectorAll('.pronounce_area .pronounce_item')].map((p) => visibleText(p));
    const syn = [...row.querySelectorAll('.synonym_info .item')].map((a) => txt(a));
    return {
      head: visibleText(link),
      hanja: txt(mark),
      reading: txt(reading),
      href: link ? abs(link.getAttribute('href'), base) : '',
      pron: [...new Set(prons)].join(' · '),
      means: meansOf(row),
      synonyms: syn,
      source: sourceOf(row, base),
    };
  }

  // Single hanja character rows (hanja.dict range=letter)
  function letterRow(row, base) {
    const link = row.querySelector('.hanja_word .hanja_link');
    const info = {};
    row.querySelectorAll('.hanja_info .info_item').forEach((it) => {
      const k = txt(it.querySelector('.cate'));
      const d = it.querySelector('.desc');
      if (k) info[k] = visibleText(d).replace(/획순보기.*$/, '').trim();
    });
    const stroke = row.querySelector('[data-src*="aniSVG"]');
    const grades = [...row.querySelectorAll('.unit_tooltip')].map((t) => txt(t)).filter(Boolean);
    const star = row.querySelector('.star_grade');
    return {
      char: txt(link),
      hunEum: txt(row.querySelector('.hanja_word .mean')),
      href: link ? abs(link.getAttribute('href'), base) : '',
      radical: info['부수'] || '',
      strokes: info['총 획수'] || '',
      info,
      grades,
      level: star ? star.getAttribute('aria-label') || '' : '',
      means: meansOf(row),
      variants: visibleText(row.querySelector('.addtion_desc')),
      strokeSvg: stroke ? stroke.getAttribute('data-src') : '',
      source: sourceOf(row, base),
    };
  }

  // Example rows: dictionary examples (EN origin, KO translate) and Weverse rows (KO origin, EN translate)
  function exampleRow(row, base) {
    const ko = row.querySelector('.text[lang="ko"]');
    const en = row.querySelector('.text[lang="en"]');
    const src = sourceOf(row, base);
    const idEl = row.querySelector('[exampleid], [data-id]');
    return {
      ko: visibleText(ko),
      en: visibleText(en),
      source: src.name,
      sourceHref: src.href,
      id: idEl ? idEl.getAttribute('exampleid') || idEl.getAttribute('data-id') : '',
    };
  }

  // kind: 'keyword' | 'letter' | 'example'
  function extract(doc, kind, base) {
    base = base || (doc.location ? doc.location.href : 'https://en.dict.naver.com/');
    let rows, fn;
    if (kind === 'letter') {
      rows = [...doc.querySelectorAll('.component_keyword .row')].filter((r) => r.querySelector('.hanja_word'));
      fn = letterRow;
    } else if (kind === 'example') {
      rows = [...doc.querySelectorAll('.component_example .row')];
      fn = exampleRow;
    } else {
      rows = [...doc.querySelectorAll('.component_keyword .row')].filter((r) => r.querySelector('.origin a.link'));
      fn = keywordRow;
    }
    const items = rows.map((r) => fn(r, base));
    const sig = items.length ? JSON.stringify(items[0]).slice(0, 200) + '|' + items.length : '';
    return { items, total: sectionCount(doc), sig };
  }

  const api = { extract, clean };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LxExtract = api;
})(typeof window !== 'undefined' ? window : globalThis);
