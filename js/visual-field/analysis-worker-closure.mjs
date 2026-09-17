// [Active · worker closure] The analysis worker's dependency closure, imported once per worker with the stamped
// query. The grayscale worker imports the PNG module directly (never the normative table or the analysis core).
import { api as matrix } from './visual-field-matrix.mjs';
import { api as normative } from './visual-field-normative.mjs';
import { api as analysisCore } from './visual-field-analysis-core.mjs';
import { api as png } from './visual-field-png.mjs';
export { matrix, normative, analysisCore, png };
