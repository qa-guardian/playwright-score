/**
 * Export table of a local module, and the walk across modules (QAG-287 B2.2).
 *
 * `exportTable` classifies every top-level statement of a file. The classifier
 * is total: a statement it does not know makes the whole table opaque, and an
 * opaque table proves nothing. A name is proven through a module only when the
 * table holds exactly one contribution for it and that contribution is a proof
 * shape (rules X1 to X7). Which file a specifier leads to is decided by rule R
 * alone (`resolveForRunner`); where that is not certain the answer is "not proven".
 */
import { resolveForRunner, type RunnerResolution } from './runner-resolve.js';
import { lookup } from './scope-resolve.js';
import { isPlaywrightPackage, notProven, proven } from './proof.js';
import type { N, PackageExport, ProofRule, Reason, ResolveEnv, Result, ScopeFile, Walk } from './proof.js';

export type Contribution =
  | { kind: 'reexport'; source: string; imported: string; node: N }
  | { kind: 'local'; id: N; node: N }
  | { kind: 'init'; expr: N; node: N }
  | { kind: 'blocker'; node: N };

export interface ExportTable {
  kind: 'esm' | 'cjs' | 'none' | 'opaque';
  reason?: Reason;
  names: Map<string, Contribution[]>;
  stars: string[];
  starNodes: N[];
  /** CommonJS shape: A is one `module.exports = { ... }` literal, B is property writes only. */
  shape?: 'A' | 'B';
  /** A free `eval` reference or a `with` statement: nothing is proven through the file. */
  reflection: boolean;
  /** The classifier row each statement, declarator or specifier fell under (tests generate their cases from it). */
  rows: string[];
}

/** Every row of the statement classifier. The last one is the default. */
export const CLASSIFIER_ROWS = [
  'type-export-specifiers', 'type-specifier', 'string-name-specifier', 'declare-declaration', 'type-star-as', 'type-star',
  'reexport', 'local-specifier', 'variable-const-init', 'variable-other', 'variable-pattern', 'other-declaration',
  'default-expression', 'default-declaration', 'star-as', 'star', 'export-assignment', 'namespace-export',
  'export-import-equals', 'neutral', 'unknown',
] as const;
type Row = (typeof CLASSIFIER_ROWS)[number];

/** Statement types that export nothing. Any type that is neither here nor an export row makes the table opaque. */
export const NEUTRAL_STATEMENTS: ReadonlySet<string> = new Set([
  'ImportDeclaration', 'VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'ExpressionStatement',
  'IfStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'SwitchStatement',
  'TryStatement', 'ThrowStatement', 'ReturnStatement', 'BreakStatement', 'ContinueStatement', 'WithStatement', 'DebuggerStatement',
  'BlockStatement', 'EmptyStatement', 'LabeledStatement',
  'TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration', 'TSDeclareFunction', 'TSImportEqualsDeclaration',
]);
/** `export default <expression>`: the expression types that are read. Anything else is a declaration, which blocks the name. */
const DEFAULT_EXPRESSIONS: ReadonlySet<string> = new Set(['Identifier', 'CallExpression', 'MemberExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'ChainExpression']);

const nameOf = (n: N | undefined): string | undefined => (n?.type === 'Identifier' ? (n.name as string) : n?.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined);

/** Every identifier a pattern binds, or undefined for a pattern node that is not read. */
function patternIds(p: N | null | undefined, out: string[] = []): string[] | undefined {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.push(p.name as string); return out;
    case 'ObjectPattern': return (p.properties as N[]).every((q) => patternIds(q, out)) ? out : undefined;
    case 'ArrayPattern': return (p.elements as Array<N | null>).every((q) => patternIds(q, out)) ? out : undefined;
    case 'Property': return patternIds(p.value as N, out);
    case 'RestElement': return patternIds(p.argument as N, out);
    case 'AssignmentPattern': return patternIds(p.left as N, out);
    default: return undefined;
  }
}

const free = (sf: ScopeFile, n: N): boolean => (lookup(sf, n, n.name as string)?.defs.length ?? 0) === 0;

/** A `this` that is the module's own: not inside a non-arrow function, a class member's value or a static block. */
function moduleThis(sf: ScopeFile, node: N): boolean {
  let child = node;
  for (let n = sf.parents.get(child); n; child = n, n = sf.parents.get(n)) {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'StaticBlock') return false;
    if ((n.type === 'PropertyDefinition' || n.type === 'AccessorProperty') && n.value === child) return false;
  }
  return true;
}

function buildTable(sf: ScopeFile): ExportTable {
  const t: ExportTable = { kind: 'none', names: new Map(), stars: [], starNodes: [], reflection: false, rows: [] };
  let exportStatements = 0;
  let opaque: Reason | undefined;
  const add = (row: Row, name: string | undefined, c: Contribution): void => {
    t.rows.push(row);
    if (name === undefined) opaque ??= 'unknown-statement';
    else t.names.set(name, [...(t.names.get(name) ?? []), c]);
  };
  const fail = (row: Row, reason: Reason): void => {
    t.rows.push(row);
    opaque ??= reason;
  };
  const named = (st: N): void => {
    const d = st.declaration as N | undefined;
    if (!d) {
      for (const spec of (st.specifiers ?? []) as N[]) {
        const name = nameOf(spec.exported);
        if (st.exportKind === 'type') add('type-export-specifiers', name, { kind: 'blocker', node: spec });
        else if (spec.exportKind === 'type') add('type-specifier', name, { kind: 'blocker', node: spec });
        else if (spec.local?.type !== 'Identifier' || spec.exported?.type !== 'Identifier') add('string-name-specifier', name, { kind: 'blocker', node: spec });
        else if (typeof st.source?.value === 'string') add('reexport', name, { kind: 'reexport', source: st.source.value, imported: spec.local.name, node: spec });
        else if (!st.source) add('local-specifier', name, { kind: 'local', id: spec.local, node: spec });
        else fail('unknown', 'unknown-statement');
      }
      return;
    }
    const declared = d.type === 'VariableDeclaration';
    if (d.declare === true || !declared) {
      const row: Row = d.declare === true ? 'declare-declaration' : d.type === 'TSImportEqualsDeclaration' ? 'export-import-equals' : 'other-declaration';
      const names = declared ? (d.declarations as N[]).map((x) => patternIds(x.id)) : [d.id?.type === 'Identifier' ? [d.id.name as string] : undefined];
      for (const list of names) {
        if (!list) fail(row, declared ? 'unreadable-pattern' : 'unknown-statement');
        else for (const name of list) add(row, name, { kind: 'blocker', node: d });
      }
      return;
    }
    for (const dec of d.declarations as N[]) {
      if (dec.id?.type === 'Identifier') {
        if (d.kind === 'const' && dec.init) add('variable-const-init', dec.id.name, { kind: 'init', expr: dec.init, node: dec });
        else add('variable-other', dec.id.name, { kind: 'blocker', node: dec });
        continue;
      }
      const ids = patternIds(dec.id);
      if (!ids) fail('variable-pattern', 'unreadable-pattern');
      else for (const name of ids) add('variable-pattern', name, { kind: 'blocker', node: dec });
    }
  };
  for (const st of (sf.ast.body ?? []) as N[]) {
    switch (st?.type) {
      case 'ExportNamedDeclaration': exportStatements += 1; named(st); break;
      case 'ExportDefaultDeclaration':
        exportStatements += 1;
        if (DEFAULT_EXPRESSIONS.has(st.declaration?.type)) add('default-expression', 'default', { kind: 'init', expr: st.declaration, node: st });
        else add('default-declaration', 'default', { kind: 'blocker', node: st });
        break;
      case 'ExportAllDeclaration':
        exportStatements += 1;
        if (st.exportKind === 'type' && st.exported) add('type-star-as', nameOf(st.exported), { kind: 'blocker', node: st });
        else if (st.exportKind === 'type') t.rows.push('type-star');
        else if (st.exported) add('star-as', nameOf(st.exported), { kind: 'blocker', node: st });
        else if (typeof st.source?.value === 'string') { t.rows.push('star'); t.stars.push(st.source.value); t.starNodes.push(st); }
        else fail('unknown', 'unknown-statement');
        break;
      case 'TSExportAssignment': exportStatements += 1; fail('export-assignment', 'export-assignment'); break;
      case 'TSNamespaceExportDeclaration': exportStatements += 1; fail('namespace-export', 'export-assignment'); break;
      default:
        if (st?.type === 'TSImportEqualsDeclaration' && st.isExport === true) { exportStatements += 1; add('export-import-equals', nameOf(st.id), { kind: 'blocker', node: st }); }
        else if (NEUTRAL_STATEMENTS.has(st?.type)) t.rows.push('neutral');
        else fail('unknown', 'unknown-statement');
    }
  }
  // CommonJS access: every node that reaches the export object by name.
  const access: N[] = [];
  for (const [n, parent] of sf.parents) {
    if (n.type === 'WithStatement') t.reflection = true;
    else if (n.type === 'ThisExpression') { if (moduleThis(sf, n)) access.push(n); }
    else if (n.type === 'Identifier' && (n.name === 'module' || n.name === 'exports' || n.name === 'eval')) {
      const propertyName = parent && ((parent.type === 'MemberExpression' && parent.property === n && !parent.computed) || (parent.type === 'Property' && parent.key === n && !parent.computed && parent.value !== n));
      if (propertyName || !free(sf, n)) continue;
      if (n.name === 'eval') t.reflection = true;
      else access.push(n);
    }
  }
  if (opaque) return { ...t, kind: 'opaque', reason: opaque };
  if (exportStatements > 0) return access.length === 0 ? { ...t, kind: 'esm' } : { ...t, kind: 'opaque', reason: 'mixed-module' };
  if (access.length === 0) return t;
  return commonJs(sf, t, access) ?? { ...t, kind: 'opaque', reason: 'cjs-shape' };
}

const memberOf = (sf: ScopeFile, object: N, name?: string): N | undefined => {
  const m = sf.parents.get(object);
  const ok = m?.type === 'MemberExpression' && m.object === object && !m.computed && m.property?.type === 'Identifier' && m.property.name !== '__proto__' && (name === undefined || m.property.name === name);
  return ok ? m : undefined;
};
/** The top-level `left = right` statement whose left side is `left`. */
const topAssignment = (sf: ScopeFile, left: N | undefined): N | undefined => {
  const a = left ? sf.parents.get(left) : undefined;
  const st = a?.type === 'AssignmentExpression' && a.operator === '=' && a.left === left ? sf.parents.get(a) : undefined;
  return st?.type === 'ExpressionStatement' && sf.parents.get(st) === sf.ast ? a : undefined;
};

/** Shape A or shape B, or undefined: the file reaches its export object in a way that is not read. */
function commonJs(sf: ScopeFile, t: ExportTable, access: N[]): ExportTable | undefined {
  const names = new Map<string, Contribution[]>();
  const put = (name: string, c: Contribution): void => void names.set(name, [...(names.get(name) ?? []), c]);
  const whole = access.length === 1 && access[0].type === 'Identifier' && access[0].name === 'module' ? topAssignment(sf, memberOf(sf, access[0], 'exports')) : undefined;
  if (whole) {
    if (whole.right?.type !== 'ObjectExpression') return undefined;
    for (const p of whole.right.properties as N[]) {
      const key = p.type === 'Property' && p.kind === 'init' && !p.computed && !p.method ? nameOf(p.key) : undefined;
      if (key === undefined || key === '__proto__') return undefined;
      put(key, { kind: 'init', expr: p.value, node: p });
    }
    return { ...t, kind: 'cjs', shape: 'A', names };
  }
  for (const m of access) {
    if (m.type !== 'Identifier') return undefined;
    const target = m.name === 'module' ? memberOf(sf, m, 'exports') : m;
    const left = target ? memberOf(sf, target) : undefined;
    const a = topAssignment(sf, left);
    if (!a || !left) return undefined;
    put(left.property.name as string, { kind: 'init', expr: a.right, node: a });
  }
  return { ...t, kind: 'cjs', shape: 'B', names };
}

const tables = new WeakMap<ScopeFile, ExportTable>();
/** The export table of a file, built once (it does not depend on the name asked for). Never throws. */
export function exportTable(sf: ScopeFile): ExportTable {
  let t = tables.get(sf);
  if (!t) {
    try {
      t = buildTable(sf);
    } catch {
      t = { kind: 'opaque', reason: 'internal-error', names: new Map(), stars: [], starNodes: [], reflection: false, rows: [] };
    }
    tables.set(sf, t);
  }
  return t;
}

/** What the export `name` of the local module `file` denotes. `depth` counts local modules from the spec file (depth 0). */
export function exportOf(env: ResolveEnv, file: string, name: string, depth: number, walk: Walk, via: readonly ProofRule[]): Result<PackageExport> {
  if (depth > walk.maxDepth) return notProven('depth', file);
  const key = `${file}\0${name}`;
  if (walk.stack.includes(key)) return notProven('cycle', file);
  const sf = env.load(file);
  if (!sf) return notProven('module-unreadable', file);
  const t = exportTable(sf);
  if (t.reflection) return notProven('reflection', file, sf.ast);
  if (t.kind === 'opaque') return notProven(t.reason ?? 'internal-error', file, sf.ast);
  if (t.kind === 'cjs' && name === 'default') return notProven('cjs-default', file, sf.ast);
  const list = t.names.get(name) ?? [];
  if (list.length > 1) return notProven('competing-export', file, list[1].node);
  const c = list[0];
  walk.stack.push(key);
  try {
    if (!c) {
      if (t.stars.length > 1) return notProven('ambiguous-star', file, t.starNodes[1]);
      if (t.kind !== 'esm' || t.stars.length !== 1 || name === 'default') return notProven('no-such-export', file, sf.ast);
      const r = specifier(env, sf, t.stars[0], name, t.starNodes[0], depth, walk, via);
      return r.ok ? proven('X5', r.value, r.rules) : r;
    }
    switch (c.kind) {
      case 'reexport': {
        const r = specifier(env, sf, c.source, c.imported, c.node, depth, walk, via);
        return r.ok ? proven('X1', r.value, r.rules) : r;
      }
      case 'local': {
        const r = walk.value(sf, c.id, depth, via);
        return r.ok ? proven('X2', r.value, r.rules) : r;
      }
      case 'init': {
        const r = walk.value(sf, c.expr, depth, via);
        if (!r.ok) return r;
        if (t.kind === 'esm') return name === 'default' ? proven('X4', r.value, r.rules) : proven('X3', r.value, r.rules);
        return t.shape === 'A' ? proven('X6', r.value, r.rules) : proven('X7', r.value, r.rules);
      }
      default:
        return notProven('local-declaration', file, c.node);
    }
  } finally {
    walk.stack.pop();
  }
}

const resolutions = new WeakMap<ResolveEnv, Map<string, RunnerResolution>>();
function runnerFile(env: ResolveEnv, fromFile: string, spec: string): RunnerResolution {
  let memo = resolutions.get(env);
  if (!memo) resolutions.set(env, (memo = new Map()));
  const key = `${fromFile}\0${spec}`;
  let r = memo.get(key);
  if (!r) memo.set(key, (r = resolveForRunner(fromFile, spec, env.runner)));
  return r;
}

/** What the export `name` of the module that `spec` names, imported in `from`, denotes. Rule R alone decides which module that is. */
export function specifier(env: ResolveEnv, from: ScopeFile, spec: string, name: string, at: N | undefined, depth: number, walk: Walk, via: readonly ProofRule[]): Result<PackageExport> {
  const r = runnerFile(env, from.file, spec);
  const playwright = isPlaywrightPackage(spec);
  if (playwright) {
    if (r.kind !== 'package') return notProven(r.kind === 'unknown' && (r.reason === 'runner-config' || r.reason === 'internal-error') ? r.reason : 'package-aliased', from.file, at);
  } else if (r.kind === 'unknown') {
    return notProven(r.reason, from.file, at);
  } else if (r.kind === 'file') {
    return name === '*' ? notProven('namespace-of-local-module', from.file, at) : exportOf(env, r.path, name, depth + 1, walk, via);
  }
  return proven('R', { package: spec, name, playwright }, via);
}
