/* ---------- File import: turn .epub / .pdf files into reader articles ----------
   Self-contained — no external libraries. Uses the platform's native
   DecompressionStream for both ZIP (EPUB container) and PDF FlateDecode
   streams, so the whole thing stays a few KB of plain JS. */

/* ===== shared byte/string helpers ===== */

function bytesToBinaryString(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return s;
}
function bufToBinaryString(buf) { return bytesToBinaryString(new Uint8Array(buf)); }
function binaryStringToBytes(str) {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}
async function inflate(bytes, format) {
  try {
    const ds = new DecompressionStream(format);
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (e) {
    return null;
  }
}

const WINANSI_HIGH = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…",
  0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8A: "Š",
  0x8B: "‹", 0x8C: "Œ", 0x8E: "Ž", 0x91: "‘", 0x92: "’",
  0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",
  0x98: "˜", 0x99: "™", 0x9A: "š", 0x9B: "›", 0x9C: "œ",
  0x9E: "ž", 0x9F: "Ÿ",
};
function winAnsiChar(code) { return WINANSI_HIGH[code] || String.fromCharCode(code); }

function simpleSynopsis(blocks) {
  const text = blocks.filter(([k]) => k === "p").map(([, t]) => t).join(" ");
  if (!text) return "";
  if (typeof summarize === "function") return summarize(text, 3);
  const sents = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/g).map((s) => s.trim()).filter(Boolean);
  return sents.slice(0, 3).join(" ");
}

/* =====================================================================
   EPUB — a zip archive of XHTML chapters described by a content.opf
   ===================================================================== */

async function unzip(buf) {
  const data = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  const min = Math.max(0, data.length - 22 - 65536);
  for (let i = data.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .epub (zip) file");
  const entryCount = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  const meta = [];
  for (let i = 0; i < entryCount; i++) {
    if (cdOffset + 46 > data.length || dv.getUint32(cdOffset, true) !== 0x02014b50) break;
    const compression = dv.getUint16(cdOffset + 10, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localOffset = dv.getUint32(cdOffset + 42, true);
    const name = new TextDecoder("utf-8").decode(data.subarray(cdOffset + 46, cdOffset + 46 + nameLen));
    meta.push({ name, compression, compSize, localOffset });
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  const out = new Map();
  for (const m of meta) {
    if (!m.name || m.name.endsWith("/")) continue;
    const lh = m.localOffset;
    if (lh + 30 > data.length || dv.getUint32(lh, true) !== 0x04034b50) continue;
    const nameLen = dv.getUint16(lh + 26, true);
    const extraLen = dv.getUint16(lh + 28, true);
    const dataStart = lh + 30 + nameLen + extraLen;
    const compressed = data.subarray(dataStart, dataStart + m.compSize);
    let bytes = null;
    if (m.compression === 0) bytes = compressed;
    else if (m.compression === 8) bytes = await inflate(compressed, "deflate-raw");
    if (bytes) out.set(m.name, bytes);
  }
  return out;
}

function resolveZipPath(baseDir, href) {
  href = String(href).split("#")[0];
  const parts = (baseDir + href).split("/");
  const out = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const EPUB_HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
function walkEpubContent(root) {
  const blocks = [];
  const getText = (node) => (node.textContent || "").replace(/\s+/g, " ").trim();
  function visit(node) {
    if (!node || node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style") return;
    if (EPUB_HEADINGS.has(tag)) { const t = getText(node); if (t) blocks.push(["h", t]); return; }
    if (tag === "li") { const t = getText(node); if (t) blocks.push(["li", t]); return; }
    if (tag === "blockquote") { const t = getText(node); if (t) blocks.push(["q", t]); return; }
    if (tag === "p" || tag === "pre") { const t = getText(node); if (t) blocks.push(["p", t]); return; }
    for (const child of node.children) visit(child);
  }
  visit(root);
  return blocks;
}

async function extractEpub(arrayBuffer, filename) {
  const files = await unzip(arrayBuffer);

  let opfPath = null;
  const containerBytes = files.get("META-INF/container.xml");
  if (containerBytes) {
    const doc = new DOMParser().parseFromString(bytesToBinaryStringUtf8(containerBytes), "application/xml");
    const rootfile = doc.querySelector("rootfile");
    opfPath = rootfile && rootfile.getAttribute("full-path");
  }
  if (!opfPath) {
    for (const name of files.keys()) if (/\.opf$/i.test(name)) { opfPath = name; break; }
  }
  if (!opfPath || !files.has(opfPath)) throw new Error("Could not find the EPUB's content manifest (.opf)");

  const opfDoc = new DOMParser().parseFromString(bytesToBinaryStringUtf8(files.get(opfPath)), "application/xml");
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const titleEl = opfDoc.querySelector("metadata > title, title");
  let title = titleEl ? (titleEl.textContent || "").trim() : "";
  if (!title) title = (filename || "Imported EPUB").replace(/\.epub$/i, "");

  const manifestItems = new Map();
  opfDoc.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifestItems.set(id, href);
  });
  const spineIds = [];
  opfDoc.querySelectorAll("spine > itemref").forEach((ref) => {
    const idref = ref.getAttribute("idref");
    if (idref) spineIds.push(idref);
  });

  const blocks = [];
  for (const idref of spineIds) {
    const href = manifestItems.get(idref);
    if (!href) continue;
    const path = resolveZipPath(baseDir, href);
    const bytes = files.get(path) || files.get(decodeURIComponent(path));
    if (!bytes) continue;
    const html = bytesToBinaryStringUtf8(bytes);
    const doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
    const root = (doc.body || doc.documentElement);
    if (!root || doc.querySelector("parsererror")) continue;
    blocks.push(...walkEpubContent(root));
  }

  if (!blocks.length) throw new Error("No readable text found in that EPUB");
  return { title, blocks };
}

// EPUB text files are UTF-8; decode properly (vs. the Latin1 mapping used for
// binary/ZIP bookkeeping) so accented characters survive.
function bytesToBinaryStringUtf8(bytes) {
  try { return new TextDecoder("utf-8").decode(bytes); }
  catch (e) { return bytesToBinaryString(bytes); }
}

/* =====================================================================
   PDF — minimal object/content-stream parser, text-only extraction
   ===================================================================== */

function pdfSkipWs(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === "%") { while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++; }
    else if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\0") i++;
    else break;
  }
  return i;
}
function pdfParseLiteralString(s, i) {
  let depth = 1, j = i + 1, out = "";
  const esc = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
  while (j < s.length && depth > 0) {
    const ch = s[j];
    if (ch === "\\") {
      const next = s[j + 1];
      if (next in esc) { out += esc[next]; j += 2; }
      else if (next >= "0" && next <= "7") {
        let oct = next; j += 2;
        for (let k = 0; k < 2 && s[j] >= "0" && s[j] <= "7"; k++) { oct += s[j]; j++; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (next === "\n") { j += 2; }
      else if (next === "\r") { j += (s[j + 2] === "\n") ? 3 : 2; }
      else { out += next; j += 2; }
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) { j++; break; } }
    out += ch;
    j++;
  }
  return { value: out, end: j };
}
function pdfParseName(s, i) {
  let j = i + 1, name = "";
  while (j < s.length && !/[\s/\[\]<>()%]/.test(s[j])) {
    if (s[j] === "#" && /^[0-9a-fA-F]{2}/.test(s.substr(j + 1, 2))) {
      name += String.fromCharCode(parseInt(s.substr(j + 1, 2), 16));
      j += 3;
    } else { name += s[j]; j++; }
  }
  return { value: name, end: j };
}
function pdfParseValue(s, i) {
  i = pdfSkipWs(s, i);
  const c = s[i];
  if (c === "<" && s[i + 1] === "<") {
    i += 2;
    const dict = {};
    while (true) {
      i = pdfSkipWs(s, i);
      if (s[i] === ">" && s[i + 1] === ">") { i += 2; break; }
      if (i >= s.length) break;
      if (s[i] !== "/") { i++; continue; }
      const nameRes = pdfParseName(s, i);
      const valRes = pdfParseValue(s, nameRes.end);
      dict[nameRes.value] = valRes.value;
      i = valRes.end;
    }
    const save = i;
    let k = pdfSkipWs(s, i);
    if (s.substr(k, 6) === "stream") {
      k += 6;
      if (s[k] === "\r") k++;
      if (s[k] === "\n") k++;
      return { value: { dict, streamStart: k }, end: k, isStream: true };
    }
    return { value: dict, end: save };
  }
  if (c === "<") {
    let j = i + 1, hex = "";
    while (j < s.length && s[j] !== ">") { if (/[0-9a-fA-F]/.test(s[j])) hex += s[j]; j++; }
    j++;
    if (hex.length % 2) hex += "0";
    let out = "";
    for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
    return { value: out, end: j };
  }
  if (c === "(") { const r = pdfParseLiteralString(s, i); return { value: r.value, end: r.end }; }
  if (c === "/") { const r = pdfParseName(s, i); return { value: r.value, end: r.end }; }
  if (c === "[") {
    let j = i + 1;
    const arr = [];
    while (true) {
      j = pdfSkipWs(s, j);
      if (s[j] === "]" || j >= s.length) { j++; break; }
      const r = pdfParseValue(s, j);
      arr.push(r.value);
      j = r.end;
    }
    return { value: arr, end: j };
  }
  if (c === "+" || c === "-" || c === "." || (c >= "0" && c <= "9")) {
    let j = i, num = "";
    while (j < s.length && /[+\-.\d]/.test(s[j])) { num += s[j]; j++; }
    const save = j;
    let k = pdfSkipWs(s, j);
    let num2 = "";
    while (k < s.length && s[k] >= "0" && s[k] <= "9") { num2 += s[k]; k++; }
    if (num2 && /^\d+$/.test(num)) {
      let m = pdfSkipWs(s, k);
      if (s[m] === "R" && /[\s/<>\[\]()%]|^$/.test(s[m + 1] || "")) {
        return { value: { ref: parseInt(num, 10), gen: parseInt(num2, 10) }, end: m + 1 };
      }
    }
    return { value: parseFloat(num), end: save };
  }
  let j = i, kw = "";
  while (j < s.length && /[A-Za-z]/.test(s[j])) { kw += s[j]; j++; }
  if (kw === "true") return { value: true, end: j };
  if (kw === "false") return { value: false, end: j };
  if (kw === "null") return { value: null, end: j };
  return { value: null, end: Math.max(i + 1, j) };
}

function pdfScanObjects(s) {
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = parseInt(m[1], 10);
    let endIdx = s.indexOf("endobj", re.lastIndex);
    if (endIdx === -1) endIdx = s.length;
    objects.set(num, { bodyStart: re.lastIndex, end: endIdx });
    re.lastIndex = endIdx + 6;
  }
  return objects;
}
function pdfResolveObject(s, objects, num, cache) {
  if (cache.has(num)) return cache.get(num);
  cache.set(num, null); // guard against cycles
  const o = objects.get(num);
  if (!o) return null;
  const parsed = pdfParseValue(s, o.bodyStart);
  let result;
  if (parsed.isStream) {
    const streamStart = parsed.value.streamStart;
    let endIdx = s.indexOf("endstream", streamStart);
    if (endIdx === -1 || endIdx > o.end + 64) endIdx = o.end;
    let raw = s.slice(streamStart, endIdx).replace(/[\r\n]+$/, "");
    result = { dict: parsed.value.dict, rawStream: raw };
  } else {
    result = parsed.value;
  }
  cache.set(num, result);
  return result;
}
function pdfDeref(s, objects, cache, val) {
  if (val && typeof val === "object" && !Array.isArray(val) && "ref" in val && !("dict" in val)) {
    return pdfResolveObject(s, objects, val.ref, cache);
  }
  return val;
}
async function pdfStreamData(s, objects, cache, obj) {
  if (!obj || obj.rawStream == null) return null;
  let bytes = binaryStringToBytes(obj.rawStream);
  let filter = pdfDeref(s, objects, cache, obj.dict && obj.dict.Filter);
  const filters = Array.isArray(filter) ? filter : (filter ? [filter] : []);
  for (const f of filters) {
    if (f === "FlateDecode" || f === "Fl") {
      const inflated = await inflate(bytes, "deflate");
      if (inflated) bytes = inflated;
    }
    // ASCII85Decode / LZWDecode / DCTDecode etc. are not supported — best effort only.
  }
  return bytes;
}

function pdfDecodeText(raw) {
  if (typeof raw !== "string") return "";
  if (raw.charCodeAt(0) === 0xFE && raw.charCodeAt(1) === 0xFF) {
    let out = "";
    for (let i = 2; i + 1 < raw.length; i += 2) out += String.fromCharCode((raw.charCodeAt(i) << 8) | raw.charCodeAt(i + 1));
    return out;
  }
  let out = "";
  for (let i = 0; i < raw.length; i++) out += winAnsiChar(raw.charCodeAt(i));
  return out;
}

function pdfHexToUnicode(hex) {
  if (hex.length % 2) hex = "0" + hex;
  let out = "";
  for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16) || 0);
  return out;
}
function pdfParseToUnicodeCMap(text) {
  const map = new Map();
  let m;
  const charRe = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = charRe.exec(text))) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let p;
    while ((p = pairRe.exec(m[1]))) map.set(parseInt(p[1], 16), pdfHexToUnicode(p[2]));
  }
  const rangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(text))) {
    const tripleRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let r;
    while ((r = tripleRe.exec(m[1]))) {
      const start = parseInt(r[1], 16), end = parseInt(r[2], 16);
      if (r[3] != null) {
        const dst = parseInt(r[3], 16);
        for (let c = start; c <= end && c - start < 65536; c++) map.set(c, String.fromCodePoint(dst + (c - start)));
      } else if (r[4] != null) {
        const items = [...r[4].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => pdfHexToUnicode(x[1]));
        for (let c = start, k = 0; c <= end && k < items.length; c++, k++) map.set(c, items[k]);
      }
    }
  }
  return map;
}

async function pdfFontMaps(s, objects, cache, resources) {
  const fontMaps = new Map();
  if (!resources || typeof resources !== "object") return fontMaps;
  const fontDict = pdfDeref(s, objects, cache, resources.Font);
  if (!fontDict || typeof fontDict !== "object") return fontMaps;
  for (const name of Object.keys(fontDict)) {
    const fontObj = pdfDeref(s, objects, cache, fontDict[name]);
    if (!fontObj || typeof fontObj !== "object") continue;
    const twoByte = fontObj.Subtype === "Type0";
    let map = null;
    const tu = pdfDeref(s, objects, cache, fontObj.ToUnicode);
    if (tu && tu.rawStream != null) {
      const data = await pdfStreamData(s, objects, cache, tu);
      if (data) map = pdfParseToUnicodeCMap(bytesToBinaryString(data));
    }
    fontMaps.set(name, { twoByte, map });
  }
  return fontMaps;
}

function pdfDecodeShow(raw, fontEntry) {
  if (!fontEntry) { let out = ""; for (let i = 0; i < raw.length; i++) out += winAnsiChar(raw.charCodeAt(i)); return out; }
  if (fontEntry.twoByte) {
    let out = "";
    for (let k = 0; k + 1 < raw.length; k += 2) {
      const code = (raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1);
      if (fontEntry.map) out += fontEntry.map.get(code) || "";
      else if (code >= 0x20) out += String.fromCharCode(code);
    }
    return out;
  }
  let out = "";
  for (let k = 0; k < raw.length; k++) {
    const code = raw.charCodeAt(k);
    out += (fontEntry.map && fontEntry.map.get(code)) || winAnsiChar(code);
  }
  return out;
}

/* ----- content stream tokenizer + interpreter ----- */
function pdfTokenizeContent(s) {
  const tokens = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "%") { while (i < n && s[i] !== "\n" && s[i] !== "\r") i++; continue; }
    if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "\f" || c === "\0") { i++; continue; }
    if (c === "(") { const r = pdfParseLiteralString(s, i); tokens.push({ type: "string", value: r.value }); i = r.end; continue; }
    if (c === "<") {
      if (s[i + 1] === "<") { tokens.push({ type: "op", value: "<<" }); i += 2; continue; }
      let j = i + 1, hex = "";
      while (j < n && s[j] !== ">") { if (/[0-9a-fA-F]/.test(s[j])) hex += s[j]; j++; }
      j++;
      if (hex.length % 2) hex += "0";
      let out = "";
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
      tokens.push({ type: "string", value: out });
      i = j;
      continue;
    }
    if (c === ">") { if (s[i + 1] === ">") { tokens.push({ type: "op", value: ">>" }); i += 2; continue; } i++; continue; }
    if (c === "[") { tokens.push({ type: "arrstart" }); i++; continue; }
    if (c === "]") { tokens.push({ type: "arrend" }); i++; continue; }
    if (c === "/") { const r = pdfParseName(s, i); tokens.push({ type: "name", value: r.value }); i = r.end; continue; }
    if (c === "+" || c === "-" || c === "." || (c >= "0" && c <= "9")) {
      let j = i, num = "";
      while (j < n && /[+\-.\d]/.test(s[j])) { num += s[j]; j++; }
      tokens.push({ type: "number", value: parseFloat(num) || 0 });
      i = j;
      continue;
    }
    let j = i, kw = "";
    while (j < n && /[A-Za-z'"*]/.test(s[j])) { kw += s[j]; j++; }
    if (kw) { tokens.push({ type: "op", value: kw }); i = j; continue; }
    i++;
  }
  return tokens;
}
function pdfParseOps(tokens) {
  const ops = [];
  let operands = [];
  let i = 0;
  function readArray() {
    const items = [];
    while (i < tokens.length && tokens[i].type !== "arrend") {
      const t = tokens[i++];
      if (t.type === "number" || t.type === "string") items.push(t.value);
    }
    i++;
    return items;
  }
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === "op") {
      if (t.value === "<<") {
        let depth = 1; i++;
        while (i < tokens.length && depth > 0) {
          if (tokens[i].type === "op" && tokens[i].value === "<<") depth++;
          else if (tokens[i].type === "op" && tokens[i].value === ">>") depth--;
          i++;
        }
        continue;
      }
      if (t.value === ">>") { i++; continue; }
      ops.push({ op: t.value, operands });
      operands = [];
      i++;
    } else if (t.type === "arrstart") {
      i++;
      operands.push({ array: readArray() });
    } else {
      operands.push(t);
      i++;
    }
  }
  return ops;
}
function opNum(operands, idx) { const t = operands[operands.length + idx]; return (t && t.type === "number") ? t.value : 0; }
function opName(operands, idx) { const t = operands[operands.length + idx]; return (t && t.type === "name") ? t.value : null; }
function opStr(operands, idx) { const t = operands[operands.length + idx]; return (t && t.type === "string") ? t.value : null; }
function pdfMatMul(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

function pdfExtractTextBlocks(contentStr, fontMaps) {
  const ops = pdfParseOps(pdfTokenizeContent(contentStr));
  const IDENT = [1, 0, 0, 1, 0, 0];
  let textMatrix = IDENT.slice();
  let lineMatrix = IDENT.slice();
  let leading = 0;
  let curFont = null;
  let fontSize = 1;
  const lines = [];
  let curParts = [];
  let curY = null;

  function flushLine() {
    if (curParts.length) {
      const text = curParts.join("").replace(/\s+/g, " ").trim();
      if (text) lines.push({ y: curY, text, size: fontSize });
      curParts = [];
    }
  }
  function showText(raw) {
    const entry = curFont ? fontMaps.get(curFont) : null;
    const decoded = pdfDecodeShow(raw, entry);
    if (!decoded) return;
    const y = textMatrix[5];
    if (curY === null || Math.abs(y - curY) > Math.max(1, fontSize * 0.3)) { flushLine(); curY = y; }
    curParts.push(decoded);
  }
  function move(tx, ty) {
    lineMatrix = pdfMatMul([1, 0, 0, 1, tx, ty], lineMatrix);
    textMatrix = lineMatrix.slice();
  }

  for (const { op, operands } of ops) {
    switch (op) {
      case "BT": textMatrix = IDENT.slice(); lineMatrix = IDENT.slice(); break;
      case "ET": flushLine(); break;
      case "Tf": fontSize = opNum(operands, -1); curFont = opName(operands, -2); break;
      case "Td": move(opNum(operands, -2), opNum(operands, -1)); break;
      case "TD": leading = -opNum(operands, -1); move(opNum(operands, -2), opNum(operands, -1)); break;
      case "Tm": {
        const m = operands.slice(-6).map((o) => (o && o.type === "number") ? o.value : 0);
        if (m.length === 6) { lineMatrix = m; textMatrix = m.slice(); }
        break;
      }
      case "T*": move(0, -leading); break;
      case "TL": leading = opNum(operands, -1); break;
      case "Tj": { const sv = opStr(operands, -1); if (sv != null) showText(sv); break; }
      case "'": { move(0, -leading); const sv = opStr(operands, -1); if (sv != null) showText(sv); break; }
      case '"': { move(0, -leading); const sv = opStr(operands, -1); if (sv != null) showText(sv); break; }
      case "TJ": {
        const arrOperand = operands[operands.length - 1];
        if (arrOperand && arrOperand.array) {
          for (const item of arrOperand.array) {
            if (typeof item === "string") showText(item);
            else if (typeof item === "number" && item < -120) curParts.push(" ");
          }
        }
        break;
      }
      default: break;
    }
  }
  flushLine();
  return pdfGroupParagraphs(lines);
}

function pdfGroupParagraphs(lines) {
  if (!lines.length) return [];
  const sorted = lines.slice().sort((a, b) => b.y - a.y);
  const sizes = sorted.map((l) => l.size).filter((x) => x > 0).sort((a, b) => a - b);
  const medSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(Math.abs(sorted[i - 1].y - sorted[i].y));
  gaps.sort((a, b) => a - b);
  const medGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] || 12 : 12;
  const threshold = Math.max(medGap * 1.6, medGap + 4);

  const blocks = [];
  let para = [];
  let paraMaxSize = 0;
  function flush() {
    if (!para.length) return;
    const text = para.join(" ").replace(/\s+/g, " ").trim();
    if (text) {
      const words = text.split(/\s+/);
      if (words.length <= 14 && paraMaxSize > medSize * 1.25) blocks.push(["h", text]);
      else if (words.length >= 3) blocks.push(["p", text]);
    }
    para = [];
    paraMaxSize = 0;
  }
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && Math.abs(sorted[i - 1].y - sorted[i].y) > threshold) flush();
    para.push(sorted[i].text);
    paraMaxSize = Math.max(paraMaxSize, sorted[i].size || 0);
  }
  flush();
  return blocks;
}

function pdfFindCatalog(s, objects, cache) {
  for (const num of objects.keys()) {
    const obj = pdfResolveObject(s, objects, num, cache);
    if (obj && typeof obj === "object" && obj.rawStream == null && obj.Type === "Catalog") return obj;
  }
  return null;
}
function pdfCollectPages(s, objects, cache, node, inherited, pages, seen) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  const resources = node.Resources || inherited;
  if (node.Type === "Pages" && Array.isArray(node.Kids)) {
    for (const ref of node.Kids) pdfCollectPages(s, objects, cache, pdfDeref(s, objects, cache, ref), resources, pages, seen);
  } else if (node.Type === "Page") {
    pages.push({ page: node, resources });
  }
}
async function pdfPageContent(s, objects, cache, contents) {
  contents = pdfDeref(s, objects, cache, contents);
  const list = Array.isArray(contents) ? contents : (contents ? [contents] : []);
  const parts = [];
  for (let item of list) {
    item = pdfDeref(s, objects, cache, item);
    if (item && item.rawStream != null) {
      const data = await pdfStreamData(s, objects, cache, item);
      if (data) parts.push(data);
    }
  }
  if (!parts.length) return null;
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function extractPdf(arrayBuffer, filename) {
  const s = bufToBinaryString(arrayBuffer);
  if (!/^%PDF-/.test(s) && s.indexOf("%PDF-") === -1) throw new Error("That doesn't look like a PDF file");
  const objects = pdfScanObjects(s);
  if (!objects.size) throw new Error("Could not parse the PDF's structure");
  const cache = new Map();

  let title = "";
  const infoMatch = s.match(/\/Info\s+(\d+)\s+\d+\s+R/);
  if (infoMatch) {
    const info = pdfResolveObject(s, objects, parseInt(infoMatch[1], 10), cache);
    if (info && typeof info === "object" && info.Title) title = pdfDecodeText(info.Title).trim();
  }
  if (!title) title = (filename || "Imported PDF").replace(/\.pdf$/i, "");

  let pages = [];
  const catalog = pdfFindCatalog(s, objects, cache);
  if (catalog) {
    const root = pdfDeref(s, objects, cache, catalog.Pages);
    pdfCollectPages(s, objects, cache, root, null, pages, new Set());
  }
  if (!pages.length) {
    for (const num of objects.keys()) {
      const obj = pdfResolveObject(s, objects, num, cache);
      if (obj && typeof obj === "object" && obj.rawStream == null && obj.Type === "Page") pages.push({ page: obj, resources: obj.Resources });
    }
  }
  if (!pages.length) throw new Error("No pages found in that PDF");

  const blocks = [];
  for (const { page, resources } of pages) {
    const res = pdfDeref(s, objects, cache, resources || page.Resources);
    const fontMaps = await pdfFontMaps(s, objects, cache, res);
    const contentBytes = await pdfPageContent(s, objects, cache, page.Contents);
    if (!contentBytes) continue;
    blocks.push(...pdfExtractTextBlocks(bytesToBinaryString(contentBytes), fontMaps));
  }

  if (!blocks.length) throw new Error("No extractable text found — the PDF may be a scan or image-only");
  return { title, blocks };
}

/* =====================================================================
   Entry point used by reader.js
   ===================================================================== */

async function importFileToArticle(file) {
  const name = file.name || "";
  const ext = (name.split(".").pop() || "").toLowerCase();
  const buf = await file.arrayBuffer();
  let result;
  if (ext === "epub") result = await extractEpub(buf, name);
  else if (ext === "pdf") result = await extractPdf(buf, name);
  else throw new Error("Unsupported file type — choose a .pdf or .epub file");

  return {
    title: result.title || name,
    synopsis: simpleSynopsis(result.blocks),
    blocks: result.blocks,
  };
}
