import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { assembleGraph } from '../data/visual-field/assemble.mjs';
import { api as protocols } from '../visual-field/visual-field-protocols.mjs';
import { api as protocol } from '../visual-field/visual-field-protocol.mjs';
import { api as textLayer } from '../visual-field/visual-field-text-layer.mjs';
import { api as extract } from '../visual-field/visual-field-extract.mjs';
import { api as glyph } from '../visual-field/visual-field-glyph-reader.mjs';
export async function parsePdf({ bytes, name, context, directories, model, check = () => {} }) {
  if (!context.subject?.trim()) throw new Error('missing-required-context: explicit synthetic subject is required');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
  try {
    const pdf = await task.promise; check();
    if (pdf.numPages > 100) throw new Error('PDF exceeds 100-page limit');
    const pages = []; let doc, pageSize;
    for (let n = 1; n <= pdf.numPages; n++) {
      check(); const page = await pdf.getPage(n), viewport = page.getViewport({ scale: 1 });
      const items = textLayer.normalize(await page.getTextContent(), viewport.height); check();
      if (n === 1) {
        doc = protocol.detect(protocols.all(), items);
        if (!doc || doc.id !== 'zeiss_multi') throw new Error('Unsupported PDF: only text-backed Zeiss FORUM Overview zeiss_multi reports are supported; scans are unsupported');
        pageSize = { width: viewport.width, height: viewport.height };
      }
      if (Math.abs(viewport.width - doc.page.width) > doc.page.tolerance || Math.abs(viewport.height - doc.page.height) > doc.page.tolerance) throw new Error('Unsupported PDF page size');
      const readers = { 'text-layer': textLayer.createTextLayerReader(items) };
      if (protocol.needsRaster(doc)) {
        const scale = glyph.RENDER_SCALE, raster = page.getViewport({ scale });
        const canvas = createCanvas(Math.round(raster.width), Math.round(raster.height)), ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: raster }).promise; check();
        readers['raster-glyph'] = glyph.createGlyphReader({ image: ctx.getImageData(0, 0, canvas.width, canvas.height), scale });
      }
      pages.push({ page: n, points: await extract.extractPage(doc, n, readers, directories) }); check();
    }
    const hash = data => createHash('sha256').update(data).digest('hex');
    const graph = assembleGraph({ model, directories, registration: { ...doc.source, protocol: { id: doc.id, version: doc.version }, format: directories.reportKind(doc.source.reportKind).format, anchorsMatched: doc.detect.anchors.length, pageSize }, pages,
      file: { name, mime: 'application/pdf', bytes: bytes.byteLength, sha256: hash(bytes), pageCount: pdf.numPages }, subject: context.subject.startsWith('patients/') ? context.subject : `patients/${context.subject}`, encounter: '', deposit: { at: '', by: 'local-demo' } });
    await model.stampIdentities(graph, hash); check();
    const verdict = model.validateGraph(graph);
    if (!verdict.ok) throw new Error('PDF graph validation: ' + verdict.errors[0]);
    if (!graph.tests.length) throw new Error('No supported examinations found');
    return graph;
  } finally { await task.destroy(); }
}
