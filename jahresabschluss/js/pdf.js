// Reads a PDF in the browser into positioned word tokens. Pages with a text layer are read with pdf.js; scanned
// pages (little or no text) are rendered and recognised with Tesseract OCR (German). Nothing leaves the device:
// the libraries and the OCR language model are downloaded once, the document itself is processed locally.

import { splitItem } from './parse.js';

export const LIBS = {
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  tesseractWorker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  tesseractCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  tesseractLang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int',
  exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
};

const MIN_TEXT_CHARS = 40; // fewer characters with a text layer → treat the page as scanned
const OCR_SCALE = 2.5; // ≈ 180 dpi for A4

let pdfjsPromise;
export function loadPdfjs() {
  pdfjsPromise ||= import(LIBS.pdfjs).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
    return lib;
  });
  return pdfjsPromise;
}

const scripts = {};
export function loadScript(url) {
  scripts[url] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Bibliothek konnte nicht geladen werden: ${url}`));
    document.head.appendChild(s);
  });
  return scripts[url];
}

let ocrWorkerPromise;
async function ocrWorker(onProgress) {
  ocrWorkerPromise ||= (async () => {
    await loadScript(LIBS.tesseract);
    onProgress?.('Texterkennung wird geladen (einmalig ca. 5 MB) …');
    return window.Tesseract.createWorker('deu', 1, {
      workerPath: LIBS.tesseractWorker,
      corePath: LIBS.tesseractCore,
      langPath: LIBS.tesseractLang,
    });
  })();
  return ocrWorkerPromise;
}

export async function terminateOcr() {
  if (!ocrWorkerPromise) return;
  const w = await ocrWorkerPromise;
  ocrWorkerPromise = null;
  await w.terminate();
}

// Returns [{ width, height, ocr, tokens: [{ str, x0, x1, top, bottom }] }] in PDF points (top-left origin).
export async function readPdf(data, { onProgress, forceOcr = false } = {}) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    onProgress?.(`Seite ${n} von ${pdf.numPages} wird gelesen …`);
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const tokens = [];
    let chars = 0;
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const [a, b, c, d, e, f] = item.transform;
      const h = item.height || Math.hypot(c, d) || Math.hypot(a, b);
      const [x, y] = vp.convertToViewportPoint(e, f);
      chars += item.str.trim().length;
      tokens.push(...splitItem(item.str, x, item.width, y - h, y));
    }
    if (chars >= MIN_TEXT_CHARS && !forceOcr) {
      pages.push({ width: vp.width, height: vp.height, ocr: false, tokens });
      continue;
    }
    onProgress?.(`Seite ${n} von ${pdf.numPages}: Texterkennung (OCR) …`);
    const ovp = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(ovp.width);
    canvas.height = Math.ceil(ovp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: ovp }).promise;
    const worker = await ocrWorker(onProgress);
    const { data: result } = await worker.recognize(canvas);
    const ocrTokens = (result.words || [])
      .filter((w) => w.text && w.text.trim() && w.confidence > 20)
      .map((w) => ({
        str: w.text.trim(),
        x0: w.bbox.x0 / OCR_SCALE,
        x1: w.bbox.x1 / OCR_SCALE,
        top: w.bbox.y0 / OCR_SCALE,
        bottom: w.bbox.y1 / OCR_SCALE,
        conf: w.confidence,
      }));
    pages.push({ width: vp.width, height: vp.height, ocr: true, tokens: ocrTokens });
    canvas.width = canvas.height = 0;
  }
  await pdf.destroy();
  return pages;
}
