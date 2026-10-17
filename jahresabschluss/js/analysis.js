// Totals, plausibility checks and financial ratios for one extracted document. Pure logic, unit-tested in Node.

import { POSITIONS, BY_ID, CHILDREN } from './schema.js';
import { childSum } from './parse.js';

export const COLS = ['gj', 'vj'];

// Allowed rounding difference in EUR: exact for EUR statements, a few units for statements printed in TEUR / Mio.
export const tolerance = (doc) => (doc.scale > 1 ? doc.scale * 3 : 1);

const GUV_RESULT_BEFORE_15 = ['guv.1', 'guv.2', 'guv.3', 'guv.4', 'guv.5', 'guv.6', 'guv.7', 'guv.8', 'guv.9', 'guv.9a', 'guv.10', 'guv.11', 'guv.12', 'guv.12a', 'guv.13', 'guv.14'];
const GUV_RESULT_AFTER_15 = ['guv.16', 'guv.16a'];

function signed(id, v) {
  const s = BY_ID[id].sign;
  return s === -1 ? -v : v;
}

// Fills every position: values read from the PDF or edited by hand win, otherwise totals are derived.
// Returns { [id]: { gj: cell, vj: cell } } with cell = { v, status: 'pdf' | 'edit' | 'calc', src? } or undefined.
export function computeValues(doc) {
  const out = {};
  const raw = doc.values || {};
  for (const p of POSITIONS) {
    out[p.id] = {};
    for (const col of COLS) {
      const cell = raw[p.id]?.[col];
      if (cell && cell.v !== null && cell.v !== undefined) out[p.id][col] = { ...cell };
    }
  }
  // Bottom-up totals (children come after their parent in template order).
  for (const p of [...POSITIONS].reverse()) {
    if (!CHILDREN[p.id]) continue;
    for (const col of COLS) {
      if (out[p.id][col]) continue;
      const s = childSum(out, p.id, col);
      if (s !== null) out[p.id][col] = { v: s, status: 'calc' };
    }
  }
  for (const col of COLS) {
    // Only derive results from a usable income statement (income and at least one expense line).
    const present = GUV_RESULT_BEFORE_15.filter((id) => out[id]?.[col]);
    const usable = present.some((id) => BY_ID[id].sign === 1) && present.some((id) => BY_ID[id].sign === -1);
    const r15 = usable ? guvResult(out, GUV_RESULT_BEFORE_15, col) : null;
    if (!out['guv.15'][col] && r15 !== null) out['guv.15'][col] = { v: r15, status: 'calc' };
    const base = out['guv.15'][col]?.v;
    if (!out['guv.17'][col] && base !== undefined) {
      const after = guvResult(out, GUV_RESULT_AFTER_15, col) || 0;
      out['guv.17'][col] = { v: round(base + after), status: 'calc' };
    }
  }
  return out;
}

function guvResult(values, ids, col) {
  let sum = 0;
  let any = false;
  for (const id of ids) {
    const v = values[id]?.[col]?.v;
    if (v !== undefined && v !== null) { sum += signed(id, v); any = true; }
  }
  return any ? round(sum) : null;
}

const round = (v) => Math.round(v * 100) / 100;
const fmt = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Plausibility checks shown in the review screen and written to the "Prüfung" sheet.
export function checkDocument(doc, values = computeValues(doc)) {
  const tol = tolerance(doc);
  const checks = [];
  const colName = (col) => (col === 'gj' ? `GJ ${doc.year || ''}`.trim() : `VJ ${doc.priorYear || ''}`.trim());
  const get = (id, col) => values[id]?.[col]?.v;
  const usedCols = COLS.filter((col) => POSITIONS.some((p) => values[p.id][col] && values[p.id][col].status !== 'calc'));

  for (const col of usedCols) {
    const a = get('akt.SUM', col);
    const p = get('pas.SUM', col);
    if (a === undefined || p === undefined) checks.push({ level: 'error', col, text: `${colName(col)}: Bilanzsumme fehlt (Aktiva oder Passiva).` });
    else if (Math.abs(a - p) > tol) checks.push({ level: 'error', col, text: `${colName(col)}: Aktiva (${fmt(a)}) ≠ Passiva (${fmt(p)}), Differenz ${fmt(a - p)}.` });
    else checks.push({ level: 'ok', col, text: `${colName(col)}: Aktiva = Passiva (${fmt(a)}).` });

    let sumIssues = 0;
    for (const id of Object.keys(CHILDREN)) {
      const cell = values[id][col];
      if (!cell || cell.status === 'calc') continue;
      const s = childSum(values, id, col);
      if (s === null || CHILDREN[id].every((k) => values[k][col]?.status === 'calc')) continue;
      if (Math.abs(s - cell.v) > tol) {
        sumIssues++;
        checks.push({ level: 'warn', col, id, text: `${colName(col)}: ${BY_ID[id].label} (${fmt(cell.v)}) ≠ Summe der Unterpositionen (${fmt(s)}).` });
      }
    }
    if (!sumIssues) checks.push({ level: 'ok', col, text: `${colName(col)}: Alle Zwischensummen stimmen mit den Unterpositionen überein.` });

    const jue = get('guv.17', col);
    const calc15 = guvResult(values, GUV_RESULT_BEFORE_15, col);
    if (jue === undefined) checks.push({ level: 'warn', col, text: `${colName(col)}: Jahresüberschuss/-fehlbetrag der GuV nicht gefunden.` });
    else if (values['guv.17'][col].status === 'calc') checks.push({ level: 'warn', col, id: 'guv.17', text: `${colName(col)}: Jahresüberschuss/-fehlbetrag nicht im PDF gefunden, aus den GuV-Positionen berechnet.` });
    else if (values['guv.17'][col].status !== 'calc' && calc15 !== null) {
      const calc17 = round(calc15 + (guvResult(values, GUV_RESULT_AFTER_15, col) || 0));
      if (Math.abs(calc17 - jue) > tol * 3) checks.push({ level: 'warn', col, id: 'guv.17', text: `${colName(col)}: GuV-Positionen ergeben ${fmt(calc17)}, ausgewiesen ist ${fmt(jue)}.` });
      else checks.push({ level: 'ok', col, text: `${colName(col)}: GuV rechnet sich auf den Jahresüberschuss.` });
    }
    const bilJue = get('pas.A.V', col);
    if (jue !== undefined && bilJue !== undefined && get('pas.A.VI', col) === undefined) {
      if (Math.abs(jue - bilJue) > tol) checks.push({ level: 'warn', col, text: `${colName(col)}: Jahresüberschuss GuV (${fmt(jue)}) ≠ Bilanz (${fmt(bilJue)}).` });
      else checks.push({ level: 'ok', col, text: `${colName(col)}: Jahresüberschuss in GuV und Bilanz identisch.` });
    }
    if (get('guv.1', col) === undefined) checks.push({ level: 'warn', col, text: `${colName(col)}: Umsatzerlöse nicht gefunden.` });
  }
  for (const id of Object.keys(doc.values || {})) {
    for (const col of COLS) {
      if (doc.values[id][col]?.src?.uncertain) checks.push({ level: 'warn', col, id, text: `${colName(col)}: ${BY_ID[id].label} aus einer Summenzeile zugeordnet, bitte prüfen.` });
    }
  }
  if (!usedCols.length) checks.push({ level: 'error', text: 'Keine Bilanz- oder GuV-Werte erkannt.' });
  return checks;
}

// --- Ratios ---
// Each ratio is num / den, both lists of [positionId, sign]. Missing positions count as 0; when no numerator
// position exists the ratio is left empty. Excel export builds the same formulas from these definitions.

const T = (...terms) => terms.map((t) => (typeof t === 'string' ? [t, 1] : t));
const EK = T('pas.A');
const FK = T('akt.SUM', ['pas.A', -1]);
const KFR_FK = T('pas.B', ['pas.B.1', -1], 'pas.C', ['pas.C.1', -1], 'pas.D');
const EBIT = T('guv.17', 'guv.14', 'guv.13', ['guv.11', -1]);
const GESAMTLEISTUNG = T('guv.1', 'guv.2', 'guv.3');

export const RATIOS = [
  { group: 'Kapitalstruktur', id: 'ek', label: 'Eigenkapital', num: EK, format: 'eur' },
  { group: 'Kapitalstruktur', id: 'fk', label: 'Fremdkapital (Bilanzsumme − Eigenkapital)', num: FK, format: 'eur' },
  { group: 'Kapitalstruktur', id: 'ekq', label: 'Eigenkapitalquote', num: EK, den: T('akt.SUM'), format: 'pct' },
  { group: 'Kapitalstruktur', id: 'fkq', label: 'Fremdkapitalquote', num: FK, den: T('akt.SUM'), format: 'pct' },
  { group: 'Kapitalstruktur', id: 'vg', label: 'Verschuldungsgrad (FK / EK)', num: FK, den: EK, format: 'x' },
  { group: 'Kapitalstruktur', id: 'ai', label: 'Anlagenintensität (AV / Bilanzsumme)', num: T('akt.A'), den: T('akt.SUM'), format: 'pct' },
  { group: 'Kapitalstruktur', id: 'ad1', label: 'Anlagendeckung I (EK / AV)', num: EK, den: T('akt.A'), format: 'pct' },
  { group: 'Kapitalstruktur', id: 'ad2', label: 'Anlagendeckung II ((EK + Pensionsrückst. + Anleihen) / AV)', num: T('pas.A', 'pas.B.1', 'pas.C.1'), den: T('akt.A'), format: 'pct' },
  { group: 'Liquidität', id: 'lm', label: 'Liquide Mittel (inkl. Wertpapiere UV)', num: T('akt.B.IV', 'akt.B.III'), format: 'eur' },
  { group: 'Liquidität', id: 'kfk', label: 'Kurzfristiges Fremdkapital (Näherung)', num: KFR_FK, format: 'eur' },
  { group: 'Liquidität', id: 'l1', label: 'Liquidität 1. Grades', num: T('akt.B.IV', 'akt.B.III'), den: KFR_FK, format: 'pct' },
  { group: 'Liquidität', id: 'l2', label: 'Liquidität 2. Grades', num: T('akt.B.IV', 'akt.B.III', 'akt.B.II'), den: KFR_FK, format: 'pct' },
  { group: 'Liquidität', id: 'l3', label: 'Liquidität 3. Grades', num: T('akt.B'), den: KFR_FK, format: 'pct' },
  { group: 'Liquidität', id: 'wc', label: 'Working Capital (UV − kurzfr. FK)', num: T('akt.B', ...KFR_FK.map(([id, s]) => [id, -s])), format: 'eur' },
  { group: 'Rentabilität', id: 'gl', label: 'Gesamtleistung', num: GESAMTLEISTUNG, format: 'eur' },
  { group: 'Rentabilität', id: 'ebit', label: 'EBIT (JÜ + Ertragsteuern + Zinsaufwand − Zinserträge)', num: EBIT, format: 'eur' },
  { group: 'Rentabilität', id: 'ebitda', label: 'EBITDA (EBIT + Abschreibungen)', num: [...EBIT, ['guv.7', 1]], format: 'eur' },
  { group: 'Rentabilität', id: 'ur', label: 'Umsatzrendite (JÜ / Umsatz)', num: T('guv.17'), den: T('guv.1'), format: 'pct' },
  { group: 'Rentabilität', id: 'ebitm', label: 'EBIT-Marge', num: EBIT, den: T('guv.1'), format: 'pct' },
  { group: 'Rentabilität', id: 'ekr', label: 'Eigenkapitalrendite (JÜ / EK)', num: T('guv.17'), den: EK, format: 'pct' },
  { group: 'Rentabilität', id: 'gkr', label: 'Gesamtkapitalrendite ((JÜ + Zinsaufwand) / Bilanzsumme)', num: T('guv.17', 'guv.13'), den: T('akt.SUM'), format: 'pct' },
  { group: 'Rentabilität', id: 'mq', label: 'Materialaufwandsquote (Material / Gesamtleistung)', num: T('guv.5'), den: GESAMTLEISTUNG, format: 'pct' },
  { group: 'Rentabilität', id: 'pq', label: 'Personalaufwandsquote (Personal / Gesamtleistung)', num: T('guv.6'), den: GESAMTLEISTUNG, format: 'pct' },
];

function termSum(values, terms, col) {
  let sum = 0;
  for (const [id, s] of terms) {
    const v = values[id]?.[col]?.v;
    if (v !== undefined && v !== null) sum += s * v;
  }
  return sum;
}

export function computeRatios(values) {
  const out = {};
  for (const r of RATIOS) {
    out[r.id] = {};
    for (const col of COLS) {
      if (!r.num.some(([id]) => values[id]?.[col]?.v !== undefined)) { out[r.id][col] = null; continue; }
      const num = termSum(values, r.num, col);
      if (!r.den) { out[r.id][col] = round(num); continue; }
      const den = termSum(values, r.den, col);
      out[r.id][col] = den ? num / den : null;
    }
  }
  return out;
}

export function formatRatio(v, format) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  if (format === 'pct') return `${(v * 100).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  if (format === 'x') return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fmt(v);
}
