'use strict';
const CFG = window.LxSettings;
const $ = (id) => document.getElementById(id);
const msg = (t) => { $('msg').textContent = t; clearTimeout(msg.t); msg.t = setTimeout(() => ($('msg').textContent = ''), 3000); };
let layout = [];

// ------------------------------------------------------------------ layout lists (left / right)
let dragId = null;

function renderLayout() {
  document.querySelectorAll('.layout').forEach((ol) => {
    const col = ol.dataset.col;
    ol.replaceChildren();
    layout.filter((x) => x.col === col).forEach((item) => {
      const def = CFG.BLOCKS.find((b) => b.id === item.id);
      const li = document.createElement('li');
      li.draggable = true;
      li.dataset.id = item.id;
      li.className = item.mode === 'off' ? 'off' : '';
      li.innerHTML = '<span class="grip" title="Drag">⠿</span><div class="main"><span class="name"></span><div class="ctrls">' +
        '<span class="seg"><button type="button" data-v="show">Show</button><button type="button" data-v="button">Button</button><button type="button" data-v="off">Off</button></span>' +
        (def.tab ? '' : '<button type="button" class="openbtn" title="Starts open (▼) or closed (◀)"></button>') +
        '<button type="button" class="mv" data-d="-1" aria-label="Move up">↑</button><button type="button" class="mv" data-d="1" aria-label="Move down">↓</button>' +
        '<button type="button" class="mv" data-x="1" aria-label="Move to other column" title="Move to other column">⇄</button></div></div>';
      li.querySelector('.name').textContent = def ? def.name : item.id;
      li.querySelectorAll('.seg button').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.v === item.mode));
        b.onclick = () => { item.mode = b.dataset.v; renderLayout(); };
      });
      const ob = li.querySelector('.openbtn');
      if (ob) {
        ob.textContent = item.open ? '▼' : '◀';
        ob.setAttribute('aria-pressed', String(item.open));
        ob.setAttribute('aria-label', item.open ? 'Starts open' : 'Starts closed');
        ob.onclick = () => { item.open = !item.open; renderLayout(); };
      }
      li.querySelectorAll('.mv[data-d]').forEach((b) => { b.onclick = () => step(item.id, Number(b.dataset.d)); });
      li.querySelector('.mv[data-x]').onclick = () => { item.col = item.col === 'left' ? 'right' : 'left'; moveTo(item.id, item.col, null); };
      li.addEventListener('dragstart', (e) => { dragId = item.id; li.classList.add('dragging'); e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; });
      li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); document.querySelectorAll('.over, .over-list').forEach((n) => n.classList.remove('over', 'over-list')); });
      li.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); li.classList.add('over'); });
      li.addEventListener('dragleave', () => li.classList.remove('over'));
      li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); moveTo(dragId || e.dataTransfer.getData('text/plain'), col, item.id); });
      ol.appendChild(li);
    });
  });
}

// Moves block `id` into `col`, before block `beforeId` (or to the end of that column).
function moveTo(id, col, beforeId) {
  const i = layout.findIndex((x) => x.id === id);
  if (i < 0 || id === beforeId) { renderLayout(); return; }
  const [x] = layout.splice(i, 1);
  x.col = col;
  let at = beforeId ? layout.findIndex((y) => y.id === beforeId) : -1;
  if (at < 0) {
    const lastInCol = layout.map((y) => y.col).lastIndexOf(col);
    at = lastInCol + 1;
  }
  layout.splice(at, 0, x);
  renderLayout();
}

function step(id, d) {
  const item = layout.find((x) => x.id === id);
  const same = layout.filter((x) => x.col === item.col);
  const k = same.indexOf(item) + d;
  if (k < 0 || k >= same.length) return;
  const other = same[k];
  const a = layout.indexOf(item);
  const b = layout.indexOf(other);
  layout[a] = other;
  layout[b] = item;
  renderLayout();
}

document.querySelectorAll('.layout').forEach((ol) => {
  ol.addEventListener('dragover', (e) => { e.preventDefault(); ol.classList.add('over-list'); });
  ol.addEventListener('dragleave', (e) => { if (!ol.contains(e.relatedTarget)) ol.classList.remove('over-list'); });
  ol.addEventListener('drop', (e) => { e.preventDefault(); ol.classList.remove('over-list'); moveTo(dragId || e.dataTransfer.getData('text/plain'), ol.dataset.col, null); });
});

// ------------------------------------------------------------------ fonts
const FONT_KEYS = [['fontKo', 'ko'], ['fontEn', 'en'], ['fontHan', 'han']];
function fontUi(s) {
  FONT_KEYS.forEach(([key, kind]) => {
    const sel = $(key + 'Sel');
    const txt = $(key);
    sel.replaceChildren(new Option('System default', ''), ...CFG.FONTS[kind].map((f) => new Option(f, f)), new Option('Other…', '__other'));
    const v = s[key] || '';
    if (!v || CFG.FONTS[kind].includes(v)) { sel.value = v; txt.value = ''; txt.hidden = true; } else { sel.value = '__other'; txt.value = v; txt.hidden = false; }
    sel.onchange = () => { txt.hidden = sel.value !== '__other'; if (!txt.hidden) txt.focus(); preview(); };
    txt.oninput = preview;
  });
  $('fontSize').oninput = preview;
}
const fontVal = (key) => ($(key + 'Sel').value === '__other' ? $(key).value.trim() : $(key + 'Sel').value);

function preview() {
  const ko = fontVal('fontKo');
  const en = fontVal('fontEn');
  const han = fontVal('fontHan');
  CFG.loadFonts(document, [ko, en, han]);
  const sys = 'system-ui, "Malgun Gothic", sans-serif';
  $('pvKo').style.fontFamily = CFG.stack(ko, sys);
  $('pvEn').style.fontFamily = CFG.stack(en, sys);
  $('pvHan').style.fontFamily = CFG.stack(han, CFG.stack(ko, 'serif'));
  $('preview').style.fontSize = (parseInt($('fontSize').value, 10) || 15) + 3 + 'px';
}

// ------------------------------------------------------------------ load / save
function fill(s) {
  layout = s.layout.map((x) => ({ ...x }));
  renderLayout();
  $('initialPages').value = s.initialPages;
  $('tatoebaLimit').value = s.tatoebaLimit;
  $('krdictKey').value = s.krdictKey;
  $('fontSize').value = s.fontSize;
  fontUi(s);
  preview();
}

CFG.load(fill);

$('save').onclick = () => {
  chrome.storage.sync.set({
    layout,
    initialPages: Math.min(20, Math.max(1, parseInt($('initialPages').value, 10) || 2)),
    tatoebaLimit: Math.min(500, Math.max(0, parseInt($('tatoebaLimit').value, 10) || 0)),
    krdictKey: $('krdictKey').value.trim(),
    fontKo: fontVal('fontKo'),
    fontEn: fontVal('fontEn'),
    fontHan: fontVal('fontHan'),
    fontSize: Math.min(22, Math.max(12, parseInt($('fontSize').value, 10) || 15)),
  }, () => msg(chrome.runtime.lastError ? 'Error: ' + chrome.runtime.lastError.message : 'Saved.'));
};
$('reset').onclick = () => { layout = CFG.DEFAULTS.layout.map((x) => ({ ...x })); renderLayout(); msg('Layout reset — Save to apply.'); };
$('clear').onclick = () => chrome.runtime.sendMessage({ type: 'clearCache' }, () => msg('Cache cleared.'));
