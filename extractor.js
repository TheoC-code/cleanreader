const JUNK_TAGS = new Set([
  "script","style","noscript","template","iframe","svg","form","button",
  "input","select","textarea","nav","aside","header","footer",
]);
const JUNK_HINTS = /(?:^|[\s_-])(ad|ads|advert|promo|sponsor|banner|popup|modal|cookie|newsletter|subscribe|related|recommend|share|social|comment|sidebar|nav|menu|breadcrumb|footer|header|masthead|signup|paywall)(?:$|[\s_-])/i;
const HEADINGS = new Set(["h1","h2","h3","h4","h5","h6"]);
const STOPWORDS = new Set(("a an the and or but if while of in on at to from by for with about as into like through after over between out against during without before under around among is are was were be been being have has had do does did will would should can could may might must shall i you he she it we they them his her its our their this that these those there here what which who whom whose how why when where not no nor so than too very just only own same also").split(" "));
const SENT_SPLIT = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/g;
const WORD_RE = /[A-Za-z][A-Za-z'-]+/g;
const TITLE_JUNK = /\b(facebook|instagram|youtube|twitter|x\.com|linkedin|flipboard|tiktok|pinterest|reddit|threads|whatsapp|telegram|rss|share|menu|search|subscribe|sign[\s-]?in|log[\s-]?in|privacy[-\s]?options?|cookies?|newsletter)\b/gi;

function cleanTitle(raw) {
  if (!raw) return "";
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(TITLE_JUNK, " ");
  t = t.replace(/(\b[\w'’]+(?:\s+[\w'’]+){0,4}\b)(?:\s*\1)+/gi, "$1");
  t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
  t = t.replace(/(\b[\w'’]+(?:\s+[\w'’]+){0,4}\b)(?:\s+\1)+/gi, "$1");
  return t.replace(/\s+/g, " ").replace(/^[\s\-–—|·•:,]+|[\s\-–—|·•:,]+$/g, "");
}

function isJunky(el) {
  if (!el || el.nodeType !== 1) return false;
  if (JUNK_TAGS.has(el.tagName.toLowerCase())) return true;
  const sig = `${el.className || ""} ${el.id || ""} ${el.getAttribute("role") || ""} ${el.getAttribute("aria-label") || ""}`;
  return JUNK_HINTS.test(sig);
}

function getText(el) {
  return (el.textContent || "").replace(/\s+/g, " ").trim();
}

function pickRoot(doc) {
  const cands = [];
  doc.querySelectorAll("article, main, [role=main], [itemprop=articleBody]").forEach((el) => {
    cands.push(el);
  });
  if (cands.length === 0 && doc.body) cands.push(doc.body);
  let best = cands[0], bestScore = -1;
  for (const el of cands) {
    const score = (el.textContent || "").length;
    if (score > bestScore) { best = el; bestScore = score; }
  }
  return best;
}

function walk(root) {
  const blocks = [];
  if (!root) return blocks;
  function visit(el) {
    if (!el || el.nodeType !== 1) return;
    if (isJunky(el)) return;
    const tag = el.tagName.toLowerCase();
    if (HEADINGS.has(tag)) {
      const t = getText(el);
      if (t) blocks.push(["h", t]);
      return;
    }
    if (tag === "li") {
      const t = getText(el);
      if (t) blocks.push(["li", t]);
      return;
    }
    if (tag === "blockquote") {
      const t = getText(el);
      if (t) blocks.push(["q", t]);
      return;
    }
    if (tag === "p" || tag === "pre") {
      const t = getText(el);
      if (t && t.split(/\s+/).length >= 8) blocks.push(["p", t]);
      return;
    }
    for (const child of el.children) visit(child);
  }
  visit(root);
  return blocks;
}

function summarize(text, maxSentences = 3) {
  const sents = text.split(SENT_SPLIT).map((s) => s.trim()).filter(Boolean);
  if (sents.length <= maxSentences) return sents.join(" ");
  const freq = new Map();
  for (const s of sents) {
    for (const w of s.toLowerCase().match(WORD_RE) || []) {
      if (w.length > 2 && !STOPWORDS.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  if (freq.size === 0) return sents.slice(0, maxSentences).join(" ");
  const top = Math.max(...freq.values());
  const scored = [];
  sents.forEach((s, i) => {
    const words = (s.toLowerCase().match(WORD_RE) || []).filter((w) => !STOPWORDS.has(w));
    if (!words.length) return;
    let score = words.reduce((a, w) => a + (freq.get(w) || 0) / top, 0) / Math.sqrt(words.length);
    score *= 1 + 0.15 * (1 - i / sents.length);
    scored.push([score, i, s]);
  });
  scored.sort((a, b) => b[0] - a[0]);
  const picked = scored.slice(0, maxSentences).sort((a, b) => a[1] - b[1]);
  return picked.map(([, , s]) => s).join(" ");
}

function extractFromDocument(doc) {
  const metaTitle =
    doc.querySelector('meta[property="og:title"]')?.content ||
    doc.querySelector('meta[name="twitter:title"]')?.content ||
    doc.title ||
    "";
  const title = cleanTitle(metaTitle);
  const root = pickRoot(doc);
  const blocks = walk(root);
  const bodyText = blocks.filter(([k]) => k === "p").map(([, t]) => t).join(" ");
  const synopsis = bodyText ? summarize(bodyText, 3) : "";
  return { title, synopsis, blocks };
}

async function fetchAndExtract(url) {
  const resp = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    headers: {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
  const html = await resp.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  return extractFromDocument(doc);
}
