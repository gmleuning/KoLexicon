// Runs in hanja.dict.naver.com frames. Only acts in the extension's side-panel iframe (window.name "lx-panel"):
// adds html.lx-panel (panel.css trims Naver's chrome) and handles on-device translation requests from the parent.
(function () {
  'use strict';
  if (window.top === window || window.name !== 'lx-panel') return;
  document.documentElement.classList.add('lx-panel');

  const PARENT = 'https://en.dict.naver.com';
  const HANGUL = /[가-힣]/;
  let nodes = []; // {node, orig, tr}
  let translated = false;

  function collect() {
    const root = document.querySelector('#content') || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('.blind, [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
        return HANGUL.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    nodes = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push({ node: n, orig: n.nodeValue, tr: null });
    const uniq = [...new Set(nodes.map((x) => x.orig.trim()))];
    return uniq;
  }

  function apply(map) {
    nodes.forEach((x) => {
      const t = map[x.orig.trim()];
      if (t == null) return;
      x.tr = x.orig.replace(x.orig.trim(), t);
      x.node.nodeValue = x.tr;
      if (x.node.parentElement && !x.node.parentElement.title) x.node.parentElement.title = x.orig.trim();
    });
    translated = true;
  }

  function restore() {
    nodes.forEach((x) => { if (x.node.isConnected) x.node.nodeValue = x.orig; });
    translated = false;
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT || !e.data) return;
    const d = e.data;
    if (d.lx === 'collect') window.parent.postMessage({ lx: 'panel-texts', texts: collect() }, PARENT);
    else if (d.lx === 'apply') apply(d.map || {});
    else if (d.lx === 'restore') restore();
  });

  const announce = () => {
    translated = false;
    nodes = [];
    window.parent.postMessage({ lx: 'panel-nav', href: location.href, title: document.title }, PARENT);
  };
  window.addEventListener('hashchange', announce);
  window.addEventListener('popstate', announce);
})();
