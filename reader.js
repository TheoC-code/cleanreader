const libraryEl = document.getElementById("library");
const articleEl = document.getElementById("article");
const sourceEl = document.getElementById("source");
const sourceWrap = document.getElementById("source-wrap");
const sourcePopup = document.getElementById("source-popup");
sourceEl.addEventListener("click", (e) => { if (sourceEl.classList.contains("no-link")) e.preventDefault(); });
// The source link is an icon-only circular button (bottom-left of the reader);
// hovering it pops a styled tooltip with the full URL / import name (same
// affordance as the help menu) rather than relying on the native title attr.
// Only ever allow real web links through to the href — anything that isn't
// http(s) (e.g. a tampered javascript:/data: URL in stored history) is
// neutralised to "#" so clicking it can never execute code.
function safeHref(href) {
  return (typeof href === "string" && /^https?:\/\//i.test(href)) ? href : "#";
}

function setSource(label, href, noLink) {
  if (label) {
    sourceWrap.hidden = false;
    sourceEl.setAttribute("aria-label", label);
    sourceEl.href = safeHref(href);
    sourceEl.classList.toggle("no-link", !!noLink);
    sourcePopup.textContent = label;
  } else {
    sourceWrap.hidden = true;
    sourceEl.setAttribute("aria-label", "Open original");
    sourceEl.href = "#";
    sourceEl.classList.remove("no-link");
    sourcePopup.textContent = "";
  }
}
const searchEl = document.getElementById("search");
const progressEl = document.getElementById("progress");
const toTopBtn = document.getElementById("to-top");

let history = [];
let activeUrl = null;
let query = "";
let tagFilter = null;
// Status filter applied to the library list — a Set of articleStatus() keys
// ("unread" | "read"), or null/empty for "show everything". Adjusted via the
// filter dropdown's checkboxes, only takes effect on Save.
let statusFilter = null;
let selectMode = false;
let selected = new Set();
let highlightsViewActive = false;
let hlQuery = "";

const THEMES = [
  { id: "charcoal", name: "Charcoal", bg: "#2a2d33", accent: "#ffffff" },
  { id: "midnight", name: "Midnight", bg: "#0f1419", accent: "#4493f8" },
  { id: "nord", name: "Nord", bg: "#2e3440", accent: "#88c0d0" },
  { id: "sepia", name: "Sepia", bg: "#f4ecd8", accent: "#9a6a3a" },
  { id: "light", name: "Light", bg: "#ffffff", accent: "#2563eb" },
];
const WIDTHS = [
  { name: "Narrow", value: 640 },
  { name: "Medium", value: 760 },
  { name: "Wide", value: 900 },
];
const FONTS = [
  { id: "serif", name: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { id: "sans", name: "Sans", stack: '"Segoe UI", system-ui, sans-serif' },
];
const SIDEBAR_MODES = [
  { id: "pinned", name: "Pinned" },
  { id: "hover", name: "Hover" },
  { id: "reveal", name: "Reveal" },
  { id: "hidden", name: "Hidden" },
];
const SORTS = [
  { id: "recent", name: "Recent" },
  { id: "title", name: "Title" },
  { id: "unread", name: "Unread" },
];
const TRANSITIONS = [
  { id: "clean", name: "Clean" },
  { id: "fractals", name: "Fractals" },
  { id: "bubbles", name: "Bubbles" },
  { id: "wipe", name: "Wipe" },
  { id: "diamond", name: "Diamond" },
  { id: "blinds", name: "Blinds" },
  { id: "shatter", name: "Shatter" },
  { id: "random", name: "Surprise" },
];
const FONT_MIN = 14;
const FONT_MAX = 24;
const LINE_HEIGHT_MIN = 1.3;
const LINE_HEIGHT_MAX = 2.1;
const LINE_HEIGHT_STEP = 0.1;
const LETTER_SPACING_MIN = 0;
const LETTER_SPACING_MAX = 1.5;
const LETTER_SPACING_STEP = 0.25;
const FOCUS_LINES_MIN = 1;
const FOCUS_LINES_MAX = 9;
const DEFAULT_SETTINGS = {
  theme: "charcoal",
  fontSize: 17,
  lineHeight: 1.65,
  letterSpacing: 0,
  width: 760,
  font: "serif",
  sidebar: "pinned",
  sort: "recent",
  transition: "clean",
  focusMode: false,
  focusLines: 3,
  hlLabels: {},
};
let settings = { ...DEFAULT_SETTINGS };

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty("--article-font", settings.fontSize + "px");
  root.style.setProperty("--article-line-height", settings.lineHeight ?? DEFAULT_SETTINGS.lineHeight);
  root.style.setProperty("--article-letter-spacing", (settings.letterSpacing ?? 0) + "px");
  root.style.setProperty("--article-width", settings.width + "px");
  const font = FONTS.find((f) => f.id === settings.font) || FONTS[0];
  root.style.setProperty("--reader-family", font.stack);
  document.body.dataset.sidebar = settings.sidebar;
  const collapseToggle = document.getElementById("collapse-sidebar");
  if (collapseToggle) {
    const label = (settings.sidebar === "hidden") ? "Show library" : "Hide library";
    collapseToggle.title = label;
    collapseToggle.setAttribute("aria-label", label);
  }
  if (settings.sidebar !== "reveal" && settings.sidebar !== "hover") document.body.classList.remove("reveal-open");
  document.body.classList.toggle("focus-mode", !!settings.focusMode);
  if (settings.focusMode) updateFocusHighlight();
  else clearFocusHighlight();
}

/* ---------- Focus mode (context window) ---------- */
// Keeps a small window of consecutive blocks bright (centred on whatever is
// nearest the viewport's vertical centre) and dims the rest. A window rather
// than a single block so short, separate dialogue lines aren't skipped over.

// Index (in document order) of the [data-block] nearest the viewport centre.
function centreBlockIndex(blocks) {
  const centre = window.innerHeight / 2;
  let bestIdx = 0, bestDist = Infinity;
  blocks.forEach((b, idx) => {
    const r = b.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    const d = Math.abs(mid - centre);
    if (d < bestDist) { bestDist = d; bestIdx = idx; }
  });
  return bestIdx;
}

let focusRaf = null;
function updateFocusHighlight() {
  if (!settings.focusMode) return;
  if (focusRaf) return;
  focusRaf = requestAnimationFrame(() => {
    focusRaf = null;
    const blocks = articleEl.querySelectorAll("[data-block]");
    if (!blocks.length) return;
    const centreIdx = centreBlockIndex(blocks);
    const span = Math.max(1, settings.focusLines ?? DEFAULT_SETTINGS.focusLines);
    const half = Math.floor((span - 1) / 2);
    const lo = centreIdx - half;
    const hi = lo + span - 1;
    blocks.forEach((b, idx) => b.classList.toggle("in-focus", idx >= lo && idx <= hi));
  });
}

function clearFocusHighlight() {
  for (const b of articleEl.querySelectorAll(".in-focus")) b.classList.remove("in-focus");
}

function toggleFocusMode() {
  settings.focusMode = !settings.focusMode;
  saveSettings();
  renderAppearancePanel();
}

async function saveSettings() {
  await browser.storage.local.set({ settings });
  applySettings();
}

const HL_COLORS = [
  { name: "Yellow", value: "#ffe066" },
  { name: "Green", value: "#8ce99a" },
  { name: "Pink", value: "#ffa8c5" },
  { name: "Blue", value: "#8ec5ff" },
];

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmtDate(ts) {
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(opts)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "onclick") node.addEventListener("click", v);
    else if (k === "style") node.style.cssText = v;
    // Everything else (title, type, role, aria-*, data-*, …) is a real attribute.
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

function liveEntry() {
  return history.find((e) => e.url === activeUrl) || null;
}

function articleStatus(entry) {
  if (entry.read) return { key: "read", label: "Read" };
  return { key: "unread", label: "Unread" };
}

// Shared search/tag predicate so the rendered list and n/p navigation agree.
function matchesFilters(e) {
  const q = query.trim().toLowerCase();
  if (q && !`${e.title || ""} ${e.synopsis || ""} ${e.url || ""}`.toLowerCase().includes(q)) return false;
  if (tagFilter && !(e.tags || []).includes(tagFilter)) return false;
  if (statusFilter && statusFilter.size && !statusFilter.has(articleStatus(e).key)) return false;
  return true;
}

function renderLibrary() {
  clear(libraryEl);
  renderTagBar();
  renderBulkBar();
  if (!history.length) {
    libraryEl.appendChild(el("p", { class: "empty", text: "No saved articles yet." }));
    return;
  }

  const entries = history.filter(matchesFilters);

  // The article currently open should never drop out of the sidebar.
  if (activeUrl && !entries.some((e) => e.url === activeUrl)) {
    const act = history.find((e) => e.url === activeUrl);
    if (act) entries.unshift(act);
  }

  if (!entries.length) {
    libraryEl.appendChild(el("p", { class: "lib-empty", text: "No matches." }));
    return;
  }

  const sorted = [...entries];
  if (settings.sort === "title") {
    sorted.sort((a, b) => (a.title || a.url || "").localeCompare(b.title || b.url || ""));
  } else if (settings.sort === "unread") {
    const rank = (e) => ({ unread: 0, read: 1 }[articleStatus(e).key]);
    sorted.sort((a, b) => rank(a) - rank(b));
  }
  // pinned always first (stable over the chosen sort)
  sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  for (const entry of sorted) {
    const status = articleStatus(entry);
    const statusEl = el("span", { class: "lib-status " + status.key, text: status.label });
    const rm = readingMeta(entry);
    const timeSpan = rm.words ? el("span", { class: "read-time", text: `${rm.mins} min` }) : null;
    const dateSpan = el("span", { class: "date", text: fmtDate(entry.timestamp) });
    const topRow = el("div", { class: "lib-top" }, [statusEl, timeSpan, dateSpan]);
    const titleSpan = el("span", { class: "title-line", text: entry.title || entry.url });

    const hls = entry.highlights || [];
    const noteCount = hls.filter((h) => h.note).length;
    const parts = [];
    if (hls.length) parts.push(`${hls.length} ✎`);
    if (noteCount) parts.push(`${noteCount} 🗒`);
    const meta = parts.length
      ? el("span", {
          class: "lib-count",
          text: parts.join("  "),
          title: `${hls.length} highlight${hls.length === 1 ? "" : "s"}, ${noteCount} note${noteCount === 1 ? "" : "s"}`,
        })
      : null;

    const tags = entry.tags || [];
    const tagRow = tags.length
      ? el("div", { class: "lib-tags" }, tags.map((t) =>
          el("span", { class: "lib-tag" + (t === tagFilter ? " on" : ""), text: t })))
      : null;

    // In select mode the whole row toggles selection; otherwise it opens the
    // article. Either way the entire item (not just a checkbox) is the target.
    const body = el("button", {
      class: "body",
      style: "background:transparent;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0;width:100%;min-width:0;",
      onclick: () => {
        if (selectMode) toggleSelected(entry.url);
        else renderArticle(entry);
      },
    }, [topRow, titleSpan, tagRow, meta]);

    const pin = el("button", {
      class: "lib-pin" + (entry.pinned ? " on" : ""),
      title: entry.pinned ? "Unpin" : "Pin to top",
      text: "📌",
      onclick: (e) => { e.stopPropagation(); togglePin(entry.url); },
    });

    const del = el("button", {
      class: "lib-del",
      title: "Delete",
      text: "✕",
      onclick: (e) => { e.stopPropagation(); deleteEntry(entry.url); },
    });

    let checkbox = null;
    if (selectMode) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "lib-select-box";
      checkbox.checked = selected.has(entry.url);
      checkbox.title = "Select for bulk actions";
      // The checkbox is just a visual handle now — clicking anywhere on the row
      // toggles selection (handled on the body button), so keep them in sync
      // and stop the click from double-firing the row handler.
      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSelected(entry.url);
      });
    }

    const row = el("div", {
      class: "lib-item " + status.key
        + (entry.url === activeUrl ? " active" : "")
        + (entry.pinned ? " pinned" : "")
        + (selectMode && selected.has(entry.url) ? " selected" : "")
        + (selectMode ? " selecting" : ""),
      "data-url": entry.url,
    }, [checkbox, body, pin, del]);

    libraryEl.appendChild(row);
  }
}

// Toggle whether an article is in the bulk-action selection. Updates ONLY the
// affected row in place (no full re-render) so the other rows don't replay
// their entrance animations.
function toggleSelected(url) {
  const nowSelected = !selected.has(url);
  if (nowSelected) selected.add(url);
  else selected.delete(url);
  const row = libraryEl.querySelector(`.lib-item[data-url="${CSS.escape(url)}"]`);
  if (row) {
    row.classList.toggle("selected", nowSelected);
    const cb = row.querySelector(".lib-select-box");
    if (cb) cb.checked = nowSelected;
  }
  renderBulkBar();
}

/* ---------- Reading stats / streaks ---------- */

let stats = { days: [], total: 0 };
const streakEl = el("div", { class: "streak", title: "Your reading activity" });
streakEl.hidden = true;

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computeStreak() {
  if (!stats.days.length) return 0;
  const set = new Set(stats.days);
  let streak = 0;
  let cursor = Date.now();
  // Today doesn't have to be read yet for the streak to still be "alive".
  if (!set.has(dayKey(cursor))) cursor -= 86_400_000;
  while (set.has(dayKey(cursor))) {
    streak++;
    cursor -= 86_400_000;
  }
  return streak;
}

function renderStreak() {
  const streak = computeStreak();
  if (!stats.total) { streakEl.hidden = true; return; }
  streakEl.hidden = false;
  clear(streakEl);
  const bits = [];
  if (streak > 0) bits.push(`🔥 ${streak} day streak`);
  bits.push(`${stats.total} article${stats.total === 1 ? "" : "s"} finished`);
  streakEl.appendChild(el("span", { text: bits.join(" · ") }));
}

async function recordReadCompletion(url) {
  const key = dayKey();
  if (!stats.days.includes(key)) stats.days.push(key);
  stats.total = (stats.total || 0) + 1;
  await browser.storage.local.set({ stats });
  renderStreak();
}

// The search box now lives in a row alongside the status-filter button —
// anchor insertions to that row rather than the input itself.
const searchRow = searchEl.closest(".lib-search-row") || searchEl.parentNode;

/* ---------- Status filter dropdown ---------- */
// Opens beneath the search row (pushing the list down, not overlaying it).
// Edits are draft-only until "Save" commits them to `statusFilter`; "Cancel"
// (or re-clicking the toggle button) discards any unsaved changes.
const filterBtn = document.getElementById("lib-filter-btn");
const FILTER_OPTIONS = [
  { key: "read", label: "Completed" },
  { key: "unread", label: "Unread" },
];
let filterDraft = new Set();

const filterPanel = el("div", { class: "lib-filter-panel" });
const filterOptionsWrap = el("div", { class: "lib-filter-options" });
const filterChecks = {};
for (const opt of FILTER_OPTIONS) {
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.addEventListener("change", () => {
    if (cb.checked) filterDraft.add(opt.key);
    else filterDraft.delete(opt.key);
  });
  filterChecks[opt.key] = cb;
  filterOptionsWrap.appendChild(el("label", { class: "lib-filter-opt" }, [cb, el("span", { text: opt.label })]));
}
const filterCancelBtn = el("button", { class: "lib-filter-cancel", text: "Cancel", type: "button" });
const filterSaveBtn = el("button", { class: "lib-filter-save", text: "Save", type: "button" });
filterCancelBtn.type = "button";
filterSaveBtn.type = "button";
const filterActions = el("div", { class: "lib-filter-actions" }, [filterCancelBtn, filterSaveBtn]);
filterPanel.appendChild(filterOptionsWrap);
filterPanel.appendChild(filterActions);
searchRow.parentNode.insertBefore(filterPanel, searchRow.nextSibling);

function syncFilterCheckboxes() {
  for (const opt of FILTER_OPTIONS) filterChecks[opt.key].checked = filterDraft.has(opt.key);
}

function openFilterPanel() {
  filterDraft = new Set(statusFilter || []);
  syncFilterCheckboxes();
  filterPanel.classList.add("open");
  filterBtn.classList.add("on");
  filterBtn.setAttribute("aria-expanded", "true");
}

function closeFilterPanel() {
  filterPanel.classList.remove("open");
  filterBtn.classList.remove("on");
  filterBtn.setAttribute("aria-expanded", "false");
}

filterBtn.addEventListener("click", () => {
  if (filterPanel.classList.contains("open")) closeFilterPanel();
  else openFilterPanel();
});
filterCancelBtn.addEventListener("click", () => closeFilterPanel());
filterSaveBtn.addEventListener("click", () => {
  statusFilter = filterDraft.size ? new Set(filterDraft) : null;
  closeFilterPanel();
  renderLibrary();
});
document.addEventListener("click", (e) => {
  if (!filterPanel.classList.contains("open")) return;
  if (filterPanel.contains(e.target) || filterBtn.contains(e.target)) return;
  closeFilterPanel();
});

/* ---------- Tag filter bar ---------- */

const tagBar = el("div", { class: "tag-bar" });
tagBar.hidden = true;
// Keep the filter dropdown directly beneath the search row — slot the tag
// bar in after it (it's the next thing inserted in DOM order).
searchRow.parentNode.insertBefore(tagBar, filterPanel.nextSibling);

function renderTagBar() {
  clear(tagBar);
  const all = new Set();
  for (const e of history) for (const t of (e.tags || [])) all.add(t);
  if (tagFilter && !all.has(tagFilter)) tagFilter = null;
  if (!all.size) { tagBar.hidden = true; return; }
  tagBar.hidden = false;
  const names = [...all].sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    tagBar.appendChild(el("button", {
      class: "tag-chip-filter" + (tagFilter === name ? " on" : ""),
      text: name,
      onclick: () => {
        tagFilter = tagFilter === name ? null : name;
        renderLibrary();
      },
    }));
  }
}

// Streak indicator sits just under the library header.
{
  const libHead = document.querySelector(".lib-head");
  if (libHead && libHead.nextSibling) libHead.parentNode.insertBefore(streakEl, libHead.nextSibling);
  else if (libHead) libHead.parentNode.appendChild(streakEl);
}

// Keep the active row visible within the sidebar's own scroll area (never the window).
function scrollActiveSidebarIntoView() {
  const inner = document.querySelector(".library-inner");
  const row = libraryEl.querySelector(".lib-item.active");
  if (!inner || !row) return;
  const ir = inner.getBoundingClientRect();
  const ar = row.getBoundingClientRect();
  if (ar.top < ir.top) inner.scrollTop -= (ir.top - ar.top) + 8;
  else if (ar.bottom > ir.bottom) inner.scrollTop += (ar.bottom - ir.bottom) + 8;
}

async function togglePin(url) {
  const entry = history.find((e) => e.url === url);
  if (!entry) return;
  entry.pinned = !entry.pinned;
  await browser.storage.local.set({ history });
  renderLibrary();
}

// Splice highlight <span>s into a block's plain text. Offsets index the
// original text, so we always rebuild from `text` (never from current DOM).
function fillBlock(node, text, blockIndex, highlights) {
  node.dataset.block = blockIndex;
  const hs = highlights
    .filter((h) => h.block === blockIndex && h.start < h.end && h.start >= 0 && h.end <= text.length)
    .sort((a, b) => a.start - b.start);

  if (!hs.length) {
    node.textContent = text;
    return;
  }

  let cursor = 0;
  for (const h of hs) {
    if (h.start < cursor) continue; // overlapping highlight — skip
    if (h.start > cursor) node.appendChild(document.createTextNode(text.slice(cursor, h.start)));
    const span = document.createElement("span");
    span.className = "hl" + (h.note ? " has-note" : "");
    span.dataset.id = h.id;
    span.style.background = h.color;
    span.textContent = text.slice(h.start, h.end);
    node.appendChild(span);
    cursor = h.end;
  }
  if (cursor < text.length) node.appendChild(document.createTextNode(text.slice(cursor)));
}

// Re-render a single block in place — cheap, keeps scroll, no full rebuild.
function refreshBlock(blockIndex) {
  const entry = liveEntry();
  if (!entry) return;
  const node = articleEl.querySelector(`[data-block="${blockIndex}"]`);
  if (!node) return;
  const block = (entry.blocks || [])[blockIndex];
  if (!block) return;
  clear(node);
  fillBlock(node, block[1] || "", blockIndex, entry.highlights || []);
  applyHlTitles();
}

// Tooltip text for a highlight span: "<colour meaning> — <note>" (either may be absent).
function applyHlTitles() {
  const entry = liveEntry();
  if (!entry) return;
  const labels = settings.hlLabels || {};
  for (const span of articleEl.querySelectorAll(".hl")) {
    const h = (entry.highlights || []).find((x) => x.id === span.dataset.id);
    if (!h) continue;
    const label = labels[h.color];
    const parts = [];
    if (label) parts.push(label);
    if (h.note) parts.push(h.note);
    if (parts.length) span.title = parts.join(" — ");
    else span.removeAttribute("title");
  }
}

// Build the editable colour-meaning legend for the appearance panel
// (e.g. "Yellow = key idea"). Saved into settings.hlLabels by hex value.
function buildHlLegend() {
  const wrap = el("div", { class: "hl-legend" });
  for (const c of HL_COLORS) {
    const swatch = el("span", { class: "hl-legend-swatch", style: `background:${c.value}` });
    const input = document.createElement("input");
    input.type = "text";
    input.className = "hl-legend-input";
    input.placeholder = `${c.name} means…`;
    input.value = (settings.hlLabels && settings.hlLabels[c.value]) || "";
    input.addEventListener("change", async () => {
      settings.hlLabels = settings.hlLabels || {};
      const v = input.value.trim();
      if (v) settings.hlLabels[c.value] = v;
      else delete settings.hlLabels[c.value];
      await browser.storage.local.set({ settings });
      applyHlTitles();
    });
    wrap.appendChild(el("div", { class: "hl-legend-row" }, [swatch, input]));
  }
  return wrap;
}

function readingMeta(entry) {
  const words = (entry.blocks || []).reduce((n, [, t]) => {
    const s = (t || "").trim();
    return n + (s ? s.split(/\s+/).length : 0);
  }, 0);
  return { words, mins: Math.max(1, Math.round(words / 200)) };
}

// Build a collapsible "Contents" outline from the article's heading blocks.
// Clicking an entry smooth-scrolls to that heading.
function buildToc(headings) {
  const list = el("ul", { class: "toc-list" });
  for (const h of headings) {
    list.appendChild(el("li", {}, [
      el("button", {
        class: "toc-link",
        text: h.text,
        onclick: () => {
          const node = articleEl.querySelector(`[data-block="${h.i}"]`);
          if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      }),
    ]));
  }
  const toggle = el("button", { class: "toc-toggle", text: `Contents (${headings.length})` });
  const nav = el("nav", { class: "toc" }, [toggle, list]);
  toggle.addEventListener("click", () => nav.classList.toggle("open"));
  return nav;
}

// Floating "Chapters" menu — appears in the top-left of the reader for
// imported EPUB articles, listing the chapters/headings found in the book so
// you can jump straight to one. Built once and reused across renders.
const epubChaptersEl = (() => {
  const list = el("ul", { class: "epub-ch-list" });
  const label = el("span", { class: "epub-ch-label", text: "Chapters" });
  const toggle = el("button", { class: "epub-ch-toggle" }, [label]);
  toggle.type = "button";
  toggle.title = "Chapters";
  toggle.setAttribute("aria-label", "Chapters");
  const panel = el("div", { class: "epub-chapters" }, [toggle, list]);
  panel.hidden = true;
  toggle.addEventListener("click", () => panel.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("open")) return;
    if (!panel.contains(e.target)) panel.classList.remove("open");
  });
  document.body.appendChild(panel);
  return { panel, list, toggle };
})();

// Show/refresh the floating chapter menu for the given entry. Only imported
// EPUB files (recognised by their .epub source filename) with more than one
// heading get the menu — everything else keeps it hidden.
function updateEpubChapterMenu(entry, headings) {
  const isEpub = !!(entry && entry.imported && /\.epub$/i.test(entry.sourceName || ""));
  if (!isEpub || headings.length < 2) {
    epubChaptersEl.panel.hidden = true;
    epubChaptersEl.panel.classList.remove("open");
    return;
  }
  clear(epubChaptersEl.list);
  for (const h of headings) {
    epubChaptersEl.list.appendChild(el("li", {}, [
      el("button", {
        class: "epub-ch-link",
        text: h.text,
        onclick: () => {
          const node = articleEl.querySelector(`[data-block="${h.i}"]`);
          if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
          epubChaptersEl.panel.classList.remove("open");
        },
      }),
    ]));
  }
  epubChaptersEl.panel.hidden = false;
}

// Editable tag-chip row shown under the article title — add with Enter, remove with ×.
function buildTagEditor(entry) {
  const wrap = el("div", { class: "tag-editor" });
  const redraw = () => {
    clear(wrap);
    for (const tag of (entry.tags || [])) {
      wrap.appendChild(el("span", { class: "tag-chip" }, [
        el("span", { text: tag }),
        el("button", {
          class: "tag-remove",
          text: "×",
          title: `Remove tag "${tag}"`,
          onclick: async () => {
            entry.tags = (entry.tags || []).filter((t) => t !== tag);
            await browser.storage.local.set({ history });
            redraw();
            renderLibrary();
          },
        }),
      ]));
    }
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tag-input";
    input.placeholder = (entry.tags || []).length ? "+ tag" : "+ Add tag…";
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      entry.tags = entry.tags || [];
      if (!entry.tags.includes(v)) entry.tags.push(v);
      await browser.storage.local.set({ history });
      input.value = "";
      redraw();
      renderLibrary();
    });
    wrap.appendChild(input);
  };
  redraw();
  return wrap;
}

function renderArticle(entry, keepScroll = false) {
  const scrollY = window.scrollY;
  if (ttsUrl && ttsUrl !== entry.url) stopSpeech(false);
  highlightsViewActive = false;
  activeUrl = entry.url;
  const live = history.find((e) => e.url === entry.url) || entry;
  const highlights = live.highlights || [];

  if (entry.url && /^https?:/i.test(entry.url)) {
    setSource(entry.url, entry.url, false);
  } else if (entry.url) {
    setSource(entry.sourceName || `Imported · ${entry.title || "file"}`, "#", true);
  } else {
    setSource("", "#", false);
  }

  clear(articleEl);

  if (entry.title) {
    articleEl.appendChild(el("h1", { class: "title", text: entry.title }));
  }
  const meta = readingMeta(entry);
  if (meta.words) {
    articleEl.appendChild(el("div", {
      class: "read-meta",
      text: `${meta.mins} min read · ${meta.words.toLocaleString()} words`,
    }));
  }
  articleEl.appendChild(buildTagEditor(live));
  if (entry.synopsis) {
    articleEl.appendChild(el("div", { class: "section-label", text: "Synopsis" }));
    articleEl.appendChild(el("p", { class: "synopsis", text: entry.synopsis }));
  }

  const headings = (entry.blocks || [])
    .map(([kind, text], i) => ({ kind, text, i }))
    .filter((b) => b.kind === "h" && b.text && b.text.trim());
  // EPUB-imported articles get the floating "Chapters" button instead — skip
  // the inline "Contents" outline for them so we don't ship two navigators.
  const isEpubEntry = !!(entry && entry.imported && /\.epub$/i.test(entry.sourceName || ""));
  if (headings.length > 1 && !isEpubEntry) {
    articleEl.appendChild(buildToc(headings));
  }
  updateEpubChapterMenu(entry, headings);

  articleEl.appendChild(el("hr", { class: "divider" }));
  articleEl.appendChild(el("div", { class: "section-label", text: "Article" }));

  let listNode = null;
  (entry.blocks || []).forEach(([kind, text], i) => {
    if (kind === "li") {
      if (!listNode) {
        listNode = document.createElement("ul");
        articleEl.appendChild(listNode);
      }
      const li = document.createElement("li");
      fillBlock(li, text, i, highlights);
      listNode.appendChild(li);
      return;
    }
    listNode = null;
    let node;
    if (kind === "h") node = document.createElement("h2");
    else if (kind === "q") node = document.createElement("blockquote");
    else node = document.createElement("p");
    fillBlock(node, text, i, highlights);
    articleEl.appendChild(node);
  });

  if (keepScroll) {
    window.scrollTo(0, scrollY);
  } else {
    const saved = live.scrollY > 0 ? live.scrollY : 0;
    requestAnimationFrame(() => window.scrollTo(0, saved));
  }
  applyHlTitles();
  renderLibrary();
  scrollActiveSidebarIntoView();
  requestAnimationFrame(updateProgress);
  if (settings.focusMode) requestAnimationFrame(updateFocusHighlight);
}

function updateProgress() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const pct = max > 8 ? Math.min(1, window.scrollY / max) : 1;
  progressEl.style.width = (pct * 100) + "%";
  if (pct >= 0.99) markRead(activeUrl);
}

async function markRead(url) {
  if (!url) return;
  const entry = history.find((e) => e.url === url);
  if (!entry || entry.read) return;
  entry.read = true;
  entry.lastRead = Date.now();
  recordReadCompletion(entry.url);
  await browser.storage.local.set({ history });
  renderLibrary();
  scrollActiveSidebarIntoView();
}

let scrollSaveTimer = null;
function saveScrollSoon() {
  clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    const entry = liveEntry();
    if (!entry) return;
    entry.scrollY = Math.round(window.scrollY);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    entry.progressPct = max > 8 ? Math.max(0, Math.min(1, window.scrollY / max)) : 1;
    entry.lastRead = Date.now();
    browser.storage.local.set({ history });
    updateActiveStatusPill();
  }, 600);
}

// Update just the active row's status pill in place (cheap, no full re-render).
// Only meaningful when an article flips from Unread to Read (or vice-versa).
function updateActiveStatusPill() {
  const row = libraryEl.querySelector(".lib-item.active");
  const entry = liveEntry();
  if (!row || !entry) return;
  const s = articleStatus(entry);
  if (!row.classList.contains(s.key)) {
    row.classList.remove("unread", "read");
    row.classList.add(s.key);
    const pill = row.querySelector(".lib-status");
    if (pill) { pill.className = "lib-status " + s.key; pill.textContent = s.label; }
  }
}

function onScroll() {
  updateProgress();
  const entry = liveEntry();
  if (entry && !entry.read) {
    entry.scrollY = Math.round(window.scrollY); // in-memory immediately
  }
  saveScrollSoon();
  toTopBtn.hidden = window.scrollY < 600;
  if (settings.focusMode) updateFocusHighlight();
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", updateProgress, { passive: true });

toTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

function showEmpty(message) {
  clear(articleEl);
  articleEl.appendChild(el("div", { class: "empty", text: message }));
  if (epubChaptersEl) {
    epubChaptersEl.panel.hidden = true;
    epubChaptersEl.panel.classList.remove("open");
  }
}

/* ---------- Text-to-speech (read article aloud) ---------- */

let ttsQueue = [];
let ttsIndex = -1;
let ttsUrl = null;

function ttsSupported() {
  return typeof window.speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

function speechActive() {
  return ttsUrl != null;
}

function clearTtsHighlight() {
  for (const b of articleEl.querySelectorAll(".tts-active")) b.classList.remove("tts-active");
}

function stopSpeech(refresh = true) {
  if (!ttsSupported()) return;
  const was = speechActive();
  window.speechSynthesis.cancel();
  ttsQueue = [];
  ttsIndex = -1;
  ttsUrl = null;
  clearTtsHighlight();
  document.body.classList.remove("tts-on");
  if (was && refresh) renderAppearancePanel();
}

function speakNext() {
  ttsIndex++;
  if (ttsIndex >= ttsQueue.length) { stopSpeech(); return; }
  const { i, text } = ttsQueue[ttsIndex];
  clearTtsHighlight();
  const node = articleEl.querySelector(`[data-block="${i}"]`);
  if (node) {
    node.classList.add("tts-active");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1;
  utt.onend = () => speakNext();
  utt.onerror = () => speakNext();
  window.speechSynthesis.speak(utt);
}

// Start (or restart) reading aloud. With no argument it begins at the block
// nearest the viewport centre — i.e. wherever you're currently reading — so it
// no longer always restarts from the very top. Pass a block index to begin at
// a specific paragraph (used by click-to-jump).
function startSpeech(startBlock) {
  if (!ttsSupported()) return;
  const entry = liveEntry();
  if (!entry) return;
  stopSpeech(false);
  ttsQueue = (entry.blocks || [])
    .map(([, text], i) => ({ i, text: (text || "").trim() }))
    .filter((b) => b.text);
  if (!ttsQueue.length) return;
  ttsUrl = entry.url;

  // Resolve the requested start block (explicit arg, else viewport centre) to a
  // position within the spoken queue — the first queued block at/after it.
  let fromBlock = startBlock;
  if (typeof fromBlock !== "number") {
    const blocks = articleEl.querySelectorAll("[data-block]");
    fromBlock = blocks.length ? Number(blocks[centreBlockIndex(blocks)].dataset.block) : 0;
  }
  let qpos = ttsQueue.findIndex((b) => b.i >= fromBlock);
  if (qpos < 0) qpos = 0;
  ttsIndex = qpos - 1; // speakNext() increments before speaking

  document.body.classList.add("tts-on");
  speakNext();
  renderAppearancePanel();
}

function toggleSpeech() {
  if (!ttsSupported()) return;
  if (speechActive()) stopSpeech();
  else startSpeech();
}

async function deleteEntry(url) {
  if (ttsUrl === url) stopSpeech(false);
  history = history.filter((e) => e.url !== url);
  await browser.storage.local.set({ history });
  if (activeUrl === url) {
    if (history.length) {
      renderArticle(history[0]);
    } else {
      activeUrl = null;
      setSource("", "#", false);
      showEmpty("No saved articles. Open any article, click the Reader icon, then press Read this page.");
      renderLibrary();
    }
  } else {
    renderLibrary();
  }
}

/* ---------- Bulk select & actions ---------- */

const libActionsEl = document.querySelector(".lib-actions");
const selectToggleBtn = el("button", {
  class: "lib-select-toggle",
  text: "Select",
  title: "Select multiple articles to mark read, export, or delete them at once",
  onclick: toggleSelectMode,
});
const importBtn = el("button", {
  class: "lib-select-toggle lib-import",
  text: "Import file",
  title: "Import a PDF or EPUB file from your computer as a readable article",
  onclick: () => importFileInput.click(),
});
const libActionsLeft = el("div", { class: "lib-actions-left" }, [importBtn, selectToggleBtn]);
if (libActionsEl) libActionsEl.insertBefore(libActionsLeft, libActionsEl.firstChild);

const importFileInput = document.createElement("input");
importFileInput.type = "file";
importFileInput.accept = ".pdf,.epub,application/pdf,application/epub+zip";
importFileInput.style.display = "none";
document.body.appendChild(importFileInput);
importFileInput.addEventListener("change", handleImportFile);

async function handleImportFile() {
  const file = importFileInput.files && importFileInput.files[0];
  importFileInput.value = "";
  if (!file) return;
  const prevText = importBtn.textContent;
  importBtn.disabled = true;
  importBtn.textContent = "Importing…";
  try {
    const article = await importFileToArticle(file);
    if (!article.blocks || !article.blocks.length) throw new Error("No readable text found in that file");
    const url = `local-import://${Date.now()}-${encodeURIComponent(file.name || "")}`;
    const entry = {
      url,
      title: article.title || file.name || "Imported file",
      synopsis: article.synopsis || "",
      blocks: article.blocks,
      timestamp: Date.now(),
      read: false,
      pinned: false,
      highlights: [],
      imported: true,
      sourceName: file.name || "",
    };
    history = history.filter((e) => e.url !== entry.url);
    history.unshift(entry);
    history.length = Math.min(history.length, 200);
    await browser.storage.local.set({ history });
    activeUrl = entry.url;
    renderArticle(entry);
    renderLibrary();
  } catch (e) {
    alert(`Import failed: ${(e && e.message) || e}`);
  } finally {
    importBtn.disabled = false;
    importBtn.textContent = prevText;
  }
}

const bulkBar = el("div", { class: "bulk-bar" });
bulkBar.hidden = true;
if (libActionsEl) libActionsEl.parentNode.insertBefore(bulkBar, libActionsEl);

function toggleSelectMode() {
  selectMode = !selectMode;
  if (!selectMode) selected.clear();
  renderLibrary();
}

function renderBulkBar() {
  selectToggleBtn.textContent = selectMode ? "Done" : "Select";
  selectToggleBtn.classList.toggle("on", selectMode);
  clear(bulkBar);
  if (!selectMode) { bulkBar.hidden = true; return; }
  bulkBar.hidden = false;
  bulkBar.appendChild(el("span", { class: "bulk-count", text: `${selected.size} selected` }));
  bulkBar.appendChild(el("button", { class: "bulk-btn", text: "Mark read", onclick: () => bulkSetRead(true) }));
  bulkBar.appendChild(el("button", { class: "bulk-btn", text: "Mark unread", onclick: () => bulkSetRead(false) }));
  bulkBar.appendChild(el("button", { class: "bulk-btn", text: "Export", title: "Export selected articles as one Markdown file", onclick: bulkExport }));
  bulkBar.appendChild(el("button", { class: "bulk-btn danger", text: "Delete", onclick: bulkDelete }));
}

async function bulkSetRead(read) {
  if (!selected.size) return;
  let touched = false;
  for (const e of history) {
    if (!selected.has(e.url)) continue;
    e.read = read;
    if (read) { e.lastRead = Date.now(); recordReadCompletion(e.url); }
    touched = true;
  }
  if (!touched) return;
  await browser.storage.local.set({ history });
  renderLibrary();
  if (activeUrl && selected.has(activeUrl)) updateActiveStatusPill();
}

function bulkExport() {
  if (!selected.size) return;
  const entries = history.filter((e) => selected.has(e.url));
  if (!entries.length) return;
  let md = "";
  entries.forEach((e, i) => {
    if (i) md += "\n\n---\n\n";
    md += articleToMarkdown(e);
  });
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `articles (${entries.length}).md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function bulkDelete() {
  if (!selected.size) return;
  if (!confirm(`Delete ${selected.size} selected article${selected.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
  const urls = new Set(selected);
  const activeWasSelected = activeUrl && urls.has(activeUrl);
  if (activeWasSelected) stopSpeech(false);
  history = history.filter((e) => !urls.has(e.url));
  selected.clear();
  selectMode = false;
  await browser.storage.local.set({ history });
  if (activeWasSelected) {
    if (history.length) {
      renderArticle(history[0]);
    } else {
      activeUrl = null;
      setSource("", "#", false);
      showEmpty("No saved articles. Open any article, click the Reader icon, then press Read this page.");
      renderLibrary();
    }
  } else {
    renderLibrary();
  }
}

async function clearAll() {
  if (!history.length) return;
  stopSpeech(false);
  if (!confirm(`Delete all ${history.length} saved articles?`)) return;
  history = [];
  activeUrl = null;
  await browser.storage.local.set({ history });
  setSource("", "#", false);
  showEmpty("No saved articles.");
  renderLibrary();
}

/* ---------- Highlights & notes ---------- */

let pendingSelection = null;
let notePopId = null;

// Selection toolbar (colour swatches + Note)
const selBar = el("div", { class: "sel-bar" });
selBar.hidden = true;
for (const c of HL_COLORS) {
  const sw = el("button", { class: "sel-swatch", title: c.name, onclick: () => applyHighlight(c.value, false) });
  sw.style.background = c.value;
  selBar.appendChild(sw);
}
selBar.appendChild(el("button", { class: "sel-note", text: "Note", title: "Highlight and add a note", onclick: () => applyHighlight(HL_COLORS[0].value, true) }));
document.body.appendChild(selBar);

// Note popover
const noteText = el("textarea", { class: "note-text" });
noteText.placeholder = "Add a note…";
const notePop = el("div", { class: "note-pop" }, [
  noteText,
  el("div", { class: "note-actions" }, [
    el("button", { class: "note-remove", text: "Remove", onclick: removeHighlight }),
    el("span", { style: "flex:1" }),
    el("button", { class: "note-save", text: "Save", onclick: saveNote }),
  ]),
]);
notePop.hidden = true;
document.body.appendChild(notePop);

// Hover tooltip that shows a highlight's note (only when it has one)
const noteTip = el("div", { class: "note-tip" });
document.body.appendChild(noteTip);
let tipHideTimer = null;

function showNoteTip(span) {
  const entry = liveEntry();
  const h = entry && (entry.highlights || []).find((x) => x.id === span.dataset.id);
  if (!h || !h.note) return;
  noteTip.textContent = h.note;

  const rect = span.getBoundingClientRect();
  let left = rect.right + 10;          // to the right of the highlight
  let top = rect.top;
  if (left + noteTip.offsetWidth > window.innerWidth - 8) {
    left = Math.max(8, Math.min(rect.left, window.innerWidth - noteTip.offsetWidth - 8));
    top = rect.bottom + 8;            // no room on the right — drop below
  }
  top = Math.max(8, Math.min(top, window.innerHeight - noteTip.offsetHeight - 8));
  noteTip.style.left = left + "px";
  noteTip.style.top = top + "px";

  noteTip.classList.remove("show");
  void noteTip.offsetWidth;            // restart the pop animation
  noteTip.classList.add("show");
}

function hideNoteTip() {
  noteTip.classList.remove("show");
}

function hideSelBar() {
  selBar.hidden = true;
  pendingSelection = null;
}

function getBlockEl(node) {
  let n = node && node.nodeType === 1 ? node : node && node.parentNode;
  while (n && n !== articleEl) {
    if (n.dataset && n.dataset.block != null) return n;
    n = n.parentNode;
  }
  return null;
}

// Offsets into the block's plain text, robust to existing highlight spans.
function selectionOffsets(blockEl, range) {
  const pre = document.createRange();
  pre.selectNodeContents(blockEl);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return { start, end };
}

function onSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || !activeUrl) {
    hideSelBar();
    return;
  }
  const range = sel.getRangeAt(0);
  const blockEl = getBlockEl(range.commonAncestorContainer);
  if (!blockEl) { hideSelBar(); return; } // selection spans blocks or is outside

  const { start, end } = selectionOffsets(blockEl, range);
  if (end - start < 1) { hideSelBar(); return; }

  pendingSelection = { block: Number(blockEl.dataset.block), start, end, text: sel.toString() };
  const rect = range.getBoundingClientRect();
  selBar.hidden = false;
  const top = rect.top - selBar.offsetHeight - 8;
  let left = rect.left + rect.width / 2 - selBar.offsetWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - selBar.offsetWidth - 8));
  selBar.style.top = Math.max(8, top) + "px";
  selBar.style.left = left + "px";
}

async function applyHighlight(color, withNote) {
  if (!pendingSelection) return;
  const entry = liveEntry();
  if (!entry) return;
  entry.highlights = entry.highlights || [];
  const h = {
    id: genId(),
    block: pendingSelection.block,
    start: pendingSelection.start,
    end: pendingSelection.end,
    text: pendingSelection.text,
    color,
    note: "",
  };
  entry.highlights.push(h);
  await browser.storage.local.set({ history });
  hideSelBar();
  window.getSelection().removeAllRanges();
  refreshBlock(h.block);
  renderLibrary();
  if (withNote) openNotePopover(h.id);
}

function getHlRect(id) {
  const s = articleEl.querySelector(`.hl[data-id="${id}"]`);
  return s ? s.getBoundingClientRect() : null;
}

function positionPopover(rect) {
  if (!rect) { notePop.style.top = "80px"; notePop.style.left = "80px"; return; }
  let left = Math.max(8, Math.min(rect.left, window.innerWidth - notePop.offsetWidth - 8));
  let top = rect.bottom + 8;
  if (top + notePop.offsetHeight > window.innerHeight - 8) top = rect.top - notePop.offsetHeight - 8;
  notePop.style.top = Math.max(8, top) + "px";
  notePop.style.left = left + "px";
}

function openNotePopover(id, rect) {
  const entry = liveEntry();
  const h = entry && (entry.highlights || []).find((x) => x.id === id);
  if (!h) return;
  notePopId = id;
  noteText.value = h.note || "";
  notePop.hidden = false;
  positionPopover(rect || getHlRect(id));
  noteText.focus();
}

function closeNotePopover() {
  notePop.hidden = true;
  notePopId = null;
}

async function saveNote() {
  const entry = liveEntry();
  const h = entry && (entry.highlights || []).find((x) => x.id === notePopId);
  const block = h ? h.block : null;
  if (h) {
    h.note = noteText.value.trim();
    await browser.storage.local.set({ history });
  }
  closeNotePopover();
  if (block != null) { refreshBlock(block); renderLibrary(); }
}

async function removeHighlight() {
  const entry = liveEntry();
  const h = entry && (entry.highlights || []).find((x) => x.id === notePopId);
  const block = h ? h.block : null;
  if (entry && h) {
    entry.highlights = entry.highlights.filter((x) => x.id !== notePopId);
    await browser.storage.local.set({ history });
  }
  closeNotePopover();
  if (block != null) { refreshBlock(block); renderLibrary(); }
}

/* ---------- Highlights & notes review page ---------- */

function allHighlights() {
  const out = [];
  for (const entry of history) {
    for (const h of (entry.highlights || [])) out.push({ entry, h });
  }
  return out;
}

// Briefly flashes a highlight span so the user can spot it after jumping in.
function flashHighlight(id) {
  const span = articleEl.querySelector(`.hl[data-id="${id}"]`);
  if (!span) return;
  span.scrollIntoView({ behavior: "smooth", block: "center" });
  span.classList.remove("flash");
  void span.offsetWidth;
  span.classList.add("flash");
  setTimeout(() => span.classList.remove("flash"), 1500);
}

const hlViewSearch = document.createElement("input");
hlViewSearch.type = "search";
hlViewSearch.className = "hl-view-search";
hlViewSearch.placeholder = "Search highlights & notes…";
hlViewSearch.autocomplete = "off";

function renderHighlightsView() {
  highlightsViewActive = true;
  activeUrl = null;
  stopSpeech(false);
  clear(articleEl);

  const all = allHighlights();
  const articlesWithHls = new Set(all.map((x) => x.entry.url)).size;
  const noteCount = all.filter((x) => x.h.note).length;

  articleEl.appendChild(el("h1", { class: "title", text: "Highlights & notes" }));
  articleEl.appendChild(el("div", {
    class: "read-meta",
    text: all.length
      ? `${all.length} highlight${all.length === 1 ? "" : "s"} across ${articlesWithHls} article${articlesWithHls === 1 ? "" : "s"} · ${noteCount} with notes`
      : "No highlights yet — select text in any article to create one.",
  }));

  hlViewSearch.value = hlQuery;
  articleEl.appendChild(hlViewSearch);

  const list = el("div", { class: "hl-view-list" });
  articleEl.appendChild(list);

  const draw = () => {
    clear(list);
    const q = hlQuery.trim().toLowerCase();
    const filtered = all.filter(({ entry, h }) =>
      !q || `${h.text || ""} ${h.note || ""} ${entry.title || ""}`.toLowerCase().includes(q));

    if (!filtered.length) {
      list.appendChild(el("p", { class: "lib-empty", text: all.length ? "No highlights match your search." : "Nothing here yet." }));
      return;
    }

    const order = [];
    const groups = new Map();
    for (const item of filtered) {
      if (!groups.has(item.entry.url)) { groups.set(item.entry.url, []); order.push(item.entry.url); }
      groups.get(item.entry.url).push(item);
    }
    // Most-recently-saved articles first.
    order.sort((a, b) => (groups.get(b)[0].entry.timestamp || 0) - (groups.get(a)[0].entry.timestamp || 0));

    for (const url of order) {
      const items = groups.get(url);
      const entry = items[0].entry;
      const labels = settings.hlLabels || {};
      const group = el("div", { class: "hl-view-group" });
      group.appendChild(el("button", {
        class: "hl-view-group-title",
        text: entry.title || entry.url,
        title: "Open this article",
        onclick: () => renderArticle(entry),
      }));
      for (const { h } of items) {
        const label = labels[h.color];
        group.appendChild(el("div", { class: "hl-view-item" }, [
          el("span", { class: "hl-view-swatch", style: `background:${h.color}`, title: label || "" }),
          el("div", { class: "hl-view-body" }, [
            el("p", { class: "hl-view-text", text: `“${h.text}”` }),
            h.note ? el("p", { class: "hl-view-note", text: h.note }) : null,
          ]),
          el("button", {
            class: "hl-view-jump",
            text: "Open ↗",
            title: "Open the article and jump to this highlight",
            onclick: () => { renderArticle(entry); setTimeout(() => flashHighlight(h.id), 260); },
          }),
        ]));
      }
      list.appendChild(group);
    }
  };
  draw();
  hlViewSearch.oninput = () => { hlQuery = hlViewSearch.value; draw(); };

  renderLibrary();
}

const highlightsBtn = el("button", {
  class: "dock-btn",
  "data-tip": "Highlights & notes",
  "aria-label": "Highlights & notes",
  onclick: () => renderHighlightsView(),
}, [el("span", { class: "dock-ico", text: "✎" })]);
{
  const dockEl = document.getElementById("dock");
  const helpDiv = document.getElementById("help");
  if (dockEl && helpDiv) dockEl.insertBefore(highlightsBtn, helpDiv);
}

/* ---------- Reusable hover tooltip ---------- */
// One floating tooltip, shared by every element carrying a `data-tip`
// attribute (dock buttons, the filter/collapse/back-to-top controls, …).
// It's a single fixed element positioned over the hovered target, so it never
// gets dragged around by the dock's hover-scale transforms.
const uiTip = el("div", { class: "ui-tip", role: "tooltip" });
document.body.appendChild(uiTip);
let uiTipTarget = null;

function showUiTip(target) {
  const text = target.getAttribute("data-tip");
  if (!text) return;
  uiTip.textContent = text;
  uiTip.classList.add("show");
  const r = target.getBoundingClientRect();
  const tw = uiTip.offsetWidth;
  const th = uiTip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.top - th - 8;
  if (top < 8) top = r.bottom + 8; // flip below if it would clip the top edge
  uiTip.style.left = Math.round(left) + "px";
  uiTip.style.top = Math.round(top) + "px";
}

function hideUiTip() {
  uiTipTarget = null;
  uiTip.classList.remove("show");
}

document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (!t || t === uiTipTarget) return;
  uiTipTarget = t;
  showUiTip(t);
});
document.addEventListener("mouseout", (e) => {
  if (!uiTipTarget) return;
  const t = e.target.closest("[data-tip]");
  if (t && t === uiTipTarget && (!e.relatedTarget || !t.contains(e.relatedTarget))) hideUiTip();
});
// Don't let a stale tip linger over a button that was just clicked/scrolled.
document.addEventListener("click", hideUiTip, true);
window.addEventListener("scroll", hideUiTip, { passive: true });

articleEl.addEventListener("mouseup", () => setTimeout(onSelection, 0));

articleEl.addEventListener("click", (e) => {
  const span = e.target.closest(".hl");
  if (span) {
    e.stopPropagation();
    openNotePopover(span.dataset.id, span.getBoundingClientRect());
    return;
  }
  // While reading aloud, clicking a paragraph jumps playback to it — but not
  // when the click is the tail of a text selection (that's the highlight flow).
  if (speechActive()) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const block = e.target.closest("[data-block]");
    if (block) startSpeech(Number(block.dataset.block));
  }
});

articleEl.addEventListener("mouseover", (e) => {
  const span = e.target.closest(".hl.has-note");
  if (span) { clearTimeout(tipHideTimer); showNoteTip(span); }
});
articleEl.addEventListener("mouseout", (e) => {
  const span = e.target.closest(".hl.has-note");
  if (span) { tipHideTimer = setTimeout(hideNoteTip, 120); }
});

document.addEventListener("mousedown", (e) => {
  if (!selBar.hidden && !selBar.contains(e.target)) hideSelBar();
  if (!notePop.hidden && !notePop.contains(e.target) && !e.target.closest(".hl")) closeNotePopover();
  if (appearancePanel.classList.contains("open") && !appearancePanel.contains(e.target) && !appearanceBtn.contains(e.target)) {
    closeAppearance();
  }
});

/* ---------- Keyboard shortcuts ---------- */

const SHORTCUTS = [
  { keys: "j / k", desc: "Scroll down / up" },
  { keys: "n / p", desc: "Next / previous article in the library" },
  { keys: "/", desc: "Focus the search box" },
  { keys: "f", desc: "Toggle focus mode (dim all but a window of lines)" },
  { keys: "r", desc: "Read aloud from where you are / stop" },
  { keys: "t", desc: "Toggle the table of contents" },
  { keys: "g g", desc: "Jump to the top of the article" },
  { keys: "Shift+G", desc: "Jump to the end of the article" },
  { keys: "?", desc: "Show / hide this shortcuts panel" },
  { keys: "Esc", desc: "Close any open panel or popover" },
];

const shortcutsPanel = el("div", { class: "shortcuts-panel" }, [
  el("div", { class: "shortcuts-card" }, [
    el("h3", { text: "Keyboard shortcuts" }),
    el("ul", { class: "shortcuts-list" }, SHORTCUTS.map((s) =>
      el("li", {}, [
        el("kbd", { text: s.keys }),
        el("span", { text: s.desc }),
      ]))),
  ]),
]);
shortcutsPanel.hidden = true;
shortcutsPanel.addEventListener("mousedown", (e) => {
  if (e.target === shortcutsPanel) shortcutsPanel.hidden = true;
});
document.body.appendChild(shortcutsPanel);

function toggleShortcuts() {
  shortcutsPanel.hidden = !shortcutsPanel.hidden;
}

// Mirrors renderLibrary's filter + sort so n/p walk the same order the user sees.
function libraryOrder() {
  const entries = history.filter(matchesFilters);
  const sorted = [...entries];
  if (settings.sort === "title") {
    sorted.sort((a, b) => (a.title || a.url || "").localeCompare(b.title || b.url || ""));
  } else if (settings.sort === "unread") {
    const rank = (e) => ({ unread: 0, read: 1 }[articleStatus(e).key]);
    sorted.sort((a, b) => rank(a) - rank(b));
  }
  sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  return sorted;
}

function navigateArticle(delta) {
  const order = libraryOrder();
  if (!order.length) return;
  const idx = order.findIndex((e) => e.url === activeUrl);
  let next = idx === -1 ? 0 : idx + delta;
  next = Math.max(0, Math.min(order.length - 1, next));
  if (order[next] && order[next].url !== activeUrl) renderArticle(order[next]);
}

let lastGPress = 0;
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideSelBar();
    closeNotePopover();
    closeAppearance();
    shortcutsPanel.hidden = true;
    return;
  }

  const tag = (e.target && e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable);
  if (typing) {
    if (e.key === "Escape") searchEl.blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case "j":
      window.scrollBy({ top: 140, behavior: "smooth" });
      break;
    case "k":
      window.scrollBy({ top: -140, behavior: "smooth" });
      break;
    case "n":
      navigateArticle(1);
      break;
    case "p":
      navigateArticle(-1);
      break;
    case "/":
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
      break;
    case "f":
      toggleFocusMode();
      break;
    case "r":
      toggleSpeech();
      break;
    case "t": {
      const toc = articleEl.querySelector(".toc");
      if (toc) toc.classList.toggle("open");
      break;
    }
    case "g": {
      const now = Date.now();
      if (now - lastGPress < 500) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        lastGPress = 0;
      } else {
        lastGPress = now;
      }
      break;
    }
    case "G":
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      break;
    case "?":
      toggleShortcuts();
      break;
    default:
      return;
  }
});

/* ---------- Wiring ---------- */

document.getElementById("clear-all").addEventListener("click", clearAll);

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  renderLibrary();
});

/* ---------- Appearance panel ---------- */

const appearanceBtn = document.getElementById("appearance");
const appearancePanel = el("div", { class: "appearance-panel" });
document.body.appendChild(appearancePanel);

function apSection(label, node) {
  return el("div", { class: "ap-section" }, [el("div", { class: "ap-label", text: label }), node]);
}

function apOptionRow(options, isActive, pick, containerClass = "ap-row") {
  const row = el("div", { class: containerClass });
  for (const o of options) {
    row.appendChild(el("button", {
      class: "ap-btn" + (isActive(o) ? " active" : ""),
      text: o.name,
      onclick: () => { pick(o); saveSettings(); renderLibrary(); renderAppearancePanel(); },
    }));
  }
  return row;
}

function renderAppearancePanel() {
  clear(appearancePanel);

  const themeRow = el("div", { class: "ap-themes" });
  for (const t of THEMES) {
    themeRow.appendChild(el("button", {
      class: "ap-theme" + (settings.theme === t.id ? " active" : ""),
      title: t.name,
      onclick: () => applyThemeWithReveal(t.id),
    }, [
      el("span", { class: "swatch-top", style: `background:${t.bg}` }),
      el("span", { class: "swatch-bot", style: `background:${t.accent}` }),
    ]));
  }
  appearancePanel.appendChild(apSection("Theme", themeRow));

  appearancePanel.appendChild(apSection("Reading font",
    apOptionRow(FONTS, (o) => settings.font === o.id, (o) => { settings.font = o.id; })));

  appearancePanel.appendChild(apSection(`Text size — ${settings.fontSize}px`,
    el("div", { class: "ap-row" }, [
      el("button", { class: "ap-btn", text: "A−", title: "Smaller", onclick: () => changeFont(-1) }),
      el("button", { class: "ap-btn", text: "A+", title: "Larger", onclick: () => changeFont(1) }),
    ])));

  appearancePanel.appendChild(apSection(`Line height — ${(settings.lineHeight ?? DEFAULT_SETTINGS.lineHeight).toFixed(2)}`,
    el("div", { class: "ap-row" }, [
      el("button", { class: "ap-btn", text: "−", title: "Tighter", onclick: () => changeLineHeight(-LINE_HEIGHT_STEP) }),
      el("button", { class: "ap-btn", text: "+", title: "Looser", onclick: () => changeLineHeight(LINE_HEIGHT_STEP) }),
    ])));

  appearancePanel.appendChild(apSection(`Letter spacing — ${(settings.letterSpacing ?? 0).toFixed(2)}px`,
    el("div", { class: "ap-row" }, [
      el("button", { class: "ap-btn", text: "−", title: "Tighter", onclick: () => changeLetterSpacing(-LETTER_SPACING_STEP) }),
      el("button", { class: "ap-btn", text: "+", title: "Wider", onclick: () => changeLetterSpacing(LETTER_SPACING_STEP) }),
    ])));

  appearancePanel.appendChild(apSection("Width",
    apOptionRow(WIDTHS, (o) => settings.width === o.value, (o) => { settings.width = o.value; })));

  appearancePanel.appendChild(apSection("Sidebar",
    apOptionRow(SIDEBAR_MODES, (o) => settings.sidebar === o.id, (o) => { settings.sidebar = o.id; })));

  appearancePanel.appendChild(apSection("Library sort",
    apOptionRow(SORTS, (o) => settings.sort === o.id, (o) => { settings.sort = o.id; })));

  appearancePanel.appendChild(apSection("Theme transition",
    apOptionRow(TRANSITIONS, (o) => settings.transition === o.id, (o) => { settings.transition = o.id; }, "ap-grid")));

  appearancePanel.appendChild(apSection("Reading aids", el("div", { class: "ap-row" }, [
    el("button", {
      class: "ap-btn" + (settings.focusMode ? " active" : ""),
      text: settings.focusMode ? "Focus mode: On" : "Focus mode: Off",
      title: "Dim everything but the lines you're reading",
      onclick: toggleFocusMode,
    }),
    ttsSupported() ? el("button", {
      class: "ap-btn" + (speechActive() ? " active" : ""),
      text: speechActive() ? "⏹ Stop reading aloud" : "🔊 Read article aloud",
      title: "Read aloud from where you are — click any paragraph while it plays to jump there",
      onclick: () => toggleSpeech(),
    }) : null,
  ])));

  appearancePanel.appendChild(apSection(`Focus window — ${settings.focusLines ?? DEFAULT_SETTINGS.focusLines} lines`,
    el("div", { class: "ap-row" }, [
      el("button", { class: "ap-btn", text: "−", title: "Fewer lines in focus", onclick: () => changeFocusLines(-1) }),
      el("button", { class: "ap-btn", text: "+", title: "More lines in focus", onclick: () => changeFocusLines(1) }),
    ])));

  appearancePanel.appendChild(apSection("Highlight colours mean…", buildHlLegend()));

  // Reset to factory defaults — kept at the very bottom so it never sits next
  // to (and gets confused with) the routine adjusters above it.
  appearancePanel.appendChild(el("div", { class: "ap-section ap-reset-section" }, [
    el("button", {
      class: "ap-btn ap-reset",
      text: "Reset settings",
      title: "Restore every setting to its default",
      onclick: resetSettings,
    }),
  ]));
}

// Wipe the user's tweaks and put every appearance/behaviour setting back to
// its DEFAULT_SETTINGS value. Keeps highlight-colour labels (they're personal
// vocabulary, not appearance) so a reset doesn't blow them away by surprise.
function resetSettings() {
  const keepLabels = settings.hlLabels || {};
  settings = { ...DEFAULT_SETTINGS, hlLabels: keepLabels };
  applySettings();
  saveSettings();
  renderLibrary();
  renderAppearancePanel();
}

function changeFont(delta) {
  settings.fontSize = Math.max(FONT_MIN, Math.min(FONT_MAX, settings.fontSize + delta));
  saveSettings();
  renderAppearancePanel();
}

function changeLineHeight(delta) {
  const cur = settings.lineHeight ?? DEFAULT_SETTINGS.lineHeight;
  settings.lineHeight = Math.round(Math.max(LINE_HEIGHT_MIN, Math.min(LINE_HEIGHT_MAX, cur + delta)) * 100) / 100;
  saveSettings();
  renderAppearancePanel();
}

function changeLetterSpacing(delta) {
  const cur = settings.letterSpacing ?? 0;
  settings.letterSpacing = Math.round(Math.max(LETTER_SPACING_MIN, Math.min(LETTER_SPACING_MAX, cur + delta)) * 100) / 100;
  saveSettings();
  renderAppearancePanel();
}

function changeFocusLines(delta) {
  const cur = settings.focusLines ?? DEFAULT_SETTINGS.focusLines;
  settings.focusLines = Math.max(FOCUS_LINES_MIN, Math.min(FOCUS_LINES_MAX, cur + delta));
  saveSettings();
  if (settings.focusMode) updateFocusHighlight();
  renderAppearancePanel();
}

// Build a randomized fractal-edged polygon that expands from a point to cover
// the whole screen. Different jagged shape, origin, and rotation every call.
function randomFractalClip() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cx = w * (0.3 + Math.random() * 0.4); // origin, biased toward centre
  const cy = h * (0.3 + Math.random() * 0.4);
  const points = 30 + Math.floor(Math.random() * 30);        // 30..59 vertices
  const rot = Math.random() * Math.PI * 2;

  // Random harmonics -> fractal-ish wavy boundary
  const harms = [];
  const harmCount = 3 + Math.floor(Math.random() * 4);       // 3..6
  for (let i = 0; i < harmCount; i++) {
    harms.push({
      k: 2 + Math.floor(Math.random() * 9),
      amp: (0.15 + Math.random() * 0.5) / (i + 1),
      phase: Math.random() * Math.PI * 2,
    });
  }

  const radii = [];
  let minR = Infinity;
  for (let i = 0; i < points; i++) {
    const a = rot + (i / points) * Math.PI * 2;
    let r = 1;
    for (const hmn of harms) r += hmn.amp * Math.sin(hmn.k * a + hmn.phase);
    r = Math.max(0.08, r);
    radii.push({ a, r });
    if (r < minR) minR = r;
  }

  // Scale the end so even the deepest inlet still clears the farthest corner.
  const corner = Math.max(
    Math.hypot(cx, cy), Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy)
  );
  const baseEnd = (corner / minR) * 1.08;
  const baseStart = baseEnd * 0.001;
  const poly = (base) => "polygon(" + radii.map(({ a, r }) =>
    `${(cx + Math.cos(a) * base * r).toFixed(1)}px ${(cy + Math.sin(a) * base * r).toFixed(1)}px`
  ).join(", ") + ")";

  return { from: poly(baseStart), to: poly(baseEnd) };
}

// --- Theme transition styles: each returns clip-path keyframes (+ optional
//     duration/easing) for ::view-transition-new(root). ---

function circlePath(cx, cy, r) {
  const k = 0.5522847498 * r;
  return `M ${cx - r} ${cy} `
    + `C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} `
    + `C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} `
    + `C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} `
    + `C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} Z`;
}

const REVEALS = {
  // Circle expanding from the centre of the page.
  clean() {
    const x = window.innerWidth / 2, y = window.innerHeight / 2, r = Math.hypot(x, y);
    return { from: `circle(0px at ${x}px ${y}px)`, to: `circle(${r}px at ${x}px ${y}px)` };
  },
  // Random fractal-edged burst.
  fractals() { return randomFractalClip(); },
  // Several circles blooming from random points and merging.
  bubbles() {
    const w = window.innerWidth, h = window.innerHeight, diag = Math.hypot(w, h);
    const K = 5 + Math.floor(Math.random() * 4);
    const centres = Array.from({ length: K }, () => [Math.random() * w, Math.random() * h]);
    const at = (r) => 'path("' + centres.map(([x, y]) => circlePath(x, y, r)).join(" ") + '")';
    return { from: at(0.5), to: at(diag), easing: "ease-out", duration: 1200 };
  },
  // Directional linear wipe (random side).
  wipe() {
    const dirs = ["inset(0 100% 0 0)", "inset(0 0 0 100%)", "inset(100% 0 0 0)", "inset(0 0 100% 0)"];
    return { from: dirs[Math.floor(Math.random() * dirs.length)], to: "inset(0 0 0 0)", easing: "ease-in-out" };
  },
  // Rotated square growing from the centre.
  diamond() {
    const x = window.innerWidth / 2, y = window.innerHeight / 2;
    const R = ((window.innerWidth + window.innerHeight) / 2) * 1.05;
    const poly = (r) => `polygon(${x}px ${y - r}px, ${x + r}px ${y}px, ${x}px ${y + r}px, ${x - r}px ${y}px)`;
    return { from: poly(0.01), to: poly(R) };
  },
  // Venetian blinds — horizontal bars expanding from their centre lines.
  blinds() {
    const w = window.innerWidth, h = window.innerHeight;
    const N = 8 + Math.floor(Math.random() * 6);
    const band = h / N;
    const rect = (y0, hh) => `M 0 ${y0} H ${w} V ${y0 + hh} H 0 Z`;
    const from = 'path("' + Array.from({ length: N }, (_, i) => rect(i * band + band / 2 - 0.5, 1)).join(" ") + '")';
    const to = 'path("' + Array.from({ length: N }, (_, i) => rect(i * band, band + 1)).join(" ") + '")';
    return { from, to, easing: "ease-out", duration: 1050 };
  },
  // Many shards bursting outward — random triangles that grow to cover the page.
  shatter() {
    const w = window.innerWidth, h = window.innerHeight, diag = Math.hypot(w, h);
    const x = w / 2, y = h / 2;
    const N = 10 + Math.floor(Math.random() * 8);
    const jitter = () => 0.75 + Math.random() * 0.6;
    const wedges = Array.from({ length: N }, (_, i) => ({
      a0: (i / N) * Math.PI * 2,
      a1: ((i + 1) / N) * Math.PI * 2,
      j: jitter(),
    }));
    const at = (r) => 'path("' + wedges.map(({ a0, a1, j }) => {
      const rr = r * j;
      return `M ${x} ${y} L ${(x + Math.cos(a0) * rr).toFixed(1)} ${(y + Math.sin(a0) * rr).toFixed(1)} `
        + `L ${(x + Math.cos(a1) * rr).toFixed(1)} ${(y + Math.sin(a1) * rr).toFixed(1)} Z`;
    }).join(" ") + '")';
    return { from: at(0.5), to: at(diag * 1.3), easing: "ease-in", duration: 1150 };
  },
};

function buildReveal(style) {
  if (style === "random") {
    const ids = Object.keys(REVEALS);
    style = ids[Math.floor(Math.random() * ids.length)];
  }
  return (REVEALS[style] || REVEALS.clean)();
}

// Switch theme with the chosen reveal animation.
function applyThemeWithReveal(themeId) {
  const apply = () => {
    settings.theme = themeId;
    applySettings();
    browser.storage.local.set({ settings });
    renderAppearancePanel();
  };
  if (typeof document.startViewTransition !== "function") { apply(); return; }

  const rev = buildReveal(settings.transition || "clean");
  const vt = document.startViewTransition(apply);
  vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [rev.from, rev.to] },
      { duration: rev.duration || 1150, easing: rev.easing || "ease-in", pseudoElement: "::view-transition-new(root)" }
    );
  }).catch(() => {});
}

function closeAppearance() {
  appearancePanel.classList.remove("open");
}

function toggleAppearance() {
  if (appearancePanel.classList.contains("open")) { closeAppearance(); return; }
  renderAppearancePanel();
  // The panel is never display:none, so it's measurable while still invisible —
  // position it first, then add .open on the next frame to trigger the
  // open animation from the correct spot.
  const r = appearanceBtn.getBoundingClientRect();
  const pw = appearancePanel.offsetWidth;
  const ph = appearancePanel.offsetHeight;
  const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
  let top = r.top - ph - 10;                       // prefer opening above the button
  if (top < 8) top = Math.max(8, window.innerHeight - ph - 8);
  appearancePanel.style.left = left + "px";
  appearancePanel.style.top = top + "px";
  requestAnimationFrame(() => appearancePanel.classList.add("open"));
}

appearanceBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleAppearance(); });

/* ---------- Export & sidebar toggle ---------- */

function blockToMarkdown([kind, text]) {
  if (kind === "h") return `## ${text}\n\n`;
  if (kind === "li") return `- ${text}\n`;
  if (kind === "q") return `> ${text}\n\n`;
  return `${text}\n\n`;
}

function articleToMarkdown(entry) {
  let md = "";
  if (entry.title) md += `# ${entry.title}\n\n`;
  if (entry.synopsis) md += `> ${entry.synopsis}\n\n`;
  if (entry.url && /^https?:/i.test(entry.url)) md += `[Original](${entry.url})\n\n`;
  else if (entry.sourceName) md += `*Imported from ${entry.sourceName}*\n\n`;
  md += "---\n\n";
  for (const b of entry.blocks || []) md += blockToMarkdown(b);
  const hls = entry.highlights || [];
  if (hls.length) {
    md += `\n---\n\n## Highlights & notes\n\n`;
    for (const h of hls) {
      md += `- “${h.text}”`;
      if (h.note) md += `\n  - ${h.note}`;
      md += "\n";
    }
  }
  return md;
}

function exportArticle() {
  const entry = liveEntry();
  if (!entry) return;
  const blob = new Blob([articleToMarkdown(entry)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = (entry.title || "article").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "article";
  a.download = name + ".md";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toggleSidebarCollapsed() {
  settings.sidebar = (settings.sidebar === "hidden") ? "pinned" : "hidden";
  saveSettings();
}

const exportBtn = document.getElementById("export");
exportBtn.addEventListener("click", () => {
  exportArticle();
  const ico = exportBtn.querySelector(".dock-ico");
  if (ico) {
    ico.classList.remove("downloading");
    void ico.offsetWidth; // restart the animation
    ico.classList.add("downloading");
  }
});
const exportIco = exportBtn.querySelector(".dock-ico");
if (exportIco) exportIco.addEventListener("animationend", () => exportIco.classList.remove("downloading"));

// One handle does double duty, parked on the inside of the sidebar's right
// edge. Its CSS transitions for position and rotation share the exact same
// duration/easing as the sidebar's own grid-column collapse (.layout), so
// toggling `data-sidebar` drives all three in perfect lockstep: the handle
// slides from the sidebar's edge to the screen's edge exactly as the sidebar
// itself slides shut, and its glyph flips 180° — from "‹" to "›" — at the
// same time, arriving as the "expand" control right where it's needed.
const collapseBtn = document.getElementById("collapse-sidebar");
collapseBtn.addEventListener("click", toggleSidebarCollapsed);

// Reveal/Hover modes: edge hover-zone slides the sidebar in; leaving it
// slides back out. Hover now runs the exact same code path as Reveal.
const sidebarAside = document.querySelector(".library");
const revealZone = document.querySelector(".reveal-zone");
revealZone.addEventListener("mouseenter", () => {
  if (settings.sidebar === "reveal" || settings.sidebar === "hover") document.body.classList.add("reveal-open");
});
sidebarAside.addEventListener("mouseleave", () => {
  document.body.classList.remove("reveal-open");
});

/* ---------- First-run onboarding walkthrough ---------- */
// Shown once, the first time the reader is opened after install. A clean,
// multi-step tour with Back/Next that finishes by letting the reader pick
// their look. The `onboarded` flag in storage keeps it from showing again.
const ONB_STEPS = [
  {
    icon: "◐",
    title: "Welcome to Reader",
    lines: [
      "Reader strips any web article down to just the words — no ads, no banners, no clutter.",
      "Your library, highlights, and settings all live on your device. Nothing is ever sent to a server.",
    ],
  },
  {
    icon: "🧩",
    title: "Opening Reader",
    lines: [
      "Reader lives in your browser's toolbar. Click its icon to open the popup.",
      "Don't see it? Click the puzzle-piece (Extensions) button in the toolbar and pin Reader so it's always one click away.",
      "On any article, open the popup and press “Read this page”. The clean version opens here and is saved to your library.",
    ],
  },
  {
    icon: "📚",
    title: "Your library",
    lines: [
      "Saved articles sit in the sidebar on the left. Click one to open it — reopening picks up exactly where you left off.",
      "Search or filter by status, pin favourites to the top, or hit Select to mark, export, or delete several at once.",
      "Import also lets you read PDF and EPUB files straight from your computer.",
    ],
  },
  {
    icon: "✎",
    title: "Reading tools",
    lines: [
      "Select any text to highlight it and attach a note.",
      "Focus mode (f) dims everything but the lines you're reading. Read aloud (r) speaks the article from wherever you are.",
      "Press ? at any time for the full list of keyboard shortcuts.",
    ],
  },
];

function showOnboarding() {
  let step = 0;
  const TOTAL = ONB_STEPS.length + 1; // content steps + the settings step

  const overlay = el("div", { class: "onb-overlay" });
  const card = el("div", { class: "onb-card", role: "dialog", "aria-label": "Welcome to Reader" });
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));

  function finish() {
    overlay.classList.remove("show");
    browser.storage.local.set({ onboarded: true });
    setTimeout(() => overlay.remove(), 320);
  }

  // The final step: a compact, live settings picker (theme/font/size/sidebar).
  function buildSettingsStep() {
    const themeRow = el("div", { class: "ap-themes" });
    const draw = () => render(); // re-render whole step so active states refresh
    for (const t of THEMES) {
      themeRow.appendChild(el("button", {
        class: "ap-theme" + (settings.theme === t.id ? " active" : ""),
        title: t.name,
        onclick: () => { applyThemeWithReveal(t.id); draw(); },
      }, [
        el("span", { class: "swatch-top", style: `background:${t.bg}` }),
        el("span", { class: "swatch-bot", style: `background:${t.accent}` }),
      ]));
    }
    const fontRow = el("div", { class: "ap-row" }, FONTS.map((o) =>
      el("button", {
        class: "ap-btn" + (settings.font === o.id ? " active" : ""),
        text: o.name,
        onclick: () => { settings.font = o.id; saveSettings(); draw(); },
      })));
    const sizeRow = el("div", { class: "ap-row" }, [
      el("button", { class: "ap-btn", text: "A−", onclick: () => { changeFont(-1); draw(); } }),
      el("button", { class: "ap-btn", text: "A+", onclick: () => { changeFont(1); draw(); } }),
    ]);
    const sidebarRow = el("div", { class: "ap-row" }, SIDEBAR_MODES.map((o) =>
      el("button", {
        class: "ap-btn" + (settings.sidebar === o.id ? " active" : ""),
        text: o.name,
        onclick: () => { settings.sidebar = o.id; saveSettings(); draw(); },
      })));

    return el("div", { class: "onb-step onb-settings" }, [
      el("div", { class: "onb-icon", text: "🎨" }),
      el("h2", { class: "onb-title", text: "Make it yours" }),
      el("p", { class: "onb-sub", text: "Pick a look to start with — you can change all of this later from the ⚙ button." }),
      el("div", { class: "onb-set-group" }, [el("div", { class: "ap-label", text: `Text size — ${settings.fontSize}px` }), sizeRow]),
      el("div", { class: "onb-set-group" }, [el("div", { class: "ap-label", text: "Theme" }), themeRow]),
      el("div", { class: "onb-set-group" }, [el("div", { class: "ap-label", text: "Reading font" }), fontRow]),
      el("div", { class: "onb-set-group" }, [el("div", { class: "ap-label", text: "Sidebar" }), sidebarRow]),
    ]);
  }

  function render() {
    clear(card);
    const isSettings = step === ONB_STEPS.length;

    const dots = el("div", { class: "onb-dots" });
    for (let i = 0; i < TOTAL; i++) {
      dots.appendChild(el("span", { class: "onb-dot" + (i === step ? " on" : (i < step ? " done" : "")) }));
    }
    const skip = el("button", { class: "onb-skip", text: "Skip tour", onclick: finish });
    card.appendChild(el("div", { class: "onb-head" }, [dots, skip]));

    if (isSettings) {
      card.appendChild(buildSettingsStep());
    } else {
      const s = ONB_STEPS[step];
      card.appendChild(el("div", { class: "onb-step" }, [
        el("div", { class: "onb-icon", text: s.icon }),
        el("h2", { class: "onb-title", text: s.title }),
        el("div", { class: "onb-lines" }, s.lines.map((t) => el("p", { text: t }))),
      ]));
    }

    const back = el("button", {
      class: "onb-btn onb-back",
      text: "Back",
      onclick: () => { if (step > 0) { step--; render(); } },
    });
    if (step === 0) back.disabled = true;
    const next = el("button", {
      class: "onb-btn onb-next",
      text: isSettings ? "Finish" : "Next",
      onclick: () => { if (isSettings) finish(); else { step++; render(); } },
    });
    card.appendChild(el("div", { class: "onb-foot" }, [back, next]));
  }

  render();
}

// "Replay the welcome tour" button inside the help panel.
{
  const replayBtn = document.getElementById("replay-tour");
  if (replayBtn) replayBtn.addEventListener("click", () => {
    if (!document.querySelector(".onb-overlay")) showOnboarding();
  });
}

async function init() {
  const data = await browser.storage.local.get(["pending", "history", "settings", "stats", "onboarded"]);
  settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  applySettings();
  history = Array.isArray(data.history) ? data.history : [];
  stats = { days: [], total: 0, ...(data.stats || {}) };
  renderStreak();
  if (!data.onboarded) showOnboarding();
  const pending = data.pending;

  if (pending && pending.blocks && pending.blocks.length) {
    renderArticle(pending);
    await browser.storage.local.remove("pending");
  } else if (history.length) {
    // Pick back up automatically: prefer whatever was most recently being
    // read and isn't finished yet, so opening a fresh tab drops you right
    // back into it (at its saved scroll position) instead of always showing
    // the most recently *saved* article.
    const inProgress = history
      .filter((e) => !e.read && (e.scrollY || 0) > 40)
      .sort((a, b) => (b.lastRead || b.timestamp || 0) - (a.lastRead || a.timestamp || 0));
    renderArticle(inProgress[0] || history[0]);
  } else {
    showEmpty("Open any article, click the Reader icon, then press Read this page.");
    renderLibrary();
  }
}

init();
