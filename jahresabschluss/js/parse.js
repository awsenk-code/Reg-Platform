// Turns positioned text tokens (from pdf.js or OCR) into HGB position values. Pure logic, no DOM, unit-tested in Node.
//
// Pipeline: tokens → rows (same y) → segments (label + amounts) → statement pages → column roles
// (business year / prior year, inner / outer column) → position matching in printed order → totals and signs.

import { POSITIONS, BY_ID, CHILDREN, ancestors } from './schema.js';

// --- Amounts ---

const DASH = /^[-–—−]$/;
const UNIT = /^(t?eur|t€|€|euro|teuro|tsd\.?|mio\.?)$/i;

// Parses a printed amount ("1.234.567,89", "-1.234", "(1.234)", "1.234-", "–") into a number, or null.
export function parseAmount(raw) {
  let t = String(raw).trim().replace(/€/g, '').replace(/\b(T?EUR|TEUR|Euro)\b/gi, '').trim();
  if (!t) return null;
  if (DASH.test(t) || t === './.' || t === '-,--' || t === '–,––') return 0;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  if (/^[-–—−]/.test(t)) { neg = true; t = t.slice(1).trim(); }
  if (/[-–—−]$/.test(t)) { neg = true; t = t.slice(0, -1).trim(); }
  t = t.replace(/(?<=\d)[\s  '](?=\d{3}\b)/g, '');
  let v = null;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+(,\d+)?$/.test(t)) v = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(t) || /^\d{1,3}(,\d{3}){2,}$/.test(t)) v = Number(t.replace(/,/g, ''));
  if (v === null || !Number.isFinite(v)) return null;
  return neg && v !== 0 ? -v : v;
}

// OCR noise around amounts: stray symbols, "l"/"I"/"O" for digits, a spurious leading "1" in front of a
// thousands group ("1418.254,78"). Returns the cleaned string and alternative readings for validation.
export function cleanAmountToken(str) {
  let t = String(str).replace(/^[©®|!'"‚„`´°*~_]+|[|!'"`´°*~_]+$/g, '');
  if (/\d/.test(t) && /^[\d.,lIO()\-–]+$/.test(t)) t = t.replace(/[lI]/g, '1').replace(/O/g, '0');
  const alts = [];
  if (parseAmount(t) === null && /^[1l|]\d/.test(t) && parseAmount(t.slice(1)) !== null) t = t.slice(1);
  else if (/^1\d{1,2}\./.test(t) && parseAmount(t.slice(1)) !== null) alts.push(parseAmount(t.slice(1)));
  return { str: t, alts };
}

export function formatAmount(v, decimals = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '';
  return v.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// --- Labels ---

const ENUM = /^\s*(?:\(?[A-Ha-h]\)|\(?[a-h]{2}\)|[A-H]\.|[IVX]{1,4}\.|\d{1,2}\.|\d{1,2}\)|[-–—•·])(?=\s|$|[A-Za-zÄÖÜäöü])\s*/;

export function hasEnumerator(raw) {
  return ENUM.test(raw) && !/^\s*[-–—•·]/.test(raw);
}

// Lower case, umlauts transliterated, enumerators and parentheticals removed, punctuation stripped.
export function normalizeLabel(raw) {
  let s = String(raw);
  for (let i = 0; i < 4 && ENUM.test(s); i++) s = s.replace(ENUM, '');
  s = s.replace(/\([^)]*\)/g, ' ');
  s = s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const davon = s.search(/(^| )(davon|thereof)( |$)/);
  if (davon > 0) s = s.slice(0, davon).trim();
  return s;
}

// Positions whose patterns match the normalised label (several when the label is ambiguous, e.g. "geleistete Anzahlungen").
export function matchCandidates(norm) {
  if (!norm || /^(davon|thereof|vorjahr|im vorjahr|vj)\b/.test(norm)) return [];
  const variants = [norm];
  const stripped = norm.replace(/^(summe|zwischensumme|gesamt|insgesamt|total)\s+/, '');
  if (stripped !== norm) variants.push(stripped);
  return POSITIONS.filter((p) => variants.some((v) => p.patterns.some((re) => re.test(v))));
}

function headingStatement(norm) {
  if (norm.length > 60) return null;
  if (/gewinn und verlustrechnung|^guv\b|gewinn und verlust rechnung/.test(norm)) return 'guv';
  if (/^passiva\b|^passivseite\b/.test(norm)) return 'passiva';
  if (/^aktiva\b|^aktivseite\b/.test(norm)) return 'aktiva';
  return null;
}

// --- Tokens → rows → segments ---

// pdf.js returns text runs; split them into words with an x position estimated per character.
export function splitItem(str, x0, width, top, bottom) {
  const out = [];
  const perChar = str.length ? width / str.length : 0;
  const re = /\S+/g;
  let m;
  while ((m = re.exec(str))) {
    out.push({ str: m[0], x0: x0 + m.index * perChar, x1: x0 + (m.index + m[0].length) * perChar, top, bottom });
  }
  return out;
}

export function groupRows(tokens) {
  const toks = tokens.filter((t) => t.str && t.str.trim()).map((t) => ({ ...t, cy: (t.top + t.bottom) / 2, h: Math.max(1, t.bottom - t.top) }));
  if (!toks.length) return [];
  const hs = toks.map((t) => t.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)];
  toks.sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const rows = [];
  for (const t of toks) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(t.cy - row.cy) <= 0.45 * Math.max(medH, Math.min(t.h, row.h))) {
      row.tokens.push(t);
      row.cy = (row.cy * (row.tokens.length - 1) + t.cy) / row.tokens.length;
    } else {
      rows.push({ cy: t.cy, h: t.h, tokens: [t] });
    }
  }
  for (const r of rows) r.tokens.sort((a, b) => a.x0 - b.x0);
  return rows.map((r) => ({ y: r.cy, h: medH, tokens: r.tokens }));
}

function tokenType(str) {
  if (UNIT.test(str)) return 'unit';
  const c = cleanAmountToken(str);
  if (/\d/.test(str) && c.str !== str && parseAmount(c.str) !== null) return 'num';
  if (/^\(\d{1,2}\)$/.test(str)) return 'note';
  if (parseAmount(str) !== null) return 'num';
  return 'text';
}

// A row becomes one or more segments: label text followed by amounts. Text after amounts starts a new segment
// (two-column balance sheets print Aktiva and Passiva side by side).
export function rowSegments(row) {
  const toks = row.tokens.map((t) => {
    const type = tokenType(t.str);
    if (type !== 'num') return { ...t, type };
    const c = cleanAmountToken(t.str);
    return { ...t, str: c.str, alts: c.alts, type };
  });
  // Join amounts that OCR or PDF split at thousands separators ("1 234 567,89") and a detached minus ("- 1.234").
  const merged = [];
  for (const t of toks) {
    const prev = merged[merged.length - 1];
    const gap = prev ? t.x0 - prev.x1 : Infinity;
    if (prev && prev.type === 'num' && t.type === 'num' && gap < 0.8 * row.h
        && /^\d{3}(,\d+)?-?$/.test(t.str) && /^[-(]?\d{1,3}( \d{3})*$/.test(prev.str)) {
      prev.str = `${prev.str} ${t.str}`; prev.x1 = t.x1; continue;
    }
    if (prev && prev.type === 'num' && DASH.test(prev.str) && t.type === 'num' && !DASH.test(t.str) && gap < 0.6 * row.h) {
      prev.str = `-${t.str}`; prev.x1 = t.x1; continue;
    }
    merged.push({ ...t });
  }
  const segs = [];
  let cur = null;
  merged.forEach((t, i) => {
    const next = merged[i + 1];
    if (t.type === 'unit' || t.type === 'note') return;
    if (t.type === 'num' && DASH.test(t.str) && next && next.type === 'text') return; // bullet "- davon …"
    if (t.type === 'text') {
      const prevText = cur && cur.text[cur.text.length - 1];
      const farGap = prevText && !cur.nums.length && t.x0 - prevText.x1 > 8 * row.h;
      if (!cur || cur.nums.length || farGap) { cur = { text: [], nums: [] }; segs.push(cur); }
      cur.text.push(t);
    } else {
      if (!cur) { cur = { text: [], nums: [] }; segs.push(cur); }
      cur.nums.push({ value: parseAmount(t.str), raw: t.str, alts: t.alts || [], x0: t.x0, x1: t.x1 });
    }
  });
  return segs.map((s) => {
    const label = s.text.map((t) => t.str).join(' ');
    return {
      label,
      x0: s.text.length ? s.text[0].x0 : s.nums[0].x0,
      nums: s.nums,
      raw: [label, ...s.nums.map((n) => n.raw)].join(' ').trim(),
    };
  });
}

// --- Columns ---

// Clusters the right edges of amounts and assigns roles: gj (business year), vj (prior year), each optionally
// split into an inner column (sub-positions) and an outer column (group totals).
export function columnRoles(lines, pageWidth, hasVJ) {
  const xs = [];
  for (const l of lines) {
    if (!l.nums.length || l.nums.length > 4) continue;
    if (l.label.trim() && !matchCandidates(normalizeLabel(l.label)).length) continue; // titles with years, notes text
    for (const n of l.nums) xs.push(n);
  }
  xs.sort((a, b) => a.x1 - b.x1);
  const tol = Math.max(6, 0.025 * pageWidth);
  let clusters = [];
  for (const n of xs) {
    const c = clusters[clusters.length - 1];
    if (c && n.x1 - c.mean <= tol) { c.items.push(n); c.mean = c.items.reduce((s, i) => s + i.x1, 0) / c.items.length; } else clusters.push({ mean: n.x1, items: [n] });
  }
  // Note references ("3", "(4)") form a column of small integers left of the amounts.
  const isNote = (c) => c.items.every((i) => /^\(?\d{1,2}\)?$/.test(i.raw));
  const notes = clusters.slice(0, -1).filter(isNote);
  clusters = clusters.filter((c) => !notes.includes(c));
  const strong = clusters.filter((c) => c.items.length >= 2);
  const cols = (strong.length ? strong : clusters).map((c) => c.mean);
  let roles;
  const n = cols.length;
  if (hasVJ) roles = n >= 4 ? ['gjI', 'gjO', 'vjI', 'vjO'] : n === 3 ? ['gjI', 'gjO', 'vj'] : n === 2 ? ['gj', 'vj'] : ['gj'];
  else roles = n >= 2 ? ['gjI', 'gjO'] : ['gj'];
  const used = cols.slice(-roles.length);
  return (x1) => {
    if (notes.some((c) => Math.abs(c.mean - x1) <= tol)) return 'note';
    let best = 0;
    for (let i = 1; i < used.length; i++) if (Math.abs(used[i] - x1) < Math.abs(used[best] - x1)) best = i;
    return roles[best] || 'gj';
  };
}

// --- Document-level detection ---

const LEGAL_FORM = /\b(gmbh|ag|se|kg|kgaa|ug|mbh|ohg|e\.\s?v\.|eg|gbr|partg|stiftung)\b/i;
const MONTHS = 'januar|februar|maerz|märz|april|mai|juni|juli|august|september|oktober|november|dezember';

export function detectCompany(pages, fallback = '') {
  for (const page of pages.slice(0, 2)) {
    for (const row of groupRows(page.tokens).slice(0, 25)) {
      const text = row.tokens.map((t) => t.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length > 120 || !LEGAL_FORM.test(text)) continue;
      const cleaned = text
        .replace(/^.*?\b(der|des|für die|fuer die)\s+(?=\S)/i, (m) => (/(jahresabschluss|bilanz|bericht|abschluss|offenlegung)/i.test(m) ? '' : m))
        .replace(/\s*[,–-]\s*(sitz|mit sitz|registergericht|amtsgericht|hrb).*$/i, '')
        .trim();
      const m = cleaned.match(new RegExp(`^(.*${LEGAL_FORM.source}\\.?)\\s*[,(–-]`, 'i'));
      const name = (m ? m[1] : cleaned).trim();
      if (name.length >= 3) return name;
    }
  }
  return fallback.replace(/\.pdf$/i, '');
}

export function detectYears(texts) {
  const years = [];
  const re = new RegExp(`\\b(\\d{1,2})\\.\\s?(?:\\d{1,2}\\.|(?:${MONTHS}))\\s?((?:19|20)\\d{2})\\b`, 'gi');
  for (const t of texts) {
    let m;
    while ((m = re.exec(t))) years.push(Number(m[2]));
    for (const y of t.match(/\b(?:19|20)\d{2}\b/g) || []) years.push(Number(y));
  }
  const now = new Date().getFullYear() + 1;
  return [...new Set(years.filter((y) => y >= 1990 && y <= now))].sort((a, b) => b - a);
}

export function detectScale(texts) {
  const all = texts.join(' ');
  if (/\b(mio\.?\s?(eur|€)|millionen euro|in mio)\b/i.test(all)) return 1e6;
  if (/(\bteur\b|\bt€|\btsd\.?\s?(eur|€)|tausend euro|in tsd)/i.test(all)) return 1000;
  return 1;
}

// --- Extraction ---

// pages: [{ width, height, tokens: [{ str, x0, x1, top, bottom }], ocr? }]
export function extractDocument(pages, { fileName = '' } = {}) {
  // Pass 1: rows and segments per page, statement-page score.
  const pageData = pages.map((page, pi) => {
    const rows = groupRows(page.tokens);
    const segs = [];
    for (const row of rows) for (const s of rowSegments(row)) segs.push({ ...s, y: row.y, page: pi });
    let score = 0;
    for (const s of segs) if (s.nums.length && s.nums.length <= 4 && matchCandidates(normalizeLabel(s.label)).length) score++;
    const text = rows.map((r) => r.tokens.map((t) => t.str).join(' ')).join('\n');
    return { page, rows, segs, score, text };
  });
  const maxScore = Math.max(0, ...pageData.map((p) => p.score));
  const statementPages = pageData.map((p, i) => (p.score > 0 && p.score >= Math.max(3, 0.25 * maxScore) ? i : -1)).filter((i) => i >= 0);
  if (!statementPages.length && maxScore > 0) statementPages.push(pageData.findIndex((p) => p.score === maxScore));
  const stmtTexts = statementPages.map((i) => pageData[i].text);

  const scale = detectScale(stmtTexts);
  const years = detectYears(stmtTexts.length ? stmtTexts : [pageData[0]?.text || '']);
  const lower = stmtTexts.join(' ').toLowerCase();
  // Prior-year column: named in the header, two years printed, or most position lines carry two or more amounts.
  const matchedLines = statementPages.flatMap((i) => pageData[i].segs).filter((sg) => sg.nums.length && sg.nums.length <= 4 && matchCandidates(normalizeLabel(sg.label)).length);
  const multi = matchedLines.filter((sg) => sg.nums.length >= 2).length;
  const hasVJ = /vorjahr|vorjahres|vj\b|\bprior year/.test(lower) || years.length >= 2 || (matchedLines.length > 0 && multi / matchedLines.length >= 0.5);
  const company = detectCompany(pages, fileName);

  const values = {};
  const unmatched = [];
  const totals = [];
  const state = { stmt: null, last: { aktiva: -1, passiva: -1, guv: -1 } };
  let decimals = false;

  const setValue = (id, col, value, src) => {
    values[id] ||= {};
    if (values[id][col] === undefined) values[id][col] = { v: value, status: 'pdf', src };
  };

  for (const pi of statementPages) {
    const { page, segs } = pageData[pi];
    const W = page.width || 600;
    // Side-by-side Aktiva/Passiva: a second labelled segment starting right of ~40 % of the page width.
    const rightStarts = [];
    const bySide = [[], []];
    const rowsSeen = new Map();
    for (const s of segs) {
      const k = s.y;
      const idx = rowsSeen.get(k) || 0;
      rowsSeen.set(k, idx + 1);
      if (idx > 0 && s.label && s.x0 > 0.4 * W) rightStarts.push(s.x0);
    }
    const twoSided = rightStarts.length >= 3;
    const splitX = twoSided ? Math.min(...rightStarts) - 2 : Infinity;
    for (const s of segs) bySide[s.x0 >= splitX ? 1 : 0].push(s);

    for (const lines of bySide) {
      if (!lines.length) continue;
      const roleOf = columnRoles(lines, twoSided ? W / 2 : W, hasVJ);
      let pending = '';
      let lastId = null;
      for (const line of lines) {
        if (line.nums.length > 4) { pending = ''; continue; }
        const norm = normalizeLabel(line.label);
        if (!line.nums.length) {
          const h = headingStatement(norm);
          if (h) { state.stmt = h; pending = ''; continue; }
          if (!line.label) continue;
          pending = hasEnumerator(line.label) || !pending ? line.label : `${pending} ${line.label}`;
          if (pending.length > 300) pending = line.label;
          continue;
        }
        for (const n of line.nums) if (/,\d{2}\)?-?$/.test(n.raw)) decimals = true;

        let label = line.label;
        let cands = matchCandidates(norm);
        if (pending && !hasEnumerator(line.label)) {
          const combined = `${pending} ${line.label}`.trim();
          const c2 = matchCandidates(normalizeLabel(combined));
          if (!cands.length || (c2.length && !line.label)) { cands = c2; label = combined; }
        }
        pending = '';

        const cols = {};
        const alts = {};
        for (const n of line.nums) {
          const role = roleOf(n.x1);
          if (cols[role] === undefined) { cols[role] = n.value; alts[role] = n.alts; }
        }
        const gj = cols.gjI ?? cols.gj ?? cols.gjO;
        const vj = cols.vjI ?? cols.vj ?? cols.vjO;
        const src = { page: pi + 1, text: line.raw, ocr: !!page.ocr };

        if (!label.trim() || !cands.length) {
          if (!label.trim() && lastId) {
            const rg = ['gjO', 'gj', 'gjI'].find((r) => cols[r] !== undefined);
            const rv = ['vjO', 'vj', 'vjI'].find((r) => cols[r] !== undefined);
            if (rg) totals.push({ after: lastId, col: 'gj', value: cols[rg], alts: alts[rg], src });
            if (rv) totals.push({ after: lastId, col: 'vj', value: cols[rv], alts: alts[rv], src });
          } else if (label.trim() && !/^(davon|thereof)\b/.test(norm) && line.nums.some((n) => !/^(19|20)\d{2}$/.test(n.raw))) unmatched.push(src);
          continue;
        }

        const pos = choose(cands, state, values);
        if (!pos) continue;
        state.stmt = pos.statement;
        state.last[pos.statement] = Math.max(state.last[pos.statement], pos.order);
        lastId = pos.id;
        const flip = pos.negativeIf && pos.negativeIf.test(normalizeLabel(label));
        const signed = (v) => (v !== undefined && flip && v > 0 ? -v : v);
        if (gj !== undefined) setValue(pos.id, 'gj', signed(gj), src);
        if (vj !== undefined) setValue(pos.id, 'vj', signed(vj), src);
        if (cols.gjI !== undefined && cols.gjO !== undefined) totals.push({ after: pos.id, col: 'gj', value: cols.gjO, alts: alts.gjO, src });
        if (cols.vjI !== undefined && cols.vjO !== undefined) totals.push({ after: pos.id, col: 'vj', value: cols.vjO, alts: alts.vjO, src });
      }
    }
  }

  // Outer-column and unlabelled sum lines belong to the closest enclosing group whose children add up to them.
  const tolFor = (id) => (decimals ? 0.02 : 1 + 0.5 * (CHILDREN[id]?.length || 1));
  for (const t of totals) {
    const chain = ancestors(t.after);
    const open = chain.filter((a) => values[a]?.[t.col] === undefined);
    let value = t.value;
    const exact = open.find((a) => {
      const s = childSum(values, a, t.col);
      if (s === null) return false;
      const hit = [t.value, ...(t.alts || [])].find((v) => Math.abs(s - v) <= tolFor(a));
      if (hit !== undefined) value = hit;
      return hit !== undefined;
    });
    const target = exact || open[0];
    if (target) setValue(target, t.col, value, { ...t.src, uncertain: !exact });
  }

  // Income statement: expenses are stored as positive amounts. Documents that print expenses with a minus sign get flipped.
  const expenses = POSITIONS.filter((p) => p.statement === 'guv' && p.sign === -1);
  let neg = 0;
  let all = 0;
  for (const p of expenses) for (const col of ['gj', 'vj']) {
    const v = values[p.id]?.[col]?.v;
    if (v) { all++; if (v < 0) neg++; }
  }
  const expensesPrintedNegative = all > 0 && neg / all > 0.5;
  if (expensesPrintedNegative) for (const p of expenses) for (const col of ['gj', 'vj']) if (values[p.id]?.[col]) values[p.id][col].v = -values[p.id][col].v;

  for (const id of Object.keys(values)) for (const col of ['gj', 'vj']) {
    const cell = values[id][col];
    if (cell) cell.v = Math.round(cell.v * scale * 100) / 100;
  }

  return {
    fileName,
    company,
    year: years[0] || null,
    priorYear: years[0] ? years[0] - 1 : null,
    scale,
    hasVJ,
    pageCount: pages.length,
    ocrPages: pages.map((p, i) => (p.ocr ? i + 1 : 0)).filter(Boolean),
    statementPages: statementPages.map((i) => i + 1),
    expensesPrintedNegative,
    values,
    unmatched,
  };
}

// Follows the printed order: prefer the next position in the current statement, then the start of another statement,
// then any still-empty candidate.
function choose(cands, state, values) {
  const empty = (p) => !values[p.id] || (values[p.id].gj === undefined && values[p.id].vj === undefined);
  const forward = (p) => p.order > state.last[p.statement];
  const byOrder = (a, b) => a.order - b.order;
  const inCur = cands.filter((p) => p.statement === state.stmt && forward(p) && empty(p)).sort(byOrder);
  if (inCur.length) return inCur[0];
  const other = cands.filter((p) => p.statement !== state.stmt && forward(p) && empty(p))
    .sort((a, b) => (a.order - state.last[a.statement]) - (b.order - state.last[b.statement]));
  if (other.length) return other[0];
  return cands.filter(empty).sort(byOrder)[0] || null;
}

// Sum of the children's values (recursively filling empty sub-groups); null when no child has a value.
export function childSum(values, id, col) {
  const kids = CHILDREN[id];
  if (!kids) return null;
  const useBilanzgewinn = id === 'pas.A' && valueOf(values, 'pas.A.VI', col) !== null;
  let sum = 0;
  let any = false;
  for (const k of kids) {
    if (useBilanzgewinn && (k === 'pas.A.IV' || k === 'pas.A.V')) continue;
    const v = valueOf(values, k, col);
    if (v !== null) { sum += v; any = true; }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

export function valueOf(values, id, col) {
  const cell = values[id]?.[col];
  if (cell && cell.v !== null && cell.v !== undefined) return cell.v;
  return childSum(values, id, col);
}

export { BY_ID };
