// [Active · lazy 'pipeline' group] Registry of extraction protocols — loaded from data/directories/visual-field/protocols/
// (index.v1.json → one JSON per protocol), validated against the directories, frozen. Protocols are data, never code
// (native-entity spec §4); nothing registers itself at script load.
import { api as protocolApi } from './visual-field-protocol.mjs';
import { register as registerProvider } from './visual-field-provider.mjs';
var PROTOCOL_ROOT = 'data/directories/visual-field/protocols/', INDEX = PROTOCOL_ROOT + 'index.v1.json';
var docs = null, pending = null;
// options = { readFile(relativePath) → Promise<string>, directories } — the same reader the directories loaded through.
function load(options) {
  if (docs) return Promise.resolve(docs.slice());
  if (pending) return pending;
  var readFile = options.readFile, directories = options.directories;
  // The loaded directories are the one vocabulary the synchronous classic modules (printout parsers, the JSON-lane
  // contracts, geometry entries, investigations rows) resolve through — published here, the single load point.
  registerProvider('directories', directories);
  pending = readFile(INDEX).then(function (text) {
    var index = JSON.parse(text);
    if (!index || index.schema !== 'visual-field-protocol-index/v1' || !Array.isArray(index.entries)) throw new Error('Invalid extraction protocol index: ' + INDEX);
    return Promise.all(index.entries.map(function (entry) {
      return readFile(PROTOCOL_ROOT + entry.file).then(JSON.parse).then(function (doc) {
        if (!doc || doc.id !== entry.id || doc.version !== entry.version) throw new Error('Extraction protocol ' + entry.file + ' does not match its index entry ' + entry.id + '@' + entry.version);
        return doc;
      });
    }));
  }).then(function (loaded) {
    var seen = {};
    loaded.forEach(function (doc) {
      var verdict = protocolApi.validateProtocol(doc, directories);
      if (!verdict.ok) throw new Error('Invalid extraction protocol ' + (doc && doc.id) + ': ' + verdict.errors.join('; '));
      if (seen[doc.id]) throw new Error('Extraction protocol already registered: ' + doc.id);
      seen[doc.id] = true;
    });
    docs = loaded.map(function (d) { return Object.freeze(d); }); pending = null;
    return docs.slice();
  }, function (err) { pending = null; throw err; });
  return pending;
}
function all() { if (!docs) throw new Error('Extraction protocols are not loaded — call load() first.'); return docs.slice(); }
function byId(id) { return all().find(function (d) { return d.id === id; }) || null; }
var api = Object.freeze({ load: load, all: all, byId: byId, loaded: function () { return !!docs; }, _resetForTest: function () { docs = null; pending = null; } });
export { api, api as 'module.exports' };
