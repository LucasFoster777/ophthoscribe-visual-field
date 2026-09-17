// [Active · data layer · born ESM] Visual-field directories — every attribute that can vary, loaded and validated
// once (spec 2026-08-27-visual-field-native-entity-design §4). Pure over `readFile`; no globals, no DOM.
// Vocabularies follow the reducible-term rule: one token per concept, `aliases` for every way a printout says it,
// `label`/`short` for projection, `curation: seed | verified`; code slots stay empty in development mode.
export const DIRECTORY_ROOT = 'data/directories/visual-field/';
const FILES = Object.freeze({
  vendors: 'vendors.v1.json', reportKinds: 'report-kinds.v1.json', formats: 'formats.v1.json', patterns: 'patterns.v1.json',
  strategies: 'strategies.v1.json', stimuli: 'stimuli.v1.json', backgrounds: 'backgrounds.v1.json', fixation: 'fixation.v1.json',
  states: 'states.v1.json', attributes: 'attributes.v1.json', datasets: 'datasets/index.v1.json'
});
// Ids are lowercase slugs; the probability vocabulary carries its printed form (`p<0.5%`) as its token.
const SLUG = /^[a-z0-9][a-z0-9_.<>%-]*$/;
export const ATTRIBUTE_TYPES = Object.freeze(['text', 'integer', 'decimal', 'ratio', 'date', 'time', 'flag', 'version', 'pageOf', 'probability', 'struct']);

function entriesOf(doc) { return Array.isArray(doc && doc.entries) ? doc.entries : []; }
function lower(text) { return String(text || '').toLowerCase(); }

export async function loadDirectories({ readFile }) {
  const docs = {};
  for (const [key, file] of Object.entries(FILES)) docs[key] = JSON.parse(await readFile(DIRECTORY_ROOT + file));
  // vocabularies: name → entries[]; nested ones are addressed with a dot (fixation.monitors), the states file's
  // vocabularies by their own name (sex, ght, probability), eyes as a synthetic vocabulary over states.eyes.
  const vocabularies = {
    vendors: entriesOf(docs.vendors), reportKinds: entriesOf(docs.reportKinds), formats: entriesOf(docs.formats), patterns: entriesOf(docs.patterns),
    strategies: entriesOf(docs.strategies), stimuli: entriesOf(docs.stimuli), 'stimuli.colors': docs.stimuli.colors || [],
    backgrounds: entriesOf(docs.backgrounds),
    'fixation.monitors': docs.fixation.monitors || [], 'fixation.targets': docs.fixation.targets || [],
    eyes: (docs.states.eyes || []).map((id) => ({ id, label: id, short: id, aliases: [id] }))
  };
  Object.entries(docs.states.vocabularies || {}).forEach(([name, entries]) => { vocabularies[name] = entries; });
  const attributesById = new Map(entriesOf(docs.attributes).map((entry) => [entry.id, entry]));
  // Shipped normative datasets (two-lane spec §5, P4): the index names the artifacts; each document is read whole and
  // served by identity. Custom datasets live in the entity store, never here.
  const datasetDocs = new Map();
  for (const entry of entriesOf(docs.datasets)) datasetDocs.set(entry.id + '@' + entry.version, JSON.parse(await readFile(DIRECTORY_ROOT + 'datasets/' + entry.file)));
  vocabularies.datasets = entriesOf(docs.datasets).map((entry) => ({ id: entry.id, version: entry.version, pattern: entry.pattern, label: entry.label, shipped: true, aliases: [entry.id] }));
  function dataset(id, version) { return datasetDocs.get(String(id) + '@' + String(version)) || null; }
  function datasetsFor(patternId) { return vocabularies.datasets.filter((d) => d.pattern === patternId); }

  function vocabulary(name) { return vocabularies[name] || null; }
  function entry(name, id) { const entries = vocabulary(name); return entries ? entries.find((e) => e.id === id) || null : null; }
  // The lane is a fact of the format (two-lane spec §4): threshold-only formats are development-born; every device
  // file — typed or not — is the clinic lane.
  function laneOf(formatId) { const f = entry('formats', formatId); return f && f.lane === 'development' ? 'development' : 'clinic'; }
  // Longest alias wins so "sita faster" beats "sita fast"; substring match on the lower-cased text (the rule the
  // printout parsers used). Ties keep the earlier entry.
  function resolve(name, text) {
    const entries = vocabulary(name); if (!entries) return null;
    const hay = lower(text); let best = null;
    entries.forEach((item) => (item.aliases || []).forEach((alias) => {
      const needle = lower(alias);
      if (needle && hay.indexOf(needle) >= 0 && (!best || needle.length > best.length)) best = { length: needle.length, id: item.id };
    }));
    return best ? best.id : null;
  }
  // The printed lattice: row r holds `rows[r]` points from column `columnStarts[r]` on a `columns`-wide grid; OS
  // reverses each row so index order stays printed left-to-right while x mirrors (coordinate basis degrees-od-normalized).
  function patternPoints(patternId, eye) {
    const pattern = vocabularies.patterns.find((p) => p.id === patternId); if (!pattern || !pattern.lattice) return [];
    const { rows, columnStarts, topDegrees, leftDegrees } = pattern.lattice, pitch = pattern.pitchDegrees, points = []; let index = 0;
    rows.forEach((count, row) => {
      const xs = []; for (let offset = 0; offset < count; offset += 1) xs.push(leftDegrees + pitch * (columnStarts[row] + offset));
      if (eye === 'OS') xs.reverse();
      xs.forEach((x) => { points.push({ id: 'p' + String(index).padStart(2, '0'), x, y: topDegrees - pitch * row }); index += 1; });
    });
    return points;
  }
  function validateVocabularies(errors) {
    Object.entries(vocabularies).forEach(([name, entries]) => {
      const seen = new Set(), slug = name === 'eyes' ? /^O[DS]$/ : SLUG;  // eyes keep the clinical OD/OS tokens
      entries.forEach((item) => {
        if (!item || !slug.test(String(item.id || ''))) errors.push(`${name}: bad id ${item && item.id}`);
        else if (seen.has(item.id)) errors.push(`${name}: duplicate id ${item.id}`);
        seen.add(item && item.id);
        if (item && !Array.isArray(item.aliases)) errors.push(`${name}.${item.id}: aliases must be an array`);
      });
    });
  }
  function validatePatterns(errors) {
    vocabularies.patterns.forEach((p) => {
      if (!p.lattice || !Array.isArray(p.lattice.rows) || !Array.isArray(p.lattice.columnStarts)) { errors.push(`patterns.${p.id}: lattice needs rows and columnStarts`); return; }
      const total = p.lattice.rows.reduce((sum, n) => sum + n, 0);
      if (total !== p.pointCount) errors.push(`patterns.${p.id}: lattice sums to ${total}, pointCount ${p.pointCount}`);
      if (p.lattice.rows.length !== p.lattice.columnStarts.length) errors.push(`patterns.${p.id}: rows and columnStarts differ in length`);
      p.lattice.rows.forEach((count, row) => { if (p.lattice.columnStarts[row] + count > p.lattice.columns) errors.push(`patterns.${p.id}: row ${row} overflows the lattice`); });
      ['OD', 'OS'].forEach((eye) => {
        const ids = patternPoints(p.id, eye).map((q) => q.id);
        ((p.blindSpot && p.blindSpot[eye]) || []).forEach((id) => { if (!ids.includes(id)) errors.push(`patterns.${p.id}: blind spot ${id} not on the lattice`); });
      });
    });
  }
  function validateAttributes(errors) {
    attributesById.forEach((item, id) => {
      if (!item.home || !item.label) errors.push(`attributes.${id}: home and label required`);
      const type = String(item.type || '');
      if (type.startsWith('token:')) { if (!vocabulary(type.slice(6))) errors.push(`attributes.${id}: unknown vocabulary ${type}`); }
      else if (!ATTRIBUTE_TYPES.includes(type)) errors.push(`attributes.${id}: unknown type ${type}`);
      if (item.grid && !/\.p$/.test(item.home) && !/\.p\./.test(item.home)) errors.push(`attributes.${id}: grid home must address .p`);
      if (item.grid && !/\.p$/.test(id)) errors.push(`attributes.${id}: grid attribute ids end in .p`);
    });
  }
  function validate() {
    const errors = [];
    validateVocabularies(errors);
    validatePatterns(errors);
    vocabularies.reportKinds.forEach((k) => { if (!vocabularies.formats.some((f) => f.id === k.format)) errors.push(`report-kinds.${k.id}: unknown format ${k.format}`); });
    vocabularies.formats.forEach((f) => { if (!['clinic', 'development'].includes(f.lane)) errors.push(`formats.${f.id}: lane must be clinic | development`); });
    vocabularies.vendors.forEach((v) => (v.devices || []).forEach((d) => {
      if (!SLUG.test(String(d.id || ''))) errors.push(`vendors.${v.id}: bad device id ${d.id}`);
      (d.software || []).forEach((s) => { if (!SLUG.test(String(s.id || ''))) errors.push(`vendors.${v.id}.${d.id}: bad software id ${s.id}`); });
    }));
    validateAttributes(errors);
    vocabularies.datasets.forEach((d) => {
      const doc = dataset(d.id, d.version);
      if (!vocabularies.patterns.some((p) => p.id === d.pattern)) errors.push(`datasets.${d.id}: unknown pattern ${d.pattern}`);
      if (!doc || doc.id !== d.id || doc.version !== d.version || doc.pattern !== d.pattern) errors.push(`datasets.${d.id}: the artifact's id/version/pattern must match the index`);
      const pattern = vocabularies.patterns.find((p) => p.id === d.pattern);
      if (doc && pattern && Array.isArray(doc.points) && doc.points.length !== pattern.pointCount) errors.push(`datasets.${d.id}: ${doc.points.length} points for a ${pattern.pointCount}-point pattern`);
    });
    return { ok: errors.length === 0, errors };
  }
  function vendorOf(protocolId) {
    return vocabularies.vendors.find((v) => (v.devices || []).some((d) => (d.software || []).some((s) => Array.isArray(s.protocols) && s.protocols.includes(protocolId)))) || null;
  }
  return Object.freeze({
    ...docs, vocabulary, entry, resolve, laneOf, patternPoints, validate, vendorOf, dataset, datasetsFor,
    attribute: (id) => attributesById.get(id) || null,
    attributes: docs.attributes,
    reportKind: (id) => vocabularies.reportKinds.find((k) => k.id === id) || null,
    format: (id) => vocabularies.formats.find((f) => f.id === id) || null,
    pattern: (id) => vocabularies.patterns.find((p) => p.id === id) || null
  });
}
// The browser reads directories relative to this standalone repository; node tests pass fs.
export function browserReadFile(root) {
  return (rel) => root.fetch(new URL('../../../' + rel, import.meta.url), { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('directory ' + rel + ' ' + r.status);
    return r.text();
  });
}
