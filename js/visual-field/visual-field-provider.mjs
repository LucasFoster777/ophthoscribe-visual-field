// [Active · eager] Module form of the namespace presence checks sync readers used to make: a group
// entry registers its facade when it evaluates; an earlier reader gets undefined. No Visual Field logic. `assets` = the shell's
// loader; `directories` = the loaded vocabulary; `devRegistry` / `protocols` = present once their lazy group loaded.
const SLOTS = new Set(['store', 'note', 'assets', 'directories', 'devRegistry', 'protocols']);
const values = new Map();
export function register(name, value) {
  if (!SLOTS.has(name)) throw new Error('Unknown visual-field provider slot: ' + name);
  values.set(name, value);
}
export function get(name) { return values.get(name); }
export function reset() { values.clear(); }
const api = Object.freeze({ register, get, reset });
export { api as 'module.exports' };
