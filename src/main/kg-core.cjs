'use strict';
/**
 * kg-core.cjs — the Knowledge Graph core: ingest, index, and keyword-search a
 * local, file-backed enterprise knowledge store. PURE JS (only node:fs / path /
 * crypto) so it loads under BOTH the Electron main process AND a plain `node`
 * invocation from a spawned agent's shell — the same robustness reason
 * `slack-trigger.cjs` / `rudy-slack-reply.cjs` avoid the native better-sqlite3
 * module. See docs/design/knowledge-graph.md.
 *
 * Store layout (rooted at KG_ROOT, default <userData>/knowledge):
 *   index.jsonl          one JSON line per CHUNK (the search index)
 *   docs/<docId>/
 *     meta.json          artifact metadata
 *     original.<ext>     raw artifact, copied verbatim (images/PDFs/binaries)
 *     text.md            full extracted/normalized searchable text
 *
 * Consumed by: src/main/knowledge.ts (in-app), resources/kg.cjs (agent CLI),
 * and test/kg-core.test.cjs — one implementation, three callers.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// ─── Tunables ────────────────────────────────────────────────────────────────
const DEFAULT_CHUNK_SIZE = 1200; // chars per chunk (approx; broken on boundaries)
const DEFAULT_CHUNK_OVERLAP = 150; // chars of overlap between adjacent chunks
const MAX_INDEX_BYTES = 5 * 1024 * 1024; // per-doc text indexed before truncation
const DEFAULT_SEARCH_LIMIT = 8;
const SNIPPET_RADIUS = 160; // chars of context on each side of a match

// Tiny English stop-list — enough to stop the most common words from dominating
// term-frequency scores without pulling in an NLP dependency.
const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have how in is it its of on or '
   + 'that the their this to was were what when where which who will with your '
   + 'you we our us they them he she his her i me my do does did not can could '
   + 'would should about into over than then there here so if no yes').split(' ')
);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic']);
const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'rb',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'sql']);
const SHEET_EXTS = new Set(['csv', 'tsv']);
const TEXT_EXTS = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'rst', 'json', 'jsonl',
  'yaml', 'yml', 'toml', 'ini', 'log', 'html', 'htm', 'css', 'xml', 'env']);

const MIME_BY_EXT = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json',
  csv: 'text/csv', tsv: 'text/tab-separated-values', yaml: 'application/yaml', yml: 'application/yaml',
  html: 'text/html', htm: 'text/html', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml'
};

// ─── Small helpers ───────────────────────────────────────────────────────────
function genId() { return crypto.randomBytes(8).toString('hex'); }
function extOf(p) { return path.extname(String(p || '')).replace(/^\./, '').toLowerCase(); }
function mimeFor(p) { return MIME_BY_EXT[extOf(p)] || 'application/octet-stream'; }
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }

function clampLimit(n, fallback) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(100, v);
}

/** Map a file (by extension) to a coarse modality bucket. */
function detectModality(filePath) {
  const e = extOf(filePath);
  if (IMAGE_EXTS.has(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (SHEET_EXTS.has(e)) return 'sheet';
  if (CODE_EXTS.has(e)) return 'code';
  if (TEXT_EXTS.has(e)) return 'text';
  return 'text'; // unknown → best-effort treat as text
}

/** Lowercase alphanumeric tokens, stop-words and 1-char tokens dropped. */
function tokenize(s) {
  const m = String(s || '').toLowerCase().match(/[a-z0-9]+/g);
  if (!m) return [];
  return m.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** First markdown heading or first non-empty line, trimmed and length-capped. */
function deriveTitle(text) {
  const lines = String(text || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.replace(/^#+\s*/, '').trim();
    return h.length > 80 ? h.slice(0, 80) + '…' : h;
  }
  return '';
}

/**
 * Split text into ~size-char chunks, preferring to break on paragraph / line /
 * word boundaries, with `overlap` chars carried into the next chunk so a passage
 * straddling a boundary is still findable. Deterministic; always terminates.
 */
function chunkText(text, opts = {}) {
  const size = Math.max(200, opts.size ?? DEFAULT_CHUNK_SIZE);
  const overlap = Math.min(opts.overlap ?? DEFAULT_CHUNK_OVERLAP, Math.floor(size / 2));
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  if (t.length <= size) return [t];
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    let end = Math.min(i + size, t.length);
    if (end < t.length) {
      const window = t.slice(i, end);
      const br = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
      if (br > size * 0.6) end = i + br; // only break late, never near the start
    }
    const piece = t.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

/**
 * Score one index record against the query. Term-frequency (log-damped) over
 * distinct query terms, a title-match boost, a distinct-term coverage bonus, and
 * an exact-phrase bonus. Returns 0 when no query term appears.
 */
function scoreChunk(rec, queryTerms, queryRaw) {
  if (!queryTerms.length) return 0;
  const text = String(rec.text || '');
  const titleLc = String(rec.title || '').toLowerCase();
  const tf = Object.create(null);
  for (const tok of tokenize(text)) tf[tok] = (tf[tok] || 0) + 1;
  let score = 0;
  let matched = 0;
  for (const term of queryTerms) {
    const c = tf[term] || 0;
    if (c > 0) { matched++; score += 1 + Math.log(1 + c); }
    if (titleLc.includes(term)) score += 2;
  }
  if (matched === 0) return 0;
  score += matched * 0.5; // reward breadth of distinct matches
  const q = String(queryRaw || '').trim().toLowerCase();
  if (q.length >= 3 && text.toLowerCase().includes(q)) score += 5; // exact phrase
  return score;
}

/** A short snippet of `text` centred on the first query-term hit. */
function makeSnippet(text, queryTerms) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const lc = t.toLowerCase();
  let at = -1;
  for (const term of queryTerms) {
    const idx = lc.indexOf(term);
    if (idx !== -1 && (at === -1 || idx < at)) at = idx;
  }
  if (at === -1) return t.length > SNIPPET_RADIUS * 2 ? t.slice(0, SNIPPET_RADIUS * 2) + '…' : t;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(t.length, at + SNIPPET_RADIUS);
  return (start > 0 ? '…' : '') + t.slice(start, end).trim() + (end < t.length ? '…' : '');
}

// ─── Extraction (per modality) ───────────────────────────────────────────────
/**
 * Turn an artifact into searchable text. Returns { text, title, extractor, mime }.
 * v1 covers text-family (verbatim) and images (metadata-level); PDF is a
 * best-effort poppler hook; everything else is treated as text.
 */
function extractText(input) {
  const { srcPath, inlineText, modality, title, caption, tags, source } = input;

  if (typeof inlineText === 'string' && inlineText.length) {
    return { text: inlineText, title: title || deriveTitle(inlineText) || source, extractor: 'inline@1', mime: 'text/plain' };
  }

  if (modality === 'image') {
    // No OCR in v1: the searchable surface is the user-supplied metadata + filename.
    // The original bytes are retained (by ingest) for a future vision/OCR pass.
    const parts = [title, caption, ...(tags || []), source].filter(Boolean);
    return { text: parts.join('\n'), title: title || source, extractor: 'image-meta@1', mime: mimeFor(srcPath) };
  }

  if (modality === 'pdf') {
    const out = tryPdfToText(srcPath);
    if (out != null && out.trim()) {
      return { text: out, title: title || deriveTitle(out) || source, extractor: 'pdftotext@1', mime: 'application/pdf' };
    }
    // poppler absent → store metadata now; a later pass can enrich from the original.
    const parts = [title, caption, ...(tags || []), source].filter(Boolean);
    return { text: parts.join('\n'), title: title || source, extractor: 'pdf-pending@1', mime: 'application/pdf' };
  }

  // text / code / sheet — read UTF-8 verbatim.
  if (srcPath && fs.existsSync(srcPath)) {
    let raw = '';
    try { raw = fs.readFileSync(srcPath, 'utf8'); } catch { raw = ''; }
    return { text: raw, title: title || deriveTitle(raw) || source, extractor: 'text-utf8@1', mime: mimeFor(srcPath) };
  }

  return { text: inlineText || '', title: title || source || 'untitled', extractor: 'empty@1', mime: 'text/plain' };
}

/** Best-effort PDF → text via poppler's `pdftotext` if it's on PATH; else null. */
function tryPdfToText(srcPath) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  try {
    const res = spawnSync('pdftotext', ['-q', srcPath, '-'], { encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024 });
    if (res.status === 0 && typeof res.stdout === 'string') return res.stdout;
  } catch { /* pdftotext not installed */ }
  return null;
}

// ─── Store operations ────────────────────────────────────────────────────────
/**
 * Ingest one artifact into the store at `kgRoot`.
 * input: { srcPath?, inlineText?/text?, title?, tags?, caption?, modality?, source?, id? }
 * Returns { docId, chunkCount, meta }.
 */
function ingest(kgRoot, input = {}) {
  ensureDir(kgRoot);
  ensureDir(path.join(kgRoot, 'docs'));

  const docId = input.id || genId();
  const docDir = path.join(kgRoot, 'docs', docId);
  ensureDir(docDir);

  const srcPath = input.srcPath || null;
  const inlineText = input.text != null ? input.text : input.inlineText;
  const source = input.source || (srcPath ? path.basename(srcPath) : (input.title || 'untitled'));
  const modality = input.modality || (srcPath ? detectModality(srcPath) : 'text');
  const origExt = srcPath ? (extOf(srcPath) || 'bin') : 'txt';
  const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];

  // Copy the raw artifact verbatim (lossless record for future re-extraction).
  let bytes = 0;
  if (srcPath && fs.existsSync(srcPath)) {
    try {
      bytes = fs.statSync(srcPath).size;
      fs.copyFileSync(srcPath, path.join(docDir, 'original.' + origExt));
    } catch { /* best-effort copy */ }
  }

  const ex = extractText({ srcPath, inlineText, modality, title: input.title, caption: input.caption, tags, source });
  const fullText = String(ex.text || '');
  fs.writeFileSync(path.join(docDir, 'text.md'), fullText, 'utf8');

  let indexText = fullText;
  let truncated = false;
  if (indexText.length > MAX_INDEX_BYTES) { indexText = indexText.slice(0, MAX_INDEX_BYTES); truncated = true; }

  const title = input.title || ex.title || source;
  let chunks = chunkText(indexText);
  if (chunks.length === 0) chunks = [String(title)]; // images/empties: index the title so it's findable

  const lines = chunks.map((c, i) => JSON.stringify({ docId, title, source, modality, chunkIdx: i, text: c }));
  fs.appendFileSync(path.join(kgRoot, 'index.jsonl'), lines.join('\n') + '\n', 'utf8');

  const meta = {
    id: docId, title, source, modality, mime: ex.mime || null, origExt,
    bytes, tags, caption: input.caption || null, chunkCount: chunks.length,
    addedAt: nowIso(), extractor: ex.extractor, truncated
  };
  fs.writeFileSync(path.join(docDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { docId, chunkCount: chunks.length, meta };
}

/** Keyword-search the index. Returns ranked { docId, title, source, modality, chunkIdx, score, snippet }. */
function search(kgRoot, query, opts = {}) {
  const limit = clampLimit(opts.limit, DEFAULT_SEARCH_LIMIT);
  const queryTerms = tokenize(query);
  if (!queryTerms.length) return [];
  const idxPath = path.join(kgRoot, 'index.jsonl');
  if (!fs.existsSync(idxPath)) return [];

  const scored = [];
  const lines = fs.readFileSync(idxPath, 'utf8').split('\n');
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    const sc = scoreChunk(rec, queryTerms, query);
    if (sc > 0) scored.push({ rec, score: sc });
  }
  scored.sort((a, b) =>
    b.score - a.score
    || String(a.rec.docId).localeCompare(String(b.rec.docId))
    || (a.rec.chunkIdx - b.rec.chunkIdx));

  return scored.slice(0, limit).map(({ rec, score }) => ({
    docId: rec.docId, title: rec.title, source: rec.source, modality: rec.modality,
    chunkIdx: rec.chunkIdx, score: Math.round(score * 1000) / 1000,
    snippet: makeSnippet(rec.text, queryTerms)
  }));
}

/** All artifacts' metadata, newest first. */
function list(kgRoot) {
  const docsDir = path.join(kgRoot, 'docs');
  if (!fs.existsSync(docsDir)) return [];
  const out = [];
  for (const id of fs.readdirSync(docsDir)) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(docsDir, id, 'meta.json'), 'utf8'))); } catch { /* skip */ }
  }
  return out.sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
}

/** Full record for one artifact: { meta, text } or null. */
function getDoc(kgRoot, docId) {
  const docDir = path.join(kgRoot, 'docs', String(docId || ''));
  if (!docId || !fs.existsSync(docDir)) return null;
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(path.join(docDir, 'meta.json'), 'utf8')); } catch { /* none */ }
  if (!meta) return null;
  let text = '';
  try { text = fs.readFileSync(path.join(docDir, 'text.md'), 'utf8'); } catch { /* none */ }
  return { meta, text };
}

/** Delete one artifact's folder and drop its lines from the index. */
function removeDoc(kgRoot, docId) {
  const docDir = path.join(kgRoot, 'docs', String(docId || ''));
  if (!docId || !fs.existsSync(docDir)) return false;
  fs.rmSync(docDir, { recursive: true, force: true });
  const idxPath = path.join(kgRoot, 'index.jsonl');
  if (fs.existsSync(idxPath)) {
    const kept = fs.readFileSync(idxPath, 'utf8').split('\n').filter((line) => {
      const s = line.trim();
      if (!s) return false;
      try { return JSON.parse(s).docId !== docId; } catch { return false; }
    });
    fs.writeFileSync(idxPath, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
  }
  return true;
}

/** Corpus counts for the UI/CLI status line. */
function stats(kgRoot) {
  const docs = list(kgRoot);
  let chunkCount = 0;
  const byModality = Object.create(null);
  for (const d of docs) {
    chunkCount += d.chunkCount || 0;
    byModality[d.modality] = (byModality[d.modality] || 0) + 1;
  }
  return { docCount: docs.length, chunkCount, byModality };
}

module.exports = {
  ingest, search, list, getDoc, removeDoc, stats,
  detectModality, extractText, chunkText, tokenize, scoreChunk, makeSnippet, deriveTitle,
  DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP
};
