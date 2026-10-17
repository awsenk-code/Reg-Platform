import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmount, cleanAmountToken, normalizeLabel, matchCandidates, extractDocument, detectCompany, detectYears, detectScale,
} from '../js/parse.js';
import { computeValues, checkDocument, computeRatios } from '../js/analysis.js';

// Builds a page from rows: [label, [amount, rightEdgeX], ...]. Label words start at x = 50 (5 pt per character).
function page(rows, { width = 595, startY = 100 } = {}) {
  const tokens = [];
  rows.forEach((row, i) => {
    const top = startY + i * 14;
    const [label, ...nums] = Array.isArray(row) ? row : [row];
    let x = typeof label === 'object' ? label.x : 50;
    const text = typeof label === 'object' ? label.text : label;
    for (const w of text.split(/\s+/).filter(Boolean)) {
      tokens.push({ str: w, x0: x, x1: x + w.length * 5, top, bottom: top + 9 });
      x += w.length * 5 + 3;
    }
    for (const [str, x1] of nums) tokens.push({ str, x0: x1 - str.length * 5, x1, top, bottom: top + 9 });
  });
  return { width, height: 842, tokens };
}

const v = (doc, id, col = 'gj') => doc.values[id]?.[col]?.v;

test('parseAmount reads German, negative and empty amounts', () => {
  assert.equal(parseAmount('1.234.567,89'), 1234567.89);
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('-1.234,50'), -1234.5);
  assert.equal(parseAmount('(1.234)'), -1234);
  assert.equal(parseAmount('1.234-'), -1234);
  assert.equal(parseAmount('–'), 0);
  assert.equal(parseAmount('0,00'), 0);
  assert.equal(parseAmount('12'), 12);
  assert.equal(parseAmount('1 234 567,89'), 1234567.89);
  assert.equal(parseAmount('1,234,567.89'), 1234567.89);
  assert.equal(parseAmount('EUR 5.000,00'), 5000);
  assert.equal(parseAmount('31.12.2023'), null);
  assert.equal(parseAmount('1418.254,78'), null);
  assert.equal(parseAmount('Umsatz'), null);
});

test('cleanAmountToken repairs typical OCR noise', () => {
  assert.equal(cleanAmountToken('©658.730,32').str, '658.730,32');
  assert.equal(cleanAmountToken('1418.254,78').str, '418.254,78');
  assert.equal(cleanAmountToken('l.234,5O').str, '1.234,50');
  assert.deepEqual(cleanAmountToken('14.999.999,21').alts, [4999999.21]);
});

test('normalizeLabel strips enumerators, umlauts, parentheses and "davon" parts', () => {
  assert.equal(normalizeLabel('A. I. 1. Selbst geschaffene Rechte'), 'selbst geschaffene rechte');
  assert.equal(normalizeLabel('b) Soziale Abgaben (davon für Altersversorgung)'), 'soziale abgaben');
  assert.equal(normalizeLabel('IV. Kassenbestand, Guthaben bei Kreditinstituten'), 'kassenbestand guthaben bei kreditinstituten');
  assert.equal(normalizeLabel('8. Sonstige Verbindlichkeiten davon aus Steuern'), 'sonstige verbindlichkeiten');
  assert.equal(normalizeLabel('Erträge aus Beteiligungen'), 'ertraege aus beteiligungen');
});

test('matchCandidates finds positions and keeps ambiguous labels ambiguous', () => {
  assert.deepEqual(matchCandidates('umsatzerloese').map((p) => p.id), ['guv.1']);
  assert.deepEqual(matchCandidates('geleistete anzahlungen').map((p) => p.id), ['akt.A.I.4', 'akt.A.II.4', 'akt.B.I.4']);
  assert.deepEqual(matchCandidates('summe anlagevermoegen').map((p) => p.id), ['akt.A']);
  assert.deepEqual(matchCandidates('davon aus steuern'), []);
  assert.ok(matchCandidates('jahresueberschuss').some((p) => p.id === 'pas.A.V'));
  assert.ok(matchCandidates('jahresueberschuss').some((p) => p.id === 'guv.17'));
});

test('document detection: company, years and unit', () => {
  const p = page(['Jahresabschluss der Muster Pharma GmbH, Berlin', 'Bilanz zum 31.12.2023']);
  assert.equal(detectCompany([p]), 'Muster Pharma GmbH');
  assert.deepEqual(detectYears(['Bilanz zum 31. Dezember 2023', 'Vorjahr 31.12.2022']), [2023, 2022]);
  assert.equal(detectScale(['Angaben in TEUR']), 1000);
  assert.equal(detectScale(['in Tausend Euro']), 1000);
  assert.equal(detectScale(['EUR']), 1);
});

// Balance sheet with inner (sub-positions), outer (group totals) and prior-year column.
const XI = 400; const XO = 480; const XV = 560;
const balance = page([
  'Muster GmbH',
  ['Bilanz zum 31.12.2023'],
  ['AKTIVA'],
  ['A. Anlagevermögen'],
  ['I. Sachanlagen'],
  ['1. Technische Anlagen und Maschinen', ['100.000,00', XI], ['90.000,00', XV]],
  ['2. Geleistete Anzahlungen und Anlagen im Bau', ['20.000,00', XI], ['120.000,00', XO], ['10.000,00', XV]],
  ['B. Umlaufvermögen'],
  ['I. Vorräte'],
  ['1. Roh-, Hilfs- und Betriebsstoffe', ['30.000,00', XI], ['25.000,00', XV]],
  ['2. Geleistete Anzahlungen', ['5.000,00', XI], ['35.000,00', XO], ['4.000,00', XV]],
  ['II. Kassenbestand, Guthaben bei Kreditinstituten', ['45.000,00', XO], ['40.000,00', XV]],
  [{ text: '', x: 50 }, ['80.000,00', XO], ['69.000,00', XV]],
  ['Summe Aktiva', ['200.000,00', XO], ['169.000,00', XV]],
  ['PASSIVA'],
  ['A. Eigenkapital'],
  ['I. Gezeichnetes Kapital', ['25.000,00', XO], ['25.000,00', XV]],
  ['II. Verlustvortrag', ['5.000,00', XO], ['8.000,00', XV]],
  ['III. Jahresüberschuss', ['10.000,00', XO], ['3.000,00', XV]],
  ['B. Verbindlichkeiten'],
  ['1. Verbindlichkeiten gegenüber Kreditinstituten', ['150.000,00', XI], ['130.000,00', XV]],
  ['2. Sonstige Verbindlichkeiten', ['20.000,00', XI], ['170.000,00', XO], ['19.000,00', XV]],
  ['- davon aus Steuern', ['1.000,00', XI]],
  ['Summe Passiva', ['200.000,00', XO], ['169.000,00', XV]],
]);
const guv = page([
  'Gewinn- und Verlustrechnung 2023',
  ['1. Umsatzerlöse', ['500.000,00', XO], ['450.000,00', XV]],
  ['2. Materialaufwand', ['-200.000,00', XO], ['-190.000,00', XV]],
  ['3. Personalaufwand', ['-150.000,00', XO], ['-140.000,00', XV]],
  ['4. Abschreibungen', ['-30.000,00', XO], ['-28.000,00', XV]],
  ['5. Sonstige betriebliche Aufwendungen', ['-100.000,00', XO], ['-85.000,00', XV]],
  ['6. Zinsen und ähnliche Aufwendungen', ['-5.000,00', XO], ['-4.000,00', XV]],
  ['7. Steuern vom Einkommen und vom Ertrag', ['-5.000,00', XO], ['0,00', XV]],
  ['8. Jahresüberschuss', ['10.000,00', XO], ['3.000,00', XV]],
]);

test('extracts balance sheet with inner/outer columns, ambiguous labels and signs', () => {
  const doc = extractDocument([balance, guv], { fileName: 'muster.pdf' });
  assert.equal(doc.company, 'Muster GmbH');
  assert.equal(doc.year, 2023);
  assert.equal(doc.hasVJ, true);
  assert.equal(v(doc, 'akt.A.II.2'), 100000);
  assert.equal(v(doc, 'akt.A.II.2', 'vj'), 90000);
  assert.equal(v(doc, 'akt.A.II.4'), 20000, '"geleistete Anzahlungen und Anlagen im Bau" in Sachanlagen');
  assert.equal(v(doc, 'akt.A.II'), 120000, 'outer column → group total');
  assert.equal(v(doc, 'akt.B.I.4'), 5000, 'second "geleistete Anzahlungen" → Vorräte');
  assert.equal(v(doc, 'akt.B.I'), 35000);
  assert.equal(v(doc, 'akt.B.IV'), 45000);
  assert.equal(v(doc, 'akt.B'), 80000, 'unlabelled sum line → Umlaufvermögen');
  assert.equal(v(doc, 'akt.B', 'vj'), 69000);
  assert.equal(v(doc, 'akt.SUM'), 200000);
  assert.equal(v(doc, 'pas.A.IV'), -5000, 'Verlustvortrag is negative');
  assert.equal(v(doc, 'pas.A.V'), 10000, 'Jahresüberschuss in the balance sheet');
  assert.equal(v(doc, 'pas.C'), 170000);
  assert.equal(v(doc, 'pas.SUM', 'vj'), 169000);
  assert.equal(v(doc, 'guv.17'), 10000, 'Jahresüberschuss in the income statement');
  assert.equal(v(doc, 'guv.5'), 200000, 'expenses printed negative are stored as positive amounts');
  assert.equal(doc.expensesPrintedNegative, true);
  assert.equal(doc.values['pas.C.8'].gj.v, 20000, '"davon" line is ignored');

  const values = computeValues(doc);
  assert.equal(values['akt.A'].gj.v, 120000);
  assert.equal(values['akt.A'].gj.status, 'calc');
  assert.equal(values['pas.A'].gj.v, 30000);
  assert.equal(values['guv.15'].gj.v, 10000);
  const checks = checkDocument(doc, values);
  assert.deepEqual(checks.filter((c) => c.level !== 'ok').map((c) => c.text), []);

  const r = computeRatios(values);
  assert.equal(r.ekq.gj, 30000 / 200000);
  assert.equal(r.fk.gj, 170000);
  assert.equal(r.ur.gj, 10000 / 500000);
  assert.equal(r.ebit.gj, 10000 + 5000 + 5000);
  assert.equal(r.l1.gj, 45000 / 170000);
});

test('side-by-side balance sheet in TEUR with a note column', () => {
  const W = 842;
  const L = (text) => ({ text, x: 40 });
  const R = (text) => ({ text, x: 440 });
  const p = { width: W, height: 595, tokens: [] };
  const rows = [
    [L('AKTIVA'), [], R('PASSIVA'), []],
    [L('A. Anlagevermögen'), [['1.000', 300], ['900', 370]], R('A. Eigenkapital'), [['600', 710], ['500', 780]]],
    [L('B. Umlaufvermögen'), [['500', 300], ['450', 370]], R('B. Rückstellungen'), [['300', 710], ['250', 780]]],
    [L('C. Rechnungsabgrenzungsposten'), [['10', 300], ['8', 370]], R('C. Verbindlichkeiten'), [['610', 710], ['608', 780]]],
    [L('Bilanzsumme'), [['1.510', 300], ['1.358', 370]], R('Bilanzsumme'), [['1.510', 710], ['1.358', 780]]],
  ];
  rows.forEach((row, i) => {
    const top = 100 + i * 15;
    for (let k = 0; k < row.length; k += 2) {
      let x = row[k].x;
      for (const w of row[k].text.split(' ')) { p.tokens.push({ str: w, x0: x, x1: x + w.length * 5, top, bottom: top + 9 }); x += w.length * 5 + 3; }
      for (const [str, x1] of row[k + 1]) p.tokens.push({ str, x0: x1 - str.length * 5, x1, top, bottom: top + 9 });
    }
  });
  p.tokens.push({ str: 'in', x0: 40, x1: 50, top: 60, bottom: 69 }, { str: 'TEUR', x0: 53, x1: 73, top: 60, bottom: 69 });
  const g = page([
    'Gewinn- und Verlustrechnung',
    ['1. Umsatzerlöse', ['1', 470], ['2.000', 600], ['1.800', 700]],
    ['2. Materialaufwand', ['2', 470], ['-1.200', 600], ['-1.100', 700]],
    ['3. Jahresüberschuss', ['800', 600], ['700', 700]],
  ], { width: W });
  const doc = extractDocument([p, g], { fileName: 'ag.pdf' });
  assert.equal(doc.scale, 1000);
  assert.equal(v(doc, 'akt.A'), 1000000);
  assert.equal(v(doc, 'pas.A'), 600000);
  assert.equal(v(doc, 'akt.SUM'), 1510000);
  assert.equal(v(doc, 'pas.SUM'), 1510000);
  assert.equal(v(doc, 'pas.C', 'vj'), 608000);
  assert.equal(v(doc, 'akt.C'), 10000, 'Rechnungsabgrenzungsposten on the left → Aktiva');
  assert.equal(v(doc, 'guv.1'), 2000000, 'note column is ignored');
  assert.equal(v(doc, 'guv.5'), 1200000);
});

test('checks report unbalanced balance sheets and wrong subtotals', () => {
  const doc = {
    year: 2023, priorYear: 2022, scale: 1,
    values: {
      'akt.A': { gj: { v: 100, status: 'pdf' } },
      'akt.A.II.2': { gj: { v: 60, status: 'pdf' } },
      'akt.A.II.3': { gj: { v: 30, status: 'pdf' } },
      'akt.SUM': { gj: { v: 100, status: 'pdf' } },
      'pas.A.I': { gj: { v: 80, status: 'pdf' } },
      'guv.1': { gj: { v: 500, status: 'pdf' } },
    },
  };
  const checks = checkDocument(doc);
  const texts = checks.filter((c) => c.level !== 'ok').map((c) => c.text).join('\n');
  assert.match(texts, /Aktiva \(100,00\) ≠ Passiva \(80,00\)/);
  assert.match(texts, /Anlagevermögen \(100,00\) ≠ Summe der Unterpositionen \(90,00\)/);
  assert.match(texts, /Jahresüberschuss\/-fehlbetrag der GuV nicht gefunden/);
});

test('manual edits override values and totals are recomputed', () => {
  const doc = extractDocument([balance, guv], { fileName: 'muster.pdf' });
  doc.values['akt.B.IV'].gj = { v: 50000, status: 'edit' };
  const values = computeValues(doc);
  assert.equal(values['akt.B.IV'].gj.status, 'edit');
  assert.equal(values['akt.B'].gj.v, 80000, 'printed total stays');
  const issues = checkDocument(doc, values).filter((c) => c.level !== 'ok');
  assert.ok(issues.some((c) => c.id === 'akt.B'), 'and is flagged against the edited sub-position');
});
