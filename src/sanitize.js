// Allow-list sanitizer for HTML fetched from Wiktionary before it is inserted into the page.
(function (root) {
  'use strict';
  const ALLOWED_TAGS = new Set([
    'A', 'B', 'I', 'EM', 'STRONG', 'SPAN', 'P', 'OL', 'UL', 'LI', 'DL', 'DT', 'DD', 'BR', 'SUB', 'SUP', 'SMALL',
    'SECTION', 'H2', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'CODE', 'Q', 'BLOCKQUOTE', 'DIV', 'RUBY', 'RT', 'RP', 'H3', 'H4', 'H5', 'H6', 'ABBR', 'S', 'U',
  ]);
  const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'IMG', 'SVG', 'MATH', 'NOSCRIPT', 'TEMPLATE', 'AUDIO', 'VIDEO']);
  const ALLOWED_ATTR = new Set(['href', 'lang', 'colspan', 'rowspan', 'title', 'class']);

  // linkFn(href) -> {href, data} lets the caller rewrite links.
  function sanitize(node, linkFn) {
    const doc = node.ownerDocument;
    const walk = (el) => {
      [...el.childNodes].forEach((c) => {
        if (c.nodeType === 8) { c.remove(); return; }
        if (c.nodeType !== 1) return;
        const tag = c.tagName.toUpperCase();
        if (DROP_WITH_CONTENT.has(tag)) { c.remove(); return; }
        if (!ALLOWED_TAGS.has(tag)) {
          walk(c);
          const frag = doc.createDocumentFragment();
          while (c.firstChild) frag.appendChild(c.firstChild);
          c.replaceWith(frag);
          return;
        }
        [...c.attributes].forEach((a) => {
          if (!ALLOWED_ATTR.has(a.name)) c.removeAttribute(a.name);
        });
        if (tag === 'A') {
          const h = c.getAttribute('href') || '';
          if (/^\s*javascript:/i.test(h)) c.removeAttribute('href');
          else if (linkFn) {
            const r = linkFn(h, c);
            if (r && r.href !== undefined) c.setAttribute('href', r.href);
            if (r && r.data) Object.entries(r.data).forEach(([k, v]) => c.setAttribute('data-' + k, v));
          }
          c.setAttribute('target', '_blank');
          c.setAttribute('rel', 'noopener noreferrer');
        }
        walk(c);
      });
    };
    walk(node);
    return node;
  }
  root.LxSanitize = sanitize;
})(typeof window !== 'undefined' ? window : globalThis);
