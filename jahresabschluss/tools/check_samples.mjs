// Regression check: reads the digital sample PDFs with pdf.js (same token logic as the browser) and compares every
// extracted value with samples/expected.json. Needs pdf.js once: npm install --no-save pdfjs-dist@4.10.38
//
//   node tools/check_samples.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitItem, extractDocument } from '../js/parse.js';
import { computeValues, checkDocument } from '../js/analysis.js';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));
let failed = 0;

for (const name of ['muster-pharma-gmbh.pdf', 'beispiel-maschinenbau-ag.pdf']) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, name))), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tokens = [];
    for (const item of (await page.getTextContent()).items) {
      if (!item.str?.trim()) continue;
      const [, , c, d, e, f] = item.transform;
      const h = item.height || Math.hypot(c, d);
      const [x, y] = vp.convertToViewportPoint(e, f);
      tokens.push(...splitItem(item.str, x, item.width, y - h, y));
    }
    pages.push({ width: vp.width, height: vp.height, tokens });
  }
  const doc = extractDocument(pages, { fileName: name });
  const values = computeValues(doc);
  const exp = expected[name];
  const errors = [];
  if (doc.company !== exp.company) errors.push(`Firma: ${doc.company}`);
  if (doc.year !== exp.year) errors.push(`Jahr: ${doc.year}`);
  for (const col of ['gj', 'vj']) {
    for (const [id, v] of Object.entries(exp[col])) {
      if (v === null) continue;
      const got = values[id]?.[col]?.v;
      if (got === undefined || Math.abs(got - v) > 0.01) errors.push(`${col} ${id}: erwartet ${v}, erkannt ${got}`);
    }
  }
  for (const c of checkDocument(doc, values)) if (c.level !== 'ok') errors.push(`Prüfung: ${c.text}`);
  console.log(`${errors.length ? '✗' : '✓'} ${name}${errors.map((e) => `\n    ${e}`).join('')}`);
  failed += errors.length;
}
process.exit(failed ? 1 : 0);
