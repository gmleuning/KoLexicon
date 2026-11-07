// Runs inside hidden Naver iframes that app.js creates (window.name starts with "lx-harvest").
// Waits for Naver's single-page app to render a result list, extracts it, and posts it to the parent.
// The parent can ask for another page with {lx:'goto', hash}.
(function () {
  'use strict';
  if (window.top === window || !String(window.name).startsWith('lx-harvest')) return;

  const PARENT = 'https://en.dict.naver.com';
  const TIMEOUT = 12000;

  function kindFromHash() {
    // Naver uses both #/search?… and /en/search?… URLs; read range from either.
    const range = (location.href.match(/[?&]range=([a-z]+)/) || [])[1] || 'all';
    if (range === 'letter') return 'letter';
    if (range === 'example' || range === 'vlive') return 'example';
    return 'keyword';
  }

  let lastSig = null;

  function waitAndSend(reqId) {
    const kind = kindFromHash();
    const started = Date.now();
    let prev = null;
    let stableTicks = 0;
    const tick = () => {
      const r = LxExtract.extract(document, kind, location.href);
      const fresh = r.items.length > 0 && r.sig !== lastSig;
      if (fresh && r.sig === prev) stableTicks++;
      else stableTicks = 0;
      prev = r.sig;
      if (fresh && stableTicks >= 2) {
        lastSig = r.sig;
        post({ reqId, ok: true, kind, items: r.items, total: r.total, hash: location.hash });
      } else if (Date.now() - started > TIMEOUT) {
        // Nothing (new) rendered: treat as "no results / no further pages".
        post({ reqId, ok: true, kind, items: [], total: r.total, hash: location.hash, timedOut: true });
      } else {
        setTimeout(tick, 250);
      }
    };
    tick();
  }

  function post(msg) {
    msg.lx = 'harvest';
    msg.frame = window.name;
    window.parent.postMessage(msg, PARENT);
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== PARENT || !e.data || e.data.lx !== 'goto') return;
    if (e.data.hash && e.data.hash !== location.hash) {
      location.hash = e.data.hash;
      waitAndSend(e.data.reqId);
    } else {
      // Same page requested again: answer with what is already rendered.
      const r = LxExtract.extract(document, kindFromHash(), location.href);
      post({ reqId: e.data.reqId, ok: true, kind: kindFromHash(), items: r.items, total: r.total, hash: location.hash });
    }
  });

  waitAndSend('initial');
})();
