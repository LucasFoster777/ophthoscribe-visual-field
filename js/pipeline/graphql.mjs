import { buildSchema, parse, validate, executeSync, GraphQLError } from 'graphql';

export const schema = buildSchema(`
  type Provenance { adapter: String adapterVersion: String sourceId: ID sourceLocation: String engine: String dataset: String unknown: Boolean detail: String! }
  type Metric { name: String! value: Float unit: String absenceReason: String detail: String! }
  type Globals { md: Float psd: Float vfi: Float metrics: [Metric!]! detail: String! }
  type Point { id: ID x: Float y: Float value: Float unit: String absenceReason: String censored: String sourceLocation: String normalization: String td: Float pd: Float tdP: String pdP: String posterior: Float totalDeviation: Float patternDeviation: Float totalDeviationProbability: String patternDeviationProbability: String detail: String! }
  type Analysis { id: ID! origin: String! globals: Globals! points(offset: Int = 0, limit: Int = 100): [Point!]! provenance: Provenance! assumptions: String engine: String dataset: String detail: String! }
  type Examination { id: ID! sourceId: ID! subject: String! eye: String! date: String pattern: String! age: Float measurements(offset: Int = 0, limit: Int = 100): [Point!]! analyses(selection: String = "source-only"): [Analysis!]! provenance: Provenance! }
  type Source { id: ID! subject: String name: String format: String sha256: String originalAvailable: Boolean! document: String provenance: Provenance! warnings: [String!]! examinations(eye: String, pattern: String, dateFrom: String, dateTo: String, offset: Int = 0, limit: Int = 50): [Examination!]! }
  type Query {
    sources(subject: String, offset: Int = 0, limit: Int = 50): [Source!]!
    source(id: ID!): Source
    examinations(subject: String, eye: String, pattern: String, dateFrom: String, dateTo: String, sourceId: ID, offset: Int = 0, limit: Int = 50): [Examination!]!
    examination(id: ID!): Examination
  }
`);
const str = value => value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : (typeof value?.value === 'number' && Number.isFinite(value.value) ? value.value : null);
function page(values, { offset = 0, limit = 50 } = {}) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new GraphQLError('Pagination requires offset >= 0 and limit from 1 to 200');
  return values.slice(offset, offset + limit);
}
function provenance(p) { return { ...(p && typeof p === 'object' ? p : {}), adapter: str(p?.adapter), sourceLocation: str(p?.sourceLocation), engine: str(p?.engine), dataset: str(p?.dataset), detail: JSON.stringify(p ?? {}) }; }
function point(p) { return { ...p, td: number(p.totalDeviation), pd: number(p.patternDeviation), tdP: str(p.totalDeviationProbability?.value), pdP: str(p.patternDeviationProbability?.value), totalDeviation: number(p.totalDeviation), patternDeviation: number(p.patternDeviation), totalDeviationProbability: str(p.totalDeviationProbability?.value), patternDeviationProbability: str(p.patternDeviationProbability?.value), censored: str(p.censored), sourceLocation: str(p.sourceLocation), normalization: str(p.normalization), posterior: number(p.posterior), detail: JSON.stringify(p) }; }
function analysis(a) {
  const g = a.globals ?? {};
  return { ...a, globals: { md: number(g.md ?? g.MD), psd: number(g.psd ?? g.PSD), vfi: number(g.vfi ?? g.VFI), metrics: Object.entries(g).map(([name, v]) => ({ name, value: number(v), unit: v?.unit ?? null, absenceReason: v?.absenceReason ?? null, detail: JSON.stringify(v) })), detail: JSON.stringify(g) }, points: args => page(a.points ?? [], args).map(point), provenance: provenance(a.provenance), assumptions: str(a.assumptions), engine: str(a.engine), dataset: str(a.dataset), detail: JSON.stringify(a) };
}
function examination(e) {
  return { ...e, measurements: args => page(e.measurements, args).map(point), provenance: provenance(e.provenance), analyses: ({ selection = 'source-only' }) => {
    if (selection !== 'all' && selection !== 'source-only' && !e.analyses.some(a => a.id === selection)) throw new GraphQLError(`Unknown analysis selection: ${selection}`);
    return e.analyses.filter(a => a.origin !== 'computed' || selection === 'all' || a.id === selection).map(analysis);
  } };
}
function filter(examinations, args) { return examinations.filter(e => (!args.subject || e.subject === args.subject) && (!args.eye || e.eye === args.eye) && (!args.pattern || e.pattern === args.pattern) && (!args.sourceId || e.sourceId === args.sourceId) && (!args.dateFrom || (e.date && e.date >= args.dateFrom)) && (!args.dateTo || (e.date && e.date <= args.dateTo))); }

// Expand fragments before execution so aliases and fragment multiplication cannot bypass limits.
function bounded(document, variables = {}) {
  const fragments = new Map(document.definitions.filter(d => d.kind === 'FragmentDefinition').map(d => [d.name.value, d]));
  let fields = 0, cost = 0;
  function walk(set, depth, stack = [], multiplier = 1) {
    if (depth > 10) throw new GraphQLError('Query depth exceeds 10');
    for (const s of set?.selections ?? []) {
      if (++fields > 500) throw new GraphQLError('Query complexity exceeds 500 selections');
      if (s.kind === 'FragmentSpread') {
        if (stack.includes(s.name.value)) throw new GraphQLError('Cyclic fragment');
        walk(fragments.get(s.name.value)?.selectionSet, depth, [...stack, s.name.value], multiplier);
      } else {
        const name = s.name?.value;
        const list = ['sources','examinations','measurements','points','analyses','metrics'].includes(name);
        const arg = s.arguments?.find(a => a.name.value === 'limit')?.value;
        const requested = arg?.kind === 'Variable' ? variables[arg.name.value] : arg?.value;
        const amount = list ? Math.min(200, Math.max(1, Number(requested ?? (['points','measurements'].includes(name) ? 100 : 50)))) : 1;
        cost += multiplier * amount;
        if (cost > 100000) throw new GraphQLError('Query expanded cost exceeds 100000; reduce pagination or selections');
        walk(s.selectionSet, depth + 1, stack, multiplier * amount);
      }
    }
  }
  for (const d of document.definitions) if (d.kind === 'OperationDefinition') {
    if (d.operation !== 'query') throw new GraphQLError('Only read-only queries are supported');
    walk(d.selectionSet, 0);
  }
}
export function executeQuery(snapshot, { query, variables, operationName } = {}) {
  try {
    if (typeof query !== 'string' || query.length > 16384) throw new GraphQLError('Query must be a string of at most 16384 characters');
    const document = parse(query, { maxTokens: 3000 });
    bounded(document, variables);
    const errors = validate(schema, document, undefined, { maxErrors: 10 });
    if (errors.length) return { errors };
    function source(s) { return { ...s, originalAvailable: s.hasOriginal === true || typeof s.originalBase64 === 'string', document: str(s.document), warnings: (s.warnings ?? []).map(str), provenance: provenance(s.provenance), examinations: args => page(filter(snapshot.examinations.filter(e => e.sourceId === s.id), args), args).map(examination) }; }
    const rootValue = {
      sources: args => page(snapshot.sources.filter(s => !args.subject || s.subject === args.subject || snapshot.examinations.some(e => e.sourceId === s.id && e.subject === args.subject)), args).map(source),
      source: ({ id }) => { const s = snapshot.sources.find(s => s.id === id); return s ? source(s) : null; },
      examinations: args => page(filter(snapshot.examinations, args), args).map(examination),
      examination: ({ id }) => { const e = snapshot.examinations.find(e => e.id === id); return e ? examination(e) : null; },
    };
    const result = executeSync({ schema, document, rootValue, variableValues: variables, operationName });
    if (JSON.stringify(result).length > 4 * 1024 * 1024) return { errors: [new GraphQLError('Query result exceeds 4 MiB; reduce selection or pagination')] };
    return result;
  } catch (error) { return { errors: [error instanceof GraphQLError ? error : new GraphQLError(error.message)] }; }
}
