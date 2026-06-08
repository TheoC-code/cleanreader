# ◐ Reader

A Firefox extension that strips any web article down to just the words — no ads, no banners, no popups, no clutter — and keeps a private, local library of everything you've read.

Everything lives on your device. Your library, highlights, notes, and settings are stored in the browser's local extension storage and are **never sent to any server**.

---

## Features

- **Clean reading view** — pulls the article out of the page and presents it as plain, readable text with a short auto-generated synopsis, reading time, and word count.
- **Local library** — every article you read is saved in the sidebar. Search it, filter by read/unread, pin favourites, tag articles, or bulk-select to mark, export, or delete several at once (click anywhere on an item to select it).
- **Resume where you left off** — reopening an article (or just opening a fresh tab) drops you back at your last scroll position.
- **Import files** — read local **PDF** and **EPUB** files as clean articles. EPUBs get a floating chapter menu.
- **Highlights & notes** — select text to highlight in one of four colours, attach notes, label what each colour means, and review everything from the **✎** button.
- **Focus mode** — dims everything except a configurable window of lines around what you're reading.
- **Read aloud** — text-to-speech that starts from wherever you are; click any paragraph while it plays to jump there.
- **Themes & typography** — five themes (Charcoal, Midnight, Nord, Sepia, Light) and adjustable font, size, line height, letter spacing, and column width, with a choice of animated theme-change transitions. The popup matches your chosen theme.
- **Flexible sidebar** — pinned, hover, reveal-on-edge, or hidden. The **◐ READER** brand and a back-to-top button sit at the top of the sidebar.
- **Reading stats** — a daily streak and a count of finished articles.
- **Keyboard-first** — press <kbd>?</kbd> for the full shortcut list.
- **Markdown export** — download any article (with its highlights and notes) as a `.md` file.
- **First-run walkthrough** — a short guided tour on install that explains how to access the extension and ends by letting you customise your settings. Replay it any time from the **?** help panel.

---

## Install

### From a packaged build (`reader.xpi`)

1. Open `about:addons` in Firefox.
2. Click the gear icon → **Install Add-on From File…**
3. Choose `reader.xpi`.

> Permanently installing an unsigned add-on requires Firefox Developer Edition, Nightly, or ESR (with `xpinstall.signatures.required` set to `false`). On regular Firefox, use the temporary method below.

### Temporary install (for development)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**
3. Select the `manifest.json` in this folder. (Temporary add-ons are removed when Firefox closes.)

### Accessing the extension

After installing, the **◐ Reader** icon appears in the toolbar. If you don't see it, click the **puzzle-piece (Extensions)** button and **pin** Reader so it's always one click away. On any article, click the icon and press **Read this page**.

---

## How to use

| Action | How |
| --- | --- |
| Read the current page | Click the toolbar icon → **Read this page** |
| Open a saved article | Click it in the sidebar |
| Search / filter | Search box and the **▾** filter button at the top of the sidebar |
| Select several articles | **Select**, then click anywhere on each item |
| Highlight | Select text, pick a colour |
| Add a note | Choose **Note** while highlighting, or click an existing highlight |
| Focus mode | **⚙ → Reading aids**, or press <kbd>f</kbd> |
| Read aloud | **⚙ → Read article aloud**, or press <kbd>r</kbd> |
| Import a PDF/EPUB | **Import file** in the sidebar |
| Download as Markdown | The **⬇** button (bottom-right) |
| Settings | The **⚙** button (bottom-right) |
| All shortcuts | Press <kbd>?</kbd> |

---

## Privacy

Reader is built to be completely local:

- **No analytics, no telemetry, no third-party requests.** There are no tracking SDKs and no background "phone-home".
- **Your data stays on your device** in `browser.storage.local`.
- **One network request, on your command:** when you press *Read this page*, Reader fetches the URL of the tab you're already on so it can extract the article text. That request goes from your machine directly to that site — the same site you're already visiting — and only the article text is kept. Nothing about you or your library is included.
- Imported PDF/EPUB files are read from disk locally and never uploaded.

### Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `tabs` | Read the URL of the page you ask to save, and open the reader tab |
| `storage` | Save your library, highlights, and settings locally |
| `<all_urls>` | Fetch the article from whatever site you're reading |

---

## Project structure

| File | Role |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V2) |
| `background.js` | Opens the welcome tour on first install |
| `popup.html` / `popup.js` | Toolbar popup with the **Read this page** button |
| `extractor.js` | Fetches a page and extracts the readable article |
| `importers.js` | Parses local PDF and EPUB files into articles |
| `reader.html` / `reader.js` / `reader.css` | The reader app: library, reading view, highlights, settings, onboarding |
| `reader.preview.html` | Standalone preview harness for development (not packaged) |
| `build.ps1` | Packages the extension into `reader.xpi` |

---

## Building

From inside this folder (Windows PowerShell 5+):

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

It validates that every required file is present and produces `reader.xpi`. Bump the `"version"` field in `manifest.json` before each build.

---

## Security

- The reader page never uses `innerHTML`, `eval`, or `document.write`. All article content (titles, text, highlights, notes, tags) is inserted as plain text via `textContent`, so page content cannot inject markup or scripts.
- Imported files are parsed with `DOMParser`, which does not execute scripts; only text is extracted.
- The "open original" link only follows `http(s)` URLs; anything else is neutralised.
- Manifest V2's default content security policy applies to the extension pages — no inline scripts and no remote code.
