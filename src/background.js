// Service worker: performs cross-origin fetches for the page (Wiktionary, KRDict, Tatoeba)
// and keeps a small cache in chrome.storage.local.
'use strict';

const ALLOWED = ['en.wiktionary.org', 'krdict.korean.go.kr', 'api.tatoeba.org'];
const TTL = 7 * 24 * 3600 * 1000;
const MAX_CACHE = 600;

async function cached(url) {
  const key = 'c:' + url;
  const got = await chrome.storage.local.get(key);
  const hit = got[key];
  if (hit && Date.now() - hit.t < TTL) return hit;
  return null;
}

async function store(url, status, body) {
  const key = 'c:' + url;
  await chrome.storage.local.set({ [key]: { t: Date.now(), status, body } });
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('c:'));
  if (keys.length > MAX_CACHE) {
    keys.sort((a, b) => all[a].t - all[b].t);
    await chrome.storage.local.remove(keys.slice(0, keys.length - MAX_CACHE));
  }
}

async function doFetch(url, noCache) {
  const host = new URL(url).hostname;
  if (!ALLOWED.includes(host)) return { ok: false, status: 0, body: 'host not allowed: ' + host };
  if (!noCache) {
    const hit = await cached(url);
    if (hit) return { ok: hit.status >= 200 && hit.status < 300, status: hit.status, body: hit.body, cached: true };
  }
  try {
    const res = await fetch(url, { headers: { 'Api-User-Agent': 'KoDex/0.3.0 (personal browser extension)' } });
    const body = await res.text();
    // Cache successes and 404s (missing Wiktionary pages), not transient errors.
    if (res.ok || res.status === 404) await store(url, res.status, body);
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'fetch') {
    doFetch(msg.url, msg.noCache).then(reply);
    return true;
  }
  if (msg && msg.type === 'clearCache') {
    chrome.storage.local.get(null).then((all) =>
      chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('c:'))).then(() => reply({ ok: true }))
    );
    return true;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
  }
});
