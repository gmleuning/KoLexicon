# KoDex

A Chrome extension that replaces the layout of Naver's English–Korean dictionary search page. Definitions and
etymology go on the left, example sentences go on the right, and you choose what goes where.

- **Left: definitions and etymology.** Definitions come from KRDict (한국어기초사전 learner's dictionary, with English
  translations), Naver (ET-house Neungyule) and Wiktionary. The etymology section shows the KRDict word type
  (고유어 / 한자어 / 외래어), the Wiktionary etymology, and, for Sino-Korean words, a Wiktionary-style hanja box.
- **Right: examples.** Sentences from Naver's dictionary examples, Weverse subtitles and Tatoeba, deduplicated and
  sorted shortest first (or longest, or by source). Filter by source and minimum length, and page through with "Load more".
- **Hanja.** Each character cell shows its 훈음 (from Naver) and a short English gloss (from Wiktionary). Click a cell
  to open the Naver 한자사전 entry in the side panel, trimmed to stroke order and 학습정보.

## Install

1. Get the files: on GitHub, **Code → Download ZIP** and unzip to a permanent folder, or `git clone` the repository.
2. Open `chrome://extensions` in Chrome, turn on **Developer mode**, click **Load unpacked**, and select the folder
   that contains `manifest.json`.
3. Open a search page, for example `https://en.dict.naver.com/#/search?query=휴식`.
4. Add your KRDict API key in **Settings** (see below). Without one, everything works except the KRDict sections.

## KRDict API key

KRDict definitions come from the National Institute of Korean Language's free Open API, which requires a personal
key. KoDex doesn't ship with one, so each user gets their own. It's free and usually issued immediately.

1. Go to https://krdict.korean.go.kr/openApi/openApiInfo (한국어기초사전 → **오픈 API**).
2. Sign up (**회원가입**) and log in. An email address is enough.
3. Apply for a key (**인증키 신청**). Describe the use briefly, for example "personal Korean study browser extension".
4. Copy the 32-character key from **인증키 관리** on the Open API page or from My Page.
5. In KoDex, open **Settings**, paste the key into **KRDict → API key**, and click **Save**.

The key is stored in Chrome's synced extension settings, not in the extension's files, so updating or reloading
KoDex doesn't erase it. Keep it private and never commit it to the repository. If the page has moved, search for
"한국어기초사전 오픈 API".

## Settings

Open Settings from the top bar, or from the extension's options page.

- **Layout.** Two lists, Left and Right. Drag ⠿ to reorder a block or move it between columns, or use ↑ ↓ ⇄. Each block
  is set to *Show*, *Button* (hidden behind a toggle in the top bar) or *Off*. ▼ / ◀ sets whether the section starts
  open or closed. Examples and the Hanja panel are blocks too. Blocks in the same column share tabs. Both default to
  *Button*, so they stay off until you click them.
- **Fonts.** Korean, English and Hanja fonts from Google Fonts. Pick from the list or type any family name. Text size is also set here.
- **Data.** KRDict API key, how many Naver example pages to load per search, and the Tatoeba limit.

Every section and every entry can be collapsed (▼ open, ◀ closed).

## Searching

**Korean searches** show KRDict definitions, Naver definitions, Wiktionary etymology and hanja, and example sentences.

**English searches** show:
- Naver's English headwords (Oxford and others), with idioms in a collapsible sub-list.
- Korean equivalents from Naver's and Wiktionary's translation tables. Each one is clickable.
- Wiktionary's English entry.
- KRDict entries whose English translation matches your query. KRDict's API can't search English directly, so KoDex
  looks up the Korean equivalents and filters the results.

**Hanja.** Click any hanja (selector cells, KRDict or Naver hanja, Wiktionary hanja links) to open its Naver 한자사전
page in the side panel. The page keeps stroke order and 학습정보 and drops Naver's header and sidebar.
**Translate** in the panel uses Chrome's on-device Korean → English translator. The model downloads the first time
you use it. Hover a translated line to see the original Korean.

**Naver page** shows the unmodified Naver page. **← KoDex** returns to the layout. Naver entry pages (`#/entry/...`)
are shown as Naver renders them.

## How it gets Naver data

Naver has no public dictionary API, so KoDex loads Naver's own search pages in hidden iframes (`range=word`,
`example`, `vlive`, and the 한자사전 `letter` and `word` pages). It waits for them to render and reads the results
(`src/extract.js`).

Two declarativeNetRequest rules in `rules.json` make this work:
- One strips `X-Frame-Options` and CSP headers from the iframe responses only, so the 한자사전 pages can be framed
  inside the English dictionary page.
- One removes the CSP header from the top-level en.dict.naver.com page so Google Fonts can load there.

## Troubleshooting

Naver changes its markup from time to time. If results go missing, the selectors in `src/extract.js` are the first
thing to check.

To see what the hidden frames are doing, open DevTools on the dictionary tab and run:

```js
localStorage.kdDebug = 1
```

Reload the tab. The frames appear in a strip at the bottom. To turn this off, run `localStorage.removeItem('kdDebug')`.
(Earlier builds, under the name *Lexicon for Naver*, used `lxDebug` instead.)

## Project layout

| File | Role |
|---|---|
| `src/app.js`, `src/app.css` | The UI (shadow DOM, top frame only) |
| `src/extract.js` | Naver DOM → data. The selectors live here. |
| `src/harvest.js` | Runs inside the hidden Naver frames and posts results to the UI |
| `src/sources.js` | Fetches and parses KRDict, Wiktionary and Tatoeba |
| `src/background.js` | Cross-origin fetches and a 7-day cache |
| `src/settings.js`, `src/options.*` | Settings defaults, layout blocks, font lists, and the settings page |
| `src/panel.js`, `src/panel.css` | Trims Naver 한자사전 inside the side panel and hooks up on-device translation |
| `src/sanitize.js` | Allow-list sanitizer for Wiktionary HTML |
| `src/hide.css` | Hides Naver's own page before KoDex draws its layout |
| `manifest.json`, `rules.json` | Extension manifest and header-rewriting rules |

## Updating

After pulling changes or editing files, go to `chrome://extensions`, click the reload ↻ button on **KoDex**, and
then reload the dictionary tab.

## Data sources

- [Naver English–Korean dictionary](https://en.dict.naver.com/) and [Naver 한자사전](https://hanja.dict.naver.com/), read from their own pages
- [KRDict 한국어기초사전 / 학습사전](https://krdict.korean.go.kr/) from the National Institute of Korean Language. The Open API needs a free key, entered in Settings.
- [Wiktionary](https://en.wiktionary.org/) (CC BY-SA)
- [Tatoeba](https://tatoeba.org/) example sentences (CC BY 2.0 FR)

KoDex is a personal study tool. It isn't affiliated with Naver, the National Institute of Korean Language, Wiktionary or Tatoeba.
It only changes how pages you open yourself are displayed.
