!!!!!!!!!!!!!OUTDATED README



A Firefox extension that strips any page down to its article, summarizes it, and keeps a local library of everything you've read. Highlight passages, attach notes, and track your reading progress — all stored locally, no accounts, no data collection.

## Features

- **Clean reading view** — synopsis + article text, distraction-free, with reading-time and word-count.
- **Themes & layout** — pick from five themes (Charcoal, Midnight, Nord, Sepia, Light) and adjust reading font, text size, column width, library sort, and sidebar mode from the **⚙** settings menu.
- **Theme-change animations** — choose how a theme switch reveals: **Clean** (circle from centre), **Fractals**, **Bubbles**, **Wipe**, **Diamond**, **Blinds**, **Shatter**, or **Surprise** (random each time).
- **Collapsible sidebar** — four modes: **Pinned** (always open), **Hover** (thin strip that expands), **Reveal** (hidden until you brush the left edge), and **Hidden** (a small handle brings it back). Toggle instantly with **☰** or the **‹** in the sidebar header.
- **Local library** — every page you read is saved; search it by title, synopsis, or URL, **pin** favourites to the top, and sort by recency, title, or unread.
- **Resume reading** — reopening an article returns you to where you left off.
- **Export** — save the current article with its highlights and notes as a Markdown file (**⬇**).
- **Reading status** — each library item shows a colour-coded status: **Unread** (red), **In progress** (amber) once you start scrolling, or **Read** (green) when you reach the end; a progress bar shows how far through you are.
- **Highlights & notes** — select any text to highlight it in one of four colours, then attach a note. Highlights with notes are marked with a ✎; hover one to read its note. Library rows show highlight (✎) and note (🗒) counts.
- **Help** — hover the **?** button in the bottom-right for an in-app guide.

## Requirements

- Windows with PowerShell 5+ (built in)
- Firefox

## Build

From inside this folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

This produces `reader.xpi` in the same folder. Re-run any time you change the source. Bump the `"version"` field in `manifest.json` before each build.

## Load it in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**
3. Select `manifest.json`.

## Project layout

| File | Purpose |
|------|---------|
| `manifest.json` | Extension metadata |
| `popup.html`, `popup.js` | Toolbar popup with the "Read this page" button |
| `extractor.js` | Fetches the page and pulls out title, synopsis, article blocks |
| `reader.html`, `reader.css`, `reader.js` | The reader page opened in the tab |
| `build.ps1` | Packages the source into `reader.xpi` |
