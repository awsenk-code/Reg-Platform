// Builds the Excel workbook with ExcelJS (passed in, so this also runs in Node tests).
// Sheets: Bilanz, GuV (fixed HGB template, one column per document and year), Kennzahlen and Veränderung VJ
// (Excel formulas on the first two sheets, so corrections made in Excel flow through), Prüfung (checks and sources).

import { AKTIVA, PASSIVA, GUV, BY_ID, CHILDREN, depth } from './schema.js';
import { RATIOS, COLS, computeRatios } from './analysis.js';

const FILL = {
  calc: 'FFDDEBF7',
  edit: 'FFFFF2CC',
  uncertain: 'FFFCE4D6',
  header: 'FF1F3864',
  section: 'FFD9E1F2',
};
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const thin = { style: 'thin', color: { argb: 'FFBFBFBF' } };

export const UNITS = { 1: 'EUR', 1000: 'TEUR' };

function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function colTitle(doc, col) {
  const y = col === 'gj' ? doc.year : doc.priorYear;
  return `${col === 'gj' ? 'GJ' : 'VJ'}${y ? ` ${y}` : ''}`;
}

// entries: [{ doc, values, checks }]; values = computeValues(doc)
export function buildWorkbook(ExcelJS, entries, { unit = 1 } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jahresabschluss-Reader';
  wb.created = new Date();
  const numFmt = unit === 1 ? '#,##0.00;[Red]-#,##0.00' : '#,##0.0;[Red]-#,##0.0';
  const unitName = UNITS[unit] || 'EUR';
  const refs = {}; // `${posId}|${docIndex}|${col}` → "Bilanz!C7"

  const statementSheet = (name, title, sections) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    ws.columns = [{ width: 7 }, { width: 62 }, ...entries.flatMap(() => [{ width: 17 }, { width: 17 }])];
    ws.getCell('A1').value = title;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `Angaben in ${unitName}. Legende: blau = berechnet, gelb = manuell korrigiert, orange = unsicher zugeordnet.`;
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF595959' } };
    const h1 = ws.getRow(3);
    const h2 = ws.getRow(4);
    h2.getCell(1).value = 'Pos.';
    h2.getCell(2).value = 'Bezeichnung';
    entries.forEach(({ doc }, d) => {
      const c = 3 + d * 2;
      h1.getCell(c).value = doc.company || doc.fileName;
      ws.mergeCells(3, c, 3, c + 1);
      h2.getCell(c).value = colTitle(doc, 'gj');
      h2.getCell(c + 1).value = colTitle(doc, 'vj');
    });
    for (const r of [h1, h2]) r.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = fill(FILL.header);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    h2.getCell(2).alignment = { horizontal: 'left' };

    let r = 5;
    for (const { heading, positions } of sections) {
      if (heading) {
        const row = ws.getRow(r++);
        row.getCell(1).value = heading;
        row.font = { bold: true };
        for (let c = 1; c <= 2 + entries.length * 2; c++) row.getCell(c).fill = fill(FILL.section);
      }
      for (const p of positions) {
        const row = ws.getRow(r);
        const isSum = !!CHILDREN[p.id] || !p.parent || p.id.endsWith('SUM');
        row.getCell(1).value = p.nr;
        row.getCell(2).value = p.label;
        row.getCell(2).alignment = { indent: depth(p.id) * 2 };
        if (isSum) row.font = { bold: depth(p.id) === 0 };
        entries.forEach(({ values }, d) => {
          COLS.forEach((col, k) => {
            const cell = row.getCell(3 + d * 2 + k);
            const v = values[p.id]?.[col];
            refs[`${p.id}|${d}|${col}`] = `'${name}'!${colLetter(3 + d * 2 + k)}${r}`;
            cell.numFmt = numFmt;
            cell.border = { left: thin, right: thin };
            if (!v) return;
            cell.value = Math.round((v.v / unit) * 100) / 100;
            if (v.status === 'calc') { cell.fill = fill(FILL.calc); cell.note = 'Berechnet aus den Unterpositionen bzw. GuV-Positionen.'; } else if (v.status === 'edit') { cell.fill = fill(FILL.edit); cell.note = 'Manuell korrigiert.'; } else if (v.src?.uncertain) { cell.fill = fill(FILL.uncertain); cell.note = `Aus Summenzeile zugeordnet (Seite ${v.src.page}), bitte prüfen.`; }
          });
        });
        if (p.id.endsWith('SUM') || p.id === 'guv.17') row.eachCell((c) => { c.border = { ...c.border, top: thin, bottom: { style: 'double' } }; });
        r++;
      }
    }
    return ws;
  };

  statementSheet('Bilanz', 'Bilanz nach § 266 HGB', [
    { heading: 'AKTIVA', positions: AKTIVA.map((p) => BY_ID[p.id]) },
    { heading: 'PASSIVA', positions: PASSIVA.map((p) => BY_ID[p.id]) },
  ]);
  statementSheet('GuV', 'Gewinn- und Verlustrechnung nach § 275 Abs. 2 HGB (Gesamtkostenverfahren)', [
    { heading: 'Aufwendungen als positive Beträge; Bestandsveränderung und Ergebnisse mit Vorzeichen', positions: GUV.map((p) => BY_ID[p.id]) },
  ]);

  // Kennzahlen as formulas on the statement sheets.
  const ks = wb.addWorksheet('Kennzahlen', { views: [{ state: 'frozen', xSplit: 1, ySplit: 4 }] });
  ks.columns = [{ width: 58 }, ...entries.flatMap(() => [{ width: 16 }, { width: 16 }])];
  ks.getCell('A1').value = 'Kennzahlen';
  ks.getCell('A1').font = { bold: true, size: 14 };
  ks.getCell('A2').value = `Formeln auf Basis der Blätter Bilanz und GuV; Beträge in ${unitName}. Kurzfristiges Fremdkapital ist eine Näherung (Rückstellungen ohne Pensionsrückstellungen + Verbindlichkeiten ohne Anleihen + passive RAP).`;
  ks.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  const kh1 = ks.getRow(3);
  const kh2 = ks.getRow(4);
  kh2.getCell(1).value = 'Kennzahl';
  entries.forEach(({ doc }, d) => {
    kh1.getCell(2 + d * 2).value = doc.company || doc.fileName;
    ks.mergeCells(3, 2 + d * 2, 3, 3 + d * 2);
    kh2.getCell(2 + d * 2).value = colTitle(doc, 'gj');
    kh2.getCell(3 + d * 2).value = colTitle(doc, 'vj');
  });
  for (const row of [kh1, kh2]) row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill(FILL.header); cell.alignment = { horizontal: 'center' }; });
  kh2.getCell(1).alignment = { horizontal: 'left' };

  const ratioValues = entries.map(({ values }) => computeRatios(values));
  const expr = (terms, d, col) => terms.map(([id, s], i) => `${s < 0 ? '-' : i ? '+' : ''}N(${refs[`${id}|${d}|${col}`]})`).join('');
  let kr = 5;
  let group = null;
  for (const ratio of RATIOS) {
    if (ratio.group !== group) {
      group = ratio.group;
      const gr = ks.getRow(kr++);
      gr.getCell(1).value = group;
      gr.font = { bold: true };
      for (let c = 1; c <= 1 + entries.length * 2; c++) gr.getCell(c).fill = fill(FILL.section);
    }
    const row = ks.getRow(kr++);
    row.getCell(1).value = ratio.label;
    entries.forEach((_, d) => {
      COLS.forEach((col, k) => {
        const cell = row.getCell(2 + d * 2 + k);
        const any = ratio.num.map(([id]) => refs[`${id}|${d}|${col}`]).join(',');
        const num = expr(ratio.num, d, col);
        const body = ratio.den ? `IFERROR((${num})/(${expr(ratio.den, d, col)}),"")` : `${num}`;
        const res = ratioValues[d][ratio.id][col];
        const result = res === null || res === undefined ? '' : ratio.format === 'eur' ? Math.round((res / unit) * 100) / 100 : res;
        cell.value = { formula: `IF(COUNT(${any})=0,"",${body})`, result };
        cell.numFmt = ratio.format === 'pct' ? '0.0%' : ratio.format === 'x' ? '0.00' : numFmt;
      });
    });
  }

  // Veränderung zum Vorjahr per position.
  const vs = wb.addWorksheet('Veränderung VJ', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
  vs.columns = [{ width: 7 }, { width: 58 }, ...entries.flatMap(() => [{ width: 15 }, { width: 15 }, { width: 15 }, { width: 10 }])];
  vs.getCell('A1').value = 'Veränderung zum Vorjahr';
  vs.getCell('A1').font = { bold: true, size: 14 };
  vs.getCell('A2').value = `Formeln auf Basis der Blätter Bilanz und GuV; Beträge in ${unitName}.`;
  vs.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  const vh1 = vs.getRow(3);
  const vh2 = vs.getRow(4);
  vh2.getCell(1).value = 'Pos.';
  vh2.getCell(2).value = 'Bezeichnung';
  entries.forEach(({ doc }, d) => {
    const c = 3 + d * 4;
    vh1.getCell(c).value = doc.company || doc.fileName;
    vs.mergeCells(3, c, 3, c + 3);
    vh2.getCell(c).value = colTitle(doc, 'gj');
    vh2.getCell(c + 1).value = colTitle(doc, 'vj');
    vh2.getCell(c + 2).value = 'Δ absolut';
    vh2.getCell(c + 3).value = 'Δ %';
  });
  for (const row of [vh1, vh2]) row.eachCell((cell) => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = fill(FILL.header); cell.alignment = { horizontal: 'center' }; });
  let vr = 5;
  for (const [heading, list] of [['AKTIVA', AKTIVA], ['PASSIVA', PASSIVA], ['GEWINN- UND VERLUSTRECHNUNG', GUV]]) {
    const hr = vs.getRow(vr++);
    hr.getCell(1).value = heading;
    hr.font = { bold: true };
    for (let c = 1; c <= 2 + entries.length * 4; c++) hr.getCell(c).fill = fill(FILL.section);
    for (const p of list) {
      const row = vs.getRow(vr);
      row.getCell(1).value = p.nr;
      row.getCell(2).value = p.label;
      row.getCell(2).alignment = { indent: depth(p.id) * 2 };
      if (CHILDREN[p.id] || p.id.endsWith('SUM')) row.font = { bold: depth(p.id) === 0 };
      entries.forEach(({ values }, d) => {
        const c = 3 + d * 4;
        const g = refs[`${p.id}|${d}|gj`];
        const v = refs[`${p.id}|${d}|vj`];
        const gv = values[p.id]?.gj?.v;
        const vv = values[p.id]?.vj?.v;
        const has = (x) => x !== undefined && x !== null;
        const L = (i) => `${colLetter(c + i)}${vr}`;
        row.getCell(c).value = { formula: `IF(${g}="","",${g})`, result: has(gv) ? gv / unit : '' };
        row.getCell(c + 1).value = { formula: `IF(${v}="","",${v})`, result: has(vv) ? vv / unit : '' };
        row.getCell(c + 2).value = { formula: `IF(AND(${L(0)}="",${L(1)}=""),"",N(${L(0)})-N(${L(1)}))`, result: has(gv) || has(vv) ? ((gv || 0) - (vv || 0)) / unit : '' };
        row.getCell(c + 3).value = { formula: `IF(OR(${L(0)}="",N(${L(1)})=0),"",(N(${L(0)})-N(${L(1)}))/ABS(${L(1)}))`, result: has(gv) && vv ? (gv - vv) / Math.abs(vv) : '' };
        for (let i = 0; i < 3; i++) row.getCell(c + i).numFmt = numFmt;
        row.getCell(c + 3).numFmt = '0.0%;[Red]-0.0%';
      });
      vr++;
    }
  }

  // Prüfung: document info, checks and lines with amounts that could not be assigned.
  const ps = wb.addWorksheet('Prüfung');
  ps.columns = [{ width: 28 }, { width: 14 }, { width: 110 }];
  ps.getCell('A1').value = 'Prüfprotokoll';
  ps.getCell('A1').font = { bold: true, size: 14 };
  let pr = 3;
  const LEVEL = { ok: 'OK', warn: 'Hinweis', error: 'Fehler' };
  const LEVEL_COLOR = { ok: 'FF2E7D32', warn: 'FFB26A00', error: 'FFC62828' };
  for (const { doc, checks } of entries) {
    const head = ps.getRow(pr++);
    head.getCell(1).value = doc.company || doc.fileName;
    head.font = { bold: true, size: 12 };
    const info = [
      ['Datei', doc.fileName],
      ['Geschäftsjahr / Vorjahr', `${doc.year ?? '?'} / ${doc.priorYear ?? '?'}`],
      ['Einheit im PDF', doc.scale === 1000 ? 'TEUR' : doc.scale === 1e6 ? 'Mio. EUR' : 'EUR'],
      ['Seiten', `${doc.pageCount} (Bilanz/GuV auf Seite ${doc.statementPages.join(', ') || '–'}${doc.ocrPages.length ? `; per Texterkennung (OCR) gelesen: ${doc.ocrPages.join(', ')}` : ''})`],
    ];
    for (const [k, v] of info) { const row = ps.getRow(pr++); row.getCell(1).value = k; row.getCell(3).value = v; }
    for (const c of checks) {
      const row = ps.getRow(pr++);
      row.getCell(2).value = LEVEL[c.level];
      row.getCell(2).font = { bold: true, color: { argb: LEVEL_COLOR[c.level] } };
      row.getCell(3).value = c.text;
    }
    if (doc.unmatched?.length) {
      const row = ps.getRow(pr++);
      row.getCell(1).value = 'Nicht zugeordnete Zeilen';
      row.font = { italic: true };
      for (const u of doc.unmatched) { const ur = ps.getRow(pr++); ur.getCell(2).value = `Seite ${u.page}`; ur.getCell(3).value = u.text; }
    }
    pr++;
  }
  return wb;
}
