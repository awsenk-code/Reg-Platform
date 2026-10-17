// UI: upload, review table with editable values, ratios, checks and Excel export.

import { readPdf, loadScript, LIBS } from './pdf.js';
import { extractDocument, parseAmount, formatAmount } from './parse.js';
import { computeValues, checkDocument, computeRatios, formatRatio, RATIOS, COLS } from './analysis.js';
import { buildWorkbook } from './excel.js';
import { AKTIVA, PASSIVA, GUV, BY_ID, CHILDREN, depth } from './schema.js';

const $ = (sel) => document.querySelector(sel);
const state = { docs: [], tab: 'bilanz', hideEmpty: true };
let nextId = 1;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// --- Upload ---

const drop = $('#dropzone');
const fileInput = $('#file');
$('#btn-pick').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
drop.addEventListener('click', (e) => { if (e.target === drop || e.target.closest('.upload-icon')) fileInput.click(); });
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener('change', () => { handleFiles([...fileInput.files]); fileInput.value = ''; });
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); });
drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));

let queue = Promise.resolve();
function handleFiles(files) {
  const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  for (const file of pdfs) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="spinner"></span><span><strong>${esc(file.name)}</strong> · <span class="msg">wartet …</span></span>`;
    $('#jobs').appendChild(li);
    const msg = (t) => { li.querySelector('.msg').textContent = t; };
    queue = queue.then(async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const pages = await readPdf(data, { onProgress: msg, forceOcr: $('#force-ocr').checked });
        msg('Werte werden zugeordnet …');
        const doc = extractDocument(pages, { fileName: file.name });
        doc.id = nextId++;
        state.docs.push(doc);
        li.remove();
        render();
      } catch (err) {
        console.error(err);
        li.classList.add('error');
        li.querySelector('.spinner')?.remove();
        msg(`Fehler: ${err.message || err}`);
      }
    });
  }
}

// --- Rendering ---

function analysed() {
  return state.docs.map((doc) => {
    const values = computeValues(doc);
    return { doc, values, checks: checkDocument(doc, values) };
  });
}

function render() {
  const entries = analysed();
  $('#review').hidden = !entries.length;
  $('#btn-export').disabled = !entries.length;
  const issues = entries.reduce((n, e) => n + e.checks.filter((c) => c.level !== 'ok').length, 0);
  $('#check-badge').textContent = issues || '';
  renderDocs(entries);
  renderTab(entries);
}

function renderDocs(entries) {
  $('#docs').innerHTML = entries.map(({ doc, checks }) => {
    const err = checks.filter((c) => c.level === 'error').length;
    const warn = checks.filter((c) => c.level === 'warn').length;
    const cls = err ? 'error' : warn ? 'warn' : 'ok';
    const text = err ? `${err} Fehler, ${warn} Hinweise` : warn ? `${warn} Hinweise – bitte prüfen` : 'Alle Prüfungen bestanden';
    const unit = doc.scale === 1000 ? 'TEUR' : doc.scale === 1e6 ? 'Mio. EUR' : 'EUR';
    return `<article class="doc" data-id="${doc.id}">
      <header>
        <input type="text" class="company" value="${esc(doc.company)}" aria-label="Firmenname" data-field="company">
        <button class="btn small" data-remove="${doc.id}" title="Dokument entfernen" aria-label="Dokument entfernen">✕</button>
      </header>
      <div class="meta">
        <label>GJ <input type="number" value="${doc.year ?? ''}" data-field="year" aria-label="Geschäftsjahr"></label>
        <span>${esc(doc.fileName)}</span>
        <span>${doc.pageCount} Seiten${doc.ocrPages.length ? ` · OCR: S. ${doc.ocrPages.join(', ')}` : ''}</span>
        <span>PDF in ${unit}</span>
      </div>
      <div class="status ${cls}">${text}</div>
    </article>`;
  }).join('');
}

const issueKeys = (entries) => {
  const set = new Set();
  entries.forEach(({ doc, checks }) => checks.forEach((c) => { if (c.id && c.level !== 'ok') set.add(`${doc.id}|${c.id}|${c.col}`); }));
  return set;
};

function headRows(entries, leftCols, perDoc) {
  const top = entries.map(({ doc }) => `<th colspan="${perDoc.length}">${esc(doc.company || doc.fileName)}</th>`).join('');
  const sub = entries.map(({ doc }) => perDoc.map((f) => `<th>${f(doc)}</th>`).join('')).join('');
  return `<thead><tr>${leftCols.map((c, i) => `<th class="${i === leftCols.length - 1 ? 'label' : ''}" rowspan="2">${c}</th>`).join('')}${top}</tr><tr>${sub}</tr></thead>`;
}

const yearHead = [(d) => `GJ ${d.year ?? ''}`, (d) => `VJ ${d.priorYear ?? ''}`];

function statementTable(entries, sections) {
  const issues = issueKeys(entries);
  let html = `<table>${headRows(entries, ['Pos.', 'Bezeichnung'], yearHead)}<tbody>`;
  const span = 2 + entries.length * 2;
  for (const { heading, positions } of sections) {
    if (heading) html += `<tr class="section"><td colspan="${span}">${heading}</td></tr>`;
    for (const p of positions) {
      const has = entries.some(({ values }) => COLS.some((c) => values[p.id][c]));
      if (state.hideEmpty && !has) continue;
      const total = p.id.endsWith('SUM') || p.id === 'guv.17';
      const cls = [CHILDREN[p.id] ? 'sum' : '', total ? 'total' : ''].join(' ');
      html += `<tr class="${cls}"><td class="nr">${esc(p.nr)}</td><td class="label" style="padding-left:${8 + depth(p.id) * 16}px">${esc(p.label)}</td>`;
      for (const { doc, values } of entries) {
        for (const col of COLS) {
          const cell = values[p.id][col];
          const statusCls = cell ? (cell.src?.uncertain ? 'uncertain' : cell.status) : '';
          const issue = issues.has(`${doc.id}|${p.id}|${col}`) ? ' issue' : '';
          const title = !cell ? 'Kein Wert' : cell.status === 'calc' ? 'Berechnet' : cell.status === 'edit' ? 'Manuell korrigiert' : `Seite ${cell.src?.page}: ${cell.src?.text}${cell.src?.ocr ? ' (OCR)' : ''}`;
          html += `<td class="val ${statusCls}${issue}"><input type="text" inputmode="decimal" data-key="${doc.id}|${p.id}|${col}" value="${cell ? formatAmount(cell.v) : ''}" title="${esc(title)}" aria-label="${esc(`${p.label} ${col.toUpperCase()}`)}"></td>`;
        }
      }
      html += '</tr>';
    }
  }
  return `${html}</tbody></table>`;
}

function ratioTable(entries) {
  const ratios = entries.map(({ values }) => computeRatios(values));
  let html = `<table>${headRows(entries, ['Kennzahl'], yearHead)}<tbody>`;
  let group = null;
  for (const r of RATIOS) {
    if (r.group !== group) { group = r.group; html += `<tr class="section"><td colspan="${1 + entries.length * 2}">${group}</td></tr>`; }
    html += `<tr><td class="label">${esc(r.label)}</td>`;
    ratios.forEach((rv) => COLS.forEach((col) => { html += `<td class="num">${formatRatio(rv[r.id][col], r.format)}</td>`; }));
    html += '</tr>';
  }
  return `${html}</tbody></table>`;
}

function checksView(entries) {
  return `<div class="checks">${entries.map(({ doc, checks }) => `
    <h3>${esc(doc.company || doc.fileName)}</h3>
    <p class="muted">Bilanz/GuV erkannt auf Seite ${doc.statementPages.join(', ') || '–'} von ${doc.pageCount}${doc.ocrPages.length ? ` · per Texterkennung gelesen: Seite ${doc.ocrPages.join(', ')}` : ''}</p>
    <ul>${checks.map((c) => `<li class="${c.level}">${esc(c.text)}</li>`).join('')}</ul>
    ${doc.unmatched.length ? `<details><summary>${doc.unmatched.length} Zeilen mit Beträgen ohne Zuordnung</summary><ul>${doc.unmatched.map((u) => `<li class="unmatched">S. ${u.page}: ${esc(u.text)}</li>`).join('')}</ul></details>` : ''}
  `).join('')}</div>`;
}

function renderTab(entries) {
  if (!entries.length) { $('#table').innerHTML = ''; return; }
  const focusKey = document.activeElement?.dataset?.key;
  const scroll = $('#table').dataset.tab === state.tab ? [$('#table').scrollTop, $('#table').scrollLeft] : [0, 0];
  $('#table').dataset.tab = state.tab;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.tab === state.tab));
  const view = {
    bilanz: () => statementTable(entries, [{ heading: 'AKTIVA', positions: AKTIVA.map((p) => BY_ID[p.id]) }, { heading: 'PASSIVA', positions: PASSIVA.map((p) => BY_ID[p.id]) }]),
    guv: () => statementTable(entries, [{ heading: 'GEWINN- UND VERLUSTRECHNUNG (Aufwendungen als positive Beträge)', positions: GUV.map((p) => BY_ID[p.id]) }]),
    kennzahlen: () => ratioTable(entries),
    pruefung: () => checksView(entries),
  }[state.tab];
  $('#table').innerHTML = view();
  [$('#table').scrollTop, $('#table').scrollLeft] = scroll;
  if (focusKey) document.querySelector(`input[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

// --- Editing ---

$('#table').addEventListener('change', (e) => {
  const key = e.target.dataset.key;
  if (!key) return;
  const [id, posId, col] = key.split('|');
  const doc = state.docs.find((d) => String(d.id) === id);
  const text = e.target.value.trim();
  const v = text === '' ? null : parseAmount(text);
  if (text !== '' && v === null) { e.target.setCustomValidity('Ungültige Zahl'); e.target.reportValidity(); return; }
  e.target.setCustomValidity('');
  doc.values[posId] ||= {};
  const prev = doc.values[posId][col];
  const orig = prev?.status === 'pdf' ? prev : prev?.orig;
  doc.values[posId][col] = orig && orig.v === v ? orig : { v, status: 'edit', orig };
  setTimeout(render);
});

$('#docs').addEventListener('change', (e) => {
  const card = e.target.closest('.doc');
  const doc = state.docs.find((d) => String(d.id) === card?.dataset.id);
  if (!doc) return;
  if (e.target.dataset.field === 'company') doc.company = e.target.value.trim();
  if (e.target.dataset.field === 'year') {
    const y = parseInt(e.target.value, 10);
    doc.year = Number.isFinite(y) ? y : null;
    doc.priorYear = doc.year ? doc.year - 1 : null;
  }
  render();
});

$('#docs').addEventListener('click', (e) => {
  const id = e.target.dataset.remove;
  if (!id) return;
  const doc = state.docs.find((d) => String(d.id) === id);
  if (doc && confirm(`„${doc.company || doc.fileName}“ entfernen?`)) {
    state.docs = state.docs.filter((d) => d !== doc);
    render();
  }
});

for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); });
$('#hide-empty').addEventListener('change', (e) => { state.hideEmpty = e.target.checked; render(); });

// --- Export ---

$('#btn-export').addEventListener('click', async () => {
  const btn = $('#btn-export');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Wird erstellt …';
  try {
    await loadScript(LIBS.exceljs);
    const wb = buildWorkbook(window.ExcelJS, analysed(), { unit: Number($('#unit').value) });
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const names = state.docs.map((d) => d.company).filter(Boolean);
    const base = names.length === 1 ? `Jahresabschluss_${names[0]}_${state.docs[0].year ?? ''}` : `Jahresabschluesse_${new Date().toISOString().slice(0, 10)}`;
    a.download = `${base.replace(/[^\wäöüÄÖÜß.-]+/g, '_')}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) {
    console.error(err);
    alert(`Excel-Export fehlgeschlagen: ${err.message || err}`);
  } finally {
    btn.textContent = label;
    btn.disabled = !state.docs.length;
  }
});

window.addEventListener('beforeunload', (e) => { if (state.docs.length) e.preventDefault(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
