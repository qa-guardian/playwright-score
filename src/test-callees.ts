/**
 * Callee resolution for the test states (QAG-287 S12, src/test-states.ts).
 *
 * One question: "what does this expression denote, as far as a test's calls go?"
 * The answer is one of a closed set:
 *  ok      Playwright (a built-in fixture, the test object and what is read from them),
 *          Node (`node:*`, a built-in module, a standard global), a package on the
 *          `nonAsserting` list of catalogue/known-packages.json, or plain data;
 *  assert  an assertion library on the `assertion` list of the same file;
 *  fn, class, inst, obj, ns   code of this repository, reached through scope analysis
 *          and the import closure: a function, a class, an instance (`new X(page)`, also
 *          the value a fixture factory hands to `use`), an object literal, a module;
 *  param   a parameter of a function that is being followed: Playwright when its name or
 *          its type says so (`page`, `locator`, `testInfo`, `p: Page`), otherwise a method
 *          called on it is not resolved;
 *  unres   anything else, with the name the report shows.
 * Nothing here reads a name's spelling to decide that code asserts. A step cap bounds
 * every chain; a cap hit is `unres`.
 */
import { builtinModules } from 'node:module';
import { KNOWN_PACKAGES } from './catalogue/table.js';
import { resolveImportSpecifier, type ImportResolver } from './import-graph.js';
import { isPlaywrightPackage } from './rules/proof.js';
import type { N, ResolveEnv, ScopeFile } from './rules/proof.js';
import { lookup, strip } from './rules/scope-resolve.js';
import {
  BUILT_IN_FIXTURES,
  chain,
  enclosingClass,
  exportedName,
  GLOBALS,
  isFunction,
  isPwParam,
  listed,
  patternKey,
  propName,
  returned,
  text,
  unwrap,
  walk,
} from './test-syntax.js';

export type Code = { sf: ScopeFile; node: N };
export type Val =
  | { k: 'ok'; test?: boolean; pw?: boolean; ext?: Code }
  | { k: 'param'; name: string; pw: boolean }
  | { k: 'assert' }
  | ({ k: 'fn' | 'class' | 'inst' | 'obj' } & Code)
  | { k: 'ns'; sf: ScopeFile }
  | { k: 'unres'; name: string };

export interface CalleeCtx {
  env: ResolveEnv;
  boundary: string;
  moduleResolver?: ImportResolver;
}

/** Expression and module steps one question may take. */
export const MAX_CALLEE_STEPS = 24;

const OK: Val = { k: 'ok' };
const unres = (name: string): Val => ({ k: 'unres', name });
const paramVal = (id: N): Val => ({ k: 'param', name: id.name as string, pw: isPwParam(id) });

/** `module.exports = X` of a CommonJS file. */
function moduleExports(sf: ScopeFile): N | undefined {
  let found: N | undefined;
  for (const s of sf.ast.body as N[]) {
    const e = s.type === 'ExpressionStatement' ? (s.expression as N) : undefined;
    if (e?.type === 'AssignmentExpression' && text(e.left) === 'module.exports') found = e.right;
  }
  return found;
}

/** What `name` of the module a specifier names denotes; `*` is the module itself. */
function fromSource(c: CalleeCtx, sf: ScopeFile, source: string, name: string, steps: number): Val {
  if (listed(KNOWN_PACKAGES.assertion, source)) return { k: 'assert' };
  if (isPlaywrightPackage(source)) {
    // `expect` used directly is the expect binding's question. Reaching it here means an alias: not resolved on this path.
    if (name === 'expect') return unres('expect');
    if (name === '*') return { k: 'ok', pw: true };
    return name === 'test' || name === 'default' ? { k: 'ok', test: true } : OK;
  }
  if (source.startsWith('node:') || builtinModules.includes(source) || listed(KNOWN_PACKAGES.nonAsserting, source)) return OK;
  if (steps > MAX_CALLEE_STEPS) return unres(source);
  const file = resolveImportSpecifier(sf.file, source, c.boundary, c.moduleResolver);
  const target = file ? c.env.load(file) : undefined;
  if (!target) return unres(source);
  if (name !== '*') return exportValue(c, target, name, steps + 1);
  const cjs = moduleExports(target);
  return cjs ? valueOf(c, target, cjs, steps + 1) : { k: 'ns', sf: target };
}

/** The value a module exports under `name` (`default` for the default export). */
export function exportValue(c: CalleeCtx, sf: ScopeFile, name: string, steps = 0): Val {
  const stars: N[] = [];
  for (const s of sf.ast.body as N[]) {
    if (s.type === 'ExportNamedDeclaration') {
      const d = s.declaration as N | undefined;
      if (d && (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id?.name === name) return valueOf(c, sf, d, steps);
      for (const v of (d?.type === 'VariableDeclaration' ? d.declarations : []) as N[]) {
        if (v.id?.type === 'Identifier' && v.id.name === name) return valueOf(c, sf, v.init, steps);
      }
      for (const sp of (s.specifiers ?? []) as N[]) {
        if (exportedName(sp.exported) !== name) continue;
        return s.source ? fromSource(c, sf, s.source.value, exportedName(sp.local) ?? name, steps + 1) : valueOf(c, sf, sp.local, steps);
      }
    } else if (s.type === 'ExportDefaultDeclaration' && name === 'default') return valueOf(c, sf, s.declaration, steps);
    else if (s.type === 'ExportAllDeclaration' && s.source && !s.exported) stars.push(s);
    else if (s.type === 'ExpressionStatement' && s.expression?.type === 'AssignmentExpression') {
      const left = text(s.expression.left);
      if (left === `module.exports.${name}` || left === `exports.${name}`) return valueOf(c, sf, s.expression.right, steps);
    }
  }
  const cjs = moduleExports(sf);
  if (cjs) return name === 'default' ? valueOf(c, sf, cjs, steps) : memberOf(c, valueOf(c, sf, cjs, steps), name, steps);
  for (const s of stars) {
    const v = fromSource(c, sf, s.source.value, name, steps + 1);
    if (v.k !== 'unres') return v;
  }
  return unres(name);
}

function classMember(c: CalleeCtx, cls: Code, name: string, steps: number, wantStatic: boolean): Val {
  for (const m of (cls.node.body?.body ?? []) as N[]) {
    if (exportedName(m.key) !== name && m.key?.name !== name) continue;
    if (!!m.static !== wantStatic) continue;
    if (m.type === 'MethodDefinition') return m.kind === 'method' ? { k: 'fn', sf: cls.sf, node: m.value } : OK;
    return isFunction(strip(m.value)) ? { k: 'fn', sf: cls.sf, node: strip(m.value)! } : OK;
  }
  if (!cls.node.superClass) return OK; // a field: data, or a locator kept on the object
  if (steps > MAX_CALLEE_STEPS) return unres(name);
  const base = valueOf(c, cls.sf, cls.node.superClass, steps + 1);
  return base.k === 'class' ? classMember(c, base, name, steps + 1, wantStatic) : unres(base.k === 'unres' ? base.name : name);
}

/** What `value.name` denotes. */
export function memberOf(c: CalleeCtx, v: Val, name: string | undefined, steps: number): Val {
  switch (v.k) {
    case 'unres':
    case 'assert':
      return v;
    case 'inst':
    case 'class':
      return name ? classMember(c, v, name, steps, v.k === 'class') : OK;
    case 'obj': {
      const props = (v.node.properties ?? []) as N[];
      const p = props.find((x) => x.type === 'Property' && exportedName(x.key) === name);
      if (p) return valueOf(c, v.sf, p.value, steps + 1);
      return props.some((x) => x.type === 'SpreadElement') ? unres(name ?? '(spread)') : OK;
    }
    case 'ns':
      return name ? exportValue(c, v.sf, name, steps + 1) : OK;
    case 'param':
      return v.pw ? OK : unres(`${v.name}.${name ?? '[...]'}`);
    case 'ok':
      // A member of the Playwright module object (`require('@playwright/test')`): the same answers as a named import.
      return !v.pw ? OK : name === 'expect' ? unres('expect') : name === 'test' ? { k: 'ok', test: true } : OK;
    default:
      return OK;
  }
}

/** The value a fixture factory hands to `use`, looked up along `.extend({...})` and `mergeTests(...)`. */
function fixtureValue(c: CalleeCtx, test: Val & { k: 'ok' }, key: string, steps: number): Val {
  if (BUILT_IN_FIXTURES.has(key)) return OK;
  const queue: Code[] = test.ext ? [test.ext] : [];
  const push = (v: Val): void => void (v.k === 'ok' && v.ext && queue.push(v.ext));
  for (let i = 0; queue.length > 0 && i < 16; i++) {
    const { sf, node } = queue.shift()!;
    const callee = strip(node.callee)!;
    if (callee.type !== 'MemberExpression') {
      for (const a of node.arguments as N[]) push(valueOf(c, sf, a, steps + 1));
      continue;
    }
    const table = strip(node.arguments?.[0]);
    if (table?.type !== 'ObjectExpression') return unres(key);
    const p = (table.properties as N[]).find((x) => x.type === 'Property' && exportedName(x.key) === key);
    if (!p && (table.properties as N[]).some((x) => x.type === 'SpreadElement')) return unres(key);
    if (!p) {
      push(valueOf(c, sf, callee.object, steps + 1));
      continue;
    }
    let fn = strip(p.value);
    if (fn?.type === 'ArrayExpression') fn = strip(fn.elements?.[0]);
    if (!isFunction(fn)) return OK; // an option with a default value
    const use = fn!.params?.[1]?.type === 'Identifier' ? (fn!.params[1].name as string) : undefined;
    const handed: N[] = [];
    walk(fn!.body, (n) => {
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === use) handed.push(n);
    });
    if (handed.length === 0) return unres(key);
    const v = valueOf(c, sf, handed[0].arguments?.[0], steps + 1);
    return v.k === 'param' ? (v.pw ? OK : unres(key)) : v;
  }
  return unres(key);
}

function identifier(c: CalleeCtx, sf: ScopeFile, id: N, steps: number): Val {
  const name = id.name as string;
  const def = (lookup(sf, id, name)?.defs as N[] | undefined)?.[0];
  if (!def) return GLOBALS.has(name) ? OK : unres(name);
  const node = def.node as N;
  switch (def.type) {
    case 'ImportBinding': {
      const decl = def.parent as N | undefined;
      if (!decl?.source || decl.importKind === 'type' || node.importKind === 'type') return OK;
      const imported = node.type === 'ImportSpecifier' ? exportedName(node.imported) : node.type === 'ImportDefaultSpecifier' ? 'default' : '*';
      return fromSource(c, sf, decl.source.value, imported ?? name, steps + 1);
    }
    case 'FunctionName':
      return { k: 'fn', sf, node };
    case 'ClassName':
      return { k: 'class', sf, node };
    case 'Variable': {
      const loop = sf.parents.get(def.parent as N);
      if (!node.init || (loop?.type.startsWith('For') && loop.left === def.parent)) return OK;
      const init = valueOf(c, sf, node.init, steps + 1);
      if (node.id?.type === 'Identifier') return init;
      if (node.id?.type !== 'ObjectPattern') return init.k === 'unres' ? init : OK;
      const key = patternKey(node.id, def.name as N);
      return key ? memberOf(c, init, key, steps + 1) : init.k === 'unres' ? init : OK;
    }
    case 'Parameter': {
      const call = sf.parents.get(node);
      const first = node.params?.[0] as N | undefined;
      const key = first?.type === 'ObjectPattern' ? patternKey(first, def.name as N) : undefined;
      if (!key || call?.type !== 'CallExpression' || !(call.arguments as N[]).includes(node)) return paramVal(def.name as N);
      const root = chain(call.callee).root;
      const test = root ? valueOf(c, sf, root, steps + 1) : undefined;
      return test?.k === 'ok' && test.test ? fixtureValue(c, test, key, steps + 1) : paramVal(def.name as N);
    }
    default:
      return OK; // a catch binding, an enum, a namespace
  }
}

/** What an expression denotes. Never throws on a shape it does not know: that shape is data (`ok`). */
export function valueOf(c: CalleeCtx, sf: ScopeFile, raw: N | null | undefined, steps = 0): Val {
  const n = unwrap(raw);
  if (!n) return OK;
  if (steps > MAX_CALLEE_STEPS) return unres(text(n));
  switch (n.type) {
    case 'Identifier':
      return identifier(c, sf, n, steps);
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression':
      return { k: 'fn', sf, node: n };
    case 'ClassDeclaration':
    case 'ClassExpression':
      return { k: 'class', sf, node: n };
    case 'ObjectExpression':
      return { k: 'obj', sf, node: n };
    case 'ThisExpression': {
      const cls = enclosingClass(sf, n);
      return cls ? { k: 'inst', sf, node: cls } : OK;
    }
    case 'MemberExpression':
      return memberOf(c, valueOf(c, sf, n.object, steps + 1), propName(n), steps + 1);
    case 'NewExpression': {
      const v = valueOf(c, sf, n.callee, steps + 1);
      return v.k === 'class' ? { ...v, k: 'inst' } : v.k === 'unres' ? v : OK;
    }
    case 'CallExpression': {
      const callee = unwrap(n.callee);
      const arg = strip(n.arguments?.[0]);
      if (callee?.type === 'Identifier' && callee.name === 'require' && !lookup(sf, callee, 'require')?.defs?.length && typeof arg?.value === 'string') {
        return fromSource(c, sf, arg.value, '*', steps + 1);
      }
      const extending = callee?.type === 'MemberExpression' ? propName(callee) === 'extend' : callee?.type === 'Identifier' && callee.name === 'mergeTests';
      const v = valueOf(c, sf, extending && callee!.type === 'MemberExpression' ? callee!.object : callee, steps + 1);
      if (extending && v.k === 'ok' && (v.test || callee!.type === 'Identifier')) return { k: 'ok', test: true, ext: { sf, node: n } };
      if (v.k === 'unres') return v;
      if (v.k === 'param') return unres(`${text(callee)}()`);
      if (v.k !== 'fn') return OK;
      // The result of repository code: read through a one-expression body, otherwise not known.
      const body = returned(v.node);
      const result = body ? valueOf(c, v.sf, body, steps + 1) : unres(`${text(callee)}()`);
      return result.k === 'param' ? (result.pw ? OK : unres(`${text(callee)}()`)) : result;
    }
    default:
      return OK;
  }
}
