const btn = document.getElementById("run");
const status = document.getElementById("status");

// Mirror the reader's current theme in this popup so the two surfaces match.
// Settings live in browser.storage.local; the default (no data-theme attr) is
// the same baseline dark palette as :root in reader.css.
(async function applySavedTheme() {
  try {
    const { settings } = await browser.storage.local.get("settings");
    const theme = settings && settings.theme;
    if (theme && theme !== "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch (_) { /* fall back to the default palette */ }
})();

btn.addEventListener("click", async () => {
  btn.disabled = true;
  status.textContent = "Fetching…";
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error("No active tab");
    if (!/^https?:/.test(tab.url || "")) {
      throw new Error("Only http(s) pages can be read");
    }

    const article = await fetchAndExtract(tab.url);
    if (!article || !article.blocks || article.blocks.length === 0) {
      throw new Error("No readable content found");
    }
    article.url = tab.url;
    article.timestamp = Date.now();

    await browser.storage.local.set({ pending: article });

    const data = await browser.storage.local.get("history");
    const history = Array.isArray(data.history) ? data.history : [];
    const trimmed = history.filter((e) => e.url !== article.url);
    trimmed.unshift({
      url: article.url,
      title: article.title,
      synopsis: article.synopsis,
      blocks: article.blocks,
      timestamp: article.timestamp,
      read: false,
      pinned: false,
      highlights: [],
    });
    trimmed.length = Math.min(trimmed.length, 200);
    await browser.storage.local.set({ history: trimmed });

    const readerUrl = browser.runtime.getURL("reader.html");
    await browser.tabs.update(tab.id, { url: readerUrl });
    window.close();
  } catch (e) {
    status.textContent = e.message || String(e);
    btn.disabled = false;
  }
});
