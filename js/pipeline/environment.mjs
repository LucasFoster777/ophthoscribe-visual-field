import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadDirectories } from '../data/visual-field/directories.mjs';
import { createModel } from '../data/visual-field/model.mjs';
import { api as protocols } from '../visual-field/visual-field-protocols.mjs';
import { register } from '../visual-field/visual-field-provider.mjs';
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export async function environment() {
  const directories = await loadDirectories({ readFile: path => readFile(resolve(ROOT, path), 'utf8') });
  const verdict = directories.validate();
  if (!verdict.ok) throw new Error('Invalid visual-field directories.');
  await protocols.load({ readFile: path => readFile(resolve(ROOT, path), 'utf8'), directories });
  register('directories', directories);
  return { directories, model: createModel(directories) };
}
