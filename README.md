# Lexicon for Naver

A Chrome extension that takes over `en.dict.naver.com` search pages and shows your own layout:

- **Left:** definitions from KRDict (한국어-영어 학습사전, English translations), Naver (ET-house Neungyule) and Wiktionary, then
  **Etymology**: KRDict word type (고유어/한자어/외래어), Wiktionary etymology, and for Sino-Korean words a
  Wiktionary-style hanja box. Each character cell shows 훈음 (Naver) and a short English gloss (Wiktionary); click a
  cell for the Naver 한자사전 entry (부수, 획수, 급수, 이체자, meanings) and the Wiktionary character page
  (Translingual, glyph origin, Chinese definitions, Korean eumhun).
- **Right:** example sentences from Naver dictionary examples, Weverse subtitles and Tatoeba, deduplicated, sorted
  shortest first (or longest / by source), filterable by source and minimum length, with "Load more" paging.

## Install

1. Get the files: **Code → Download ZIP** on GitHub and unzip somewhere permanent, or `git clone` the repository.
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → pick the folder containing `manifest.json`.
3. Open `https://en.dict.naver.com/#/search?query=휴식`.
4. Add your own KRDict API key in **Settings** (see below). Without one, everything except the KRDict
   sections still works.

## Getting a KRDict API key

The KRDict definitions come from the National Institute of Korean Language's free Open API, which needs a
personal key. The extension doesn't include one, so each user gets their own (it's free and usually issued
straight away):

1. Go to https://krdict.korean.go.kr/openApi/openApiInfo (한국어기초사전 → **오픈 API**).
2. Sign up for a free account (**회원가입**) and log in. An email address is enough.
3. Apply for a key (**인증키 신청**). Give a short description of how you'll use it, such as
   "personal Korean study browser extension".
4. Copy the 32-character key from the Open API page (**인증키 관리**) or from My Page.
5. In the extension, open **Settings**, paste it into **KRDict → API key**, and click **Save**.

The key is stored in Chrome's own synced settings, not in the extension's files, so updating or re-downloading
the extension won't erase it. Keep it to yourself and don't commit it to the repository.
If the site has moved, search for "한국어기초사전 오픈 API".


**Settings** (top bar, or the extension's options page):
- **Layout**: two lists, Left and Right. Drag ⠿ to reorder or move a block between columns (or use ↑ ↓ ⇄). Each block is
  *Show*, *Button* (hidden behind a toggle in the top bar) or *Off*; ▼ / ◀ sets whether its section starts open or closed.
  Examples and the Hanja panel are blocks too; in the same column they share tabs. Both default to *Button* (off until clicked).
- **Fonts**: Korean, English and Hanja fonts from Google Fonts (pick from the list or type any family name), plus text size.
- KRDict key, Naver example pages per search, Tatoeba limit.

Every section and every entry can be collapsed (▼ open, ◀ closed).

**English searches** show Naver's English headwords (Oxford etc.), idioms in a collapsible sub-list, Korean equivalents
(from Naver and Wiktionary's translation tables, clickable), Wiktionary's English entry, and KRDict entries whose English
translation matches (KRDict's API can't search English directly, so the extension looks up the Korean equivalents and filters).

**Hanja**: click any hanja (selector cells, KRDict/Naver hanja, Wiktionary hanja links) to open that Naver 한자사전 page
in the right column, trimmed of Naver's header/sidebar but keeping stroke order and 학습정보. **Translate** in the panel
uses Chrome's on-device Korean→English translator (the model downloads once, the first time); hover a translated line
to see the Korean.
**Naver page** shows the original Naver page; **← Lexicon** returns. Naver entry pages (`#/entry/...`) are left as Naver renders them.

## How it gets Naver data

There is no public Naver dictionary API, so the extension loads Naver's own search pages in hidden iframes
(`range=word`, `example`, `vlive`, and 한자사전 `letter`/`word`), waits for them to render, and reads the results
(`src/extract.js`). A declarativeNetRequest rule (`rules.json`) strips `X-Frame-Options`/CSP from those iframe
responses only, so 한자사전 can be framed inside the English dictionary page. A second rule removes the CSP header from
the top-level en.dict.naver.com page so Google Fonts can load there.

## When something breaks

Naver changes its markup now and then. To see what the hidden frames are doing, open DevTools on the dictionary tab
and run `localStorage.lxDebug = 1`, then reload: the frames appear in a strip at the bottom. `localStorage.removeItem('lxDebug')` turns it off.

## Files

| File | Role |
|---|---|
| `src/app.js`, `src/app.css` | The UI (shadow DOM, top frame only) |
| `src/extract.js` | Naver DOM → data (selectors live here) |
| `src/harvest.js` | Runs inside the hidden Naver frames, posts results to the UI |
| `src/sources.js` | KRDict, Wiktionary, Tatoeba fetch + parse |
| `src/background.js` | Cross-origin fetches + 7-day cache |
| `src/settings.js`, `src/options.*` | Settings defaults, layout blocks, font lists; settings page |
| `src/panel.js`, `src/panel.css` | Trims Naver 한자사전 inside the side panel; on-device translation hooks |
| `src/sanitize.js` | Allow-list sanitizer for Wiktionary HTML |
| `src/hide.css` | Hides Naver's own page before the extension draws its layout |
| `manifest.json`, `rules.json` | Extension manifest and the header-rewriting rules |

## Updating

After pulling new changes (or editing files), go to `chrome://extensions` and click the reload ↻ button on
**Lexicon for Naver**, then reload the dictionary tab.

## Data sources

- [Naver English–Korean dictionary](https://en.dict.naver.com/) and [Naver 한자사전](https://hanja.dict.naver.com/), read from their own pages
- [KRDict 한국어기초사전 / 학습사전](https://krdict.korean.go.kr/) (National Institute of Korean Language). The open API needs a free key, entered in Settings
- [Wiktionary](https://en.wiktionary.org/) (CC BY-SA)
- [Tatoeba](https://tatoeba.org/) example sentences (CC BY 2.0 FR)

This is a personal study tool and isn't affiliated with Naver or any of the sources above. It only changes how
pages you open yourself are displayed.
