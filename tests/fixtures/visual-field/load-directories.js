// Node tests publish the loaded visual-field directories where the modules read them: the provider seam's
// `directories` slot (in the browser the store facade / protocols.load registers it once per session). The
// namespace copy stays for the Node scripts and tests that still read it directly.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
let pending = null;
function publish() {
  if (!pending) {
    pending = import(pathToFileURL(path.join(root, 'js/data/visual-field/directories.mjs')).href)
      .then((m) => m.loadDirectories({ readFile: (rel) => fs.promises.readFile(path.join(root, rel), 'utf8') }));
  }
  return pending.then((directories) => {
    global.OS = global.OS || {}; global.OS.visualField = global.OS.visualField || {};
    global.OS.visualField.directories = directories;
    require('../../../js/visual-field/visual-field-provider.mjs').register('directories', directories);
    return directories;
  });
}
module.exports = { publish, root };
